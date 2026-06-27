// Hublo — gateway POC.
// Authentifie l'utilisateur en ouvrant une session SSH vers 127.0.0.1 EN TANT QUE lui.
// Toutes les actions (fichiers via SFTP, terminal via PTY, process via exec) passent par
// cette connexion → le noyau Unix (uid) fait la sécurité. Le gateway ne tourne JAMAIS en root.

import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import fastifyMultipart from '@fastify/multipart'
import { Client as SSHClient } from 'ssh2'
import pg from 'pg'
import { randomBytes } from 'node:crypto'
import { appendFile, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, posix } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787
const HOST = process.env.HOST || '127.0.0.1'
const SSH_HOST = '127.0.0.1'
const SSH_PORT = 22
const COOKIE = 'hublo_sess'
const IDLE_MS = 30 * 60 * 1000          // 30 min d'inactivité → on ferme la session SSH
const MAX_READ = 2 * 1024 * 1024        // 2 Mo max pour ouvrir un fichier dans l'éditeur
// Allowlist : seuls ces comptes Unix peuvent se connecter (refus avant toute tentative SSH).
// Comptes Unix autorisés à se connecter. Défaut = l'utilisateur qui lance le gateway.
// En production, fixer HUBLO_ALLOWED (ex. via le service systemd).
const ALLOWED = (process.env.HUBLO_ALLOWED || process.env.USER || '').split(',').map(s => s.trim()).filter(Boolean)

// ---- sessions en mémoire : token -> { username, conn, sftp, lastActive, ip } ----
const sessions = new Map()
// ---- rate-limit login basique : ip -> { fails, until } ----
const loginGuard = new Map()
const dbPool = {}   // pool de connexions Postgres par cfg.id (lazy init)
// invalide le pool d'une connexion (après édition/suppression : credentials périmés)
function dropPool (id) { try { dbPool[id]?.end().catch(() => {}) } catch {} delete dbPool[id] }

// ---- journal d'audit (qui, quoi, quand) ----
mkdirSync(join(__dirname, 'logs'), { recursive: true })
const AUDIT = join(__dirname, 'logs', 'audit.log')
function audit (req, user, action, detail) {
  const ip = req.headers['cf-connecting-ip'] || req.ip
  appendFile(AUDIT, `${new Date().toISOString()}\t${ip}\t${user || '-'}\t${action}\t${detail || ''}\n`, () => {})
}

const app = Fastify({ bodyLimit: 5 * 1024 * 1024 })
await app.register(fastifyCookie)
await app.register(fastifyWebsocket)
await app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024 } })
await app.register(fastifyStatic, {
  root: join(__dirname, 'public'),
  prefix: '/',
  cacheControl: false,
  setHeaders (res, p) {
    // index.html toujours revalidé ; assets hashés cachés longtemps
    if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
    else if (p.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  }
})

// ---- headers de sécurité HTTP ----
app.addHook('onSend', async (req, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'SAMEORIGIN')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (req.headers['x-forwarded-proto'] === 'https') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  reply.header('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "media-src 'self'",
  ].join('; '))
  return payload
})

function newToken () { return randomBytes(24).toString('hex') }
function getSession (req) {
  const t = req.cookies?.[COOKIE]
  if (!t) return null
  const s = sessions.get(t)
  if (!s) return null
  s.lastActive = Date.now()
  return s
}
function closeSession (token) {
  const s = sessions.get(token)
  if (s) {
    if (s.remotes) for (const k in s.remotes) { try { s.remotes[k].conn.end() } catch {} }
    try { s.conn.end() } catch {}
    sessions.delete(token)
  }
}

// Ouvre une connexion SSH (= authentification) en tant que `username`/`password`.
function sshConnect (username, password) {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient()
    const onErr = (e) => { reject(e) }
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err) }
        conn.removeListener('error', onErr)
        resolve({ conn, sftp })
      })
    })
    conn.on('error', onErr)
    conn.connect({
      host: SSH_HOST, port: SSH_PORT, username, password,
      tryKeyboard: true, readyTimeout: 12000
    })
    // certains PAM passent par keyboard-interactive
    conn.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([password]))
  })
}

// Normalise un chemin demandé par le client (toujours absolu, sans remonter via ..)
function safePath (p) {
  if (!p || typeof p !== 'string') return null
  const n = posix.normalize(p)
  if (!n.startsWith('/')) return null
  return n
}

// promisify minimal pour sftp
const pf = (fn, ...a) => new Promise((res, rej) => fn(...a, (e, r) => e ? rej(e) : res(r)))

// quote shell sûr (pour les commandes exec construites avec un chemin/terme)
const shq = (s) => `'` + String(s).replace(/'/g, `'\\''`) + `'`
// exec une commande et renvoie stdout (string)
function sshExec (conn, cmd) {
  return new Promise((res) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return res('')
      let d = ''
      stream.on('data', x => { d += x })
      stream.stderr && stream.stderr.on('data', () => {})
      stream.on('close', () => res(d))
    })
  })
}
// exec avec code de sortie + stderr (pour les opérations qui peuvent échouer)
function sshRun (conn, cmd) {
  return new Promise((res) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return res({ code: 1, out: '', err: err.message })
      let out = '', errout = '', code = 0
      stream.on('data', d => { out += d })
      stream.stderr && stream.stderr.on('data', d => { errout += d })
      stream.on('exit', c => { code = c })
      stream.on('close', () => res({ code, out, err: errout }))
    })
  })
}
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', txt: 'text/plain; charset=utf-8' }
const mimeFor = (n) => MIME[(n.split('.').pop() || '').toLowerCase()] || 'application/octet-stream'

// ----- transfert inter-hôtes (stream SFTP source -> SFTP destination, récursif) -----
function transferFile (srcSftp, srcPath, dstSftp, dstPath) {
  return new Promise((res, rej) => {
    const rs = srcSftp.createReadStream(srcPath)
    const ws = dstSftp.createWriteStream(dstPath)
    rs.on('error', rej); ws.on('error', rej); ws.on('close', res)
    rs.pipe(ws)
  })
}
async function transferDir (srcSftp, srcPath, dstSftp, dstPath) {
  await pf(dstSftp.mkdir.bind(dstSftp), dstPath).catch(() => {})
  const list = await pf(srcSftp.readdir.bind(srcSftp), srcPath)
  for (const e of list) {
    const sp = posix.join(srcPath, e.filename), dp = posix.join(dstPath, e.filename)
    if ((e.longname || '')[0] === 'd') await transferDir(srcSftp, sp, dstSftp, dp)
    else await transferFile(srcSftp, sp, dstSftp, dp)
  }
}

// ===== Lecteurs réseau (hôtes SSH enregistrés dans ~/.hublo) =====
const hubloDir = (s) => posix.join(s.home, '.hublo')
const hostsFile = (s) => posix.join(hubloDir(s), 'hosts.json')

async function readHosts (s) {
  try { const buf = await pf(s.sftp.readFile.bind(s.sftp), hostsFile(s)); return JSON.parse(buf.toString('utf8')) }
  catch { return [] }
}
async function writeHosts (s, arr) {
  await sshRun(s.conn, `mkdir -p ${shq(hubloDir(s))} && chmod 700 ${shq(hubloDir(s))}`)
  await pf(s.sftp.writeFile.bind(s.sftp), hostsFile(s), JSON.stringify(arr, null, 2))
}

// Établit (ou réutilise) une connexion SSH+SFTP sortante vers un hôte enregistré.
async function ensureRemote (s, hostId) {
  if (!s.remotes) s.remotes = {}
  if (s.remotes[hostId]) return s.remotes[hostId]
  const h = (await readHosts(s)).find(x => x.id === hostId)
  if (!h) throw new Error('hôte inconnu')
  let privateKey
  if (h.auth === 'key' && h.keyName) {
    const buf = await pf(s.sftp.readFile.bind(s.sftp), posix.join(hubloDir(s), 'keys', h.keyName)).catch(() => null)
    if (!buf) throw new Error('clé privée introuvable')
    privateKey = buf
  }
  const { conn, sftp } = await new Promise((res, rej) => {
    const c = new SSHClient()
    c.on('ready', () => c.sftp((e, sf) => e ? rej(e) : res({ conn: c, sftp: sf })))
    c.on('error', rej)
    c.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([h.password || '']))
    c.connect({
      host: h.host, port: h.port || 22, username: h.user,
      privateKey, password: h.auth === 'password' ? h.password : undefined,
      tryKeyboard: true, readyTimeout: 15000
    })
  })
  const home = await pf(sftp.realpath.bind(sftp), '.').catch(() => '/')
  const entry = { conn, sftp, home, label: h.label }
  conn.on('close', () => { if (s.remotes) delete s.remotes[hostId] })
  s.remotes[hostId] = entry
  return entry
}

// Résout la cible d'une opération fichier : local (défaut) ou un hôte distant.
async function resolveTarget (s, hostId) {
  if (!hostId || hostId === 'local') return { sftp: s.sftp, conn: s.conn, home: s.home }
  return await ensureRemote(s, hostId)
}

// ===== Connexions base de données (Postgres) — stockées dans ~/.hublo/db.json =====
const dbFile = (s) => posix.join(hubloDir(s), 'db.json')
async function readDbConns (s) {
  try { const buf = await pf(s.sftp.readFile.bind(s.sftp), dbFile(s)); return JSON.parse(buf.toString('utf8')) } catch { return [] }
}
async function writeDbConns (s, arr) {
  await sshRun(s.conn, `mkdir -p ${shq(hubloDir(s))} && chmod 700 ${shq(hubloDir(s))}`)
  await pf(s.sftp.writeFile.bind(s.sftp), dbFile(s), JSON.stringify(arr, null, 2))
}
async function pgRun (cfg, sql) {
  // ponytail: lazy pool init par cfg.id, pas de factory ni lifecycle manager
  if (!dbPool[cfg.id]) {
    dbPool[cfg.id] = new pg.Pool({
      host: cfg.host || '127.0.0.1', port: cfg.port || 5432, database: cfg.database,
      user: cfg.user, password: cfg.password,
      max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 8000
    })
  }
  return await dbPool[cfg.id].query(sql)
}

// ---------- AUTH ----------
app.post('/api/login', async (req, reply) => {
  const ip = req.headers['cf-connecting-ip'] || req.ip
  const g = loginGuard.get(ip)
  if (g && g.until > Date.now()) return reply.code(429).send({ error: 'Trop de tentatives, réessayez plus tard.' })

  const { username, password } = req.body || {}
  if (!username || !password || !/^[a-z_][a-z0-9_-]*$/.test(username)) {
    return reply.code(400).send({ error: 'Identifiants invalides.' })
  }
  if (!ALLOWED.includes(username)) {
    audit(req, username, 'login', 'REFUSÉ (allowlist)')
    return reply.code(403).send({ error: 'Compte non autorisé sur Hublo.' })
  }
  try {
    const { conn, sftp } = await sshConnect(username, password)
    const home = await pf(sftp.realpath.bind(sftp), '.').catch(() => '/home/' + username)
    const token = newToken()
    sessions.set(token, { username, conn, sftp, home, lastActive: Date.now(), ip })
    conn.on('close', () => sessions.delete(token))
    loginGuard.delete(ip)
    audit(req, username, 'login', 'ok')
    const secure = req.headers['x-forwarded-proto'] === 'https'
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 8 })
    return { ok: true, username, home }
  } catch (e) {
    const cur = loginGuard.get(ip) || { fails: 0 }
    cur.fails++
    if (cur.fails >= 8) cur.until = Date.now() + 10 * 60 * 1000
    loginGuard.set(ip, cur)
    audit(req, username, 'login', 'ÉCHEC')
    return reply.code(401).send({ error: 'Connexion refusée (utilisateur / mot de passe).' })
  }
})

app.post('/api/logout', async (req, reply) => {
  const t = req.cookies?.[COOKIE]
  if (t) closeSession(t)
  reply.clearCookie(COOKIE, { path: '/' })
  return { ok: true }
})

app.get('/api/me', async (req, reply) => {
  const s = getSession(req)
  if (!s) return reply.code(401).send({ error: 'non connecté' })
  return { username: s.username, home: s.home }
})

// ---------- FICHIERS (SFTP) ----------
function requireSession (req, reply) {
  const s = getSession(req)
  if (!s) { reply.code(401).send({ error: 'non connecté' }); return null }
  // rate-limit par session : max 100 requêtes par fenêtre de 10 secondes
  const now = Date.now()
  if (!s._rate) s._rate = { count: 0, windowStart: now }
  if (now - s._rate.windowStart > 10_000) { s._rate.count = 0; s._rate.windowStart = now }
  s._rate.count++
  if (s._rate.count > 100) {
    reply.code(429).send({ error: 'Trop de requêtes, ralentissez.' })
    return null
  }
  return s
}

app.get('/api/fs/list', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'Connexion à l’hôte impossible : ' + e.message }) }
  const path = safePath(req.query.path || t.home)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  try {
    const list = await pf(t.sftp.readdir.bind(t.sftp), path)
    const entries = list.map(e => {
      const t = (e.longname || '')[0]
      return {
        name: e.filename,
        type: t === 'd' ? 'dir' : (t === 'l' ? 'link' : 'file'),
        size: e.attrs?.size ?? 0,
        mtime: (e.attrs?.mtime ?? 0) * 1000,
        mode: e.attrs?.mode ?? 0
      }
    }).filter(e => e.name !== '.' && e.name !== '..')
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1)))
    return { path, parent: path === '/' ? null : posix.dirname(path), entries }
  } catch (e) {
    return reply.code(400).send({ error: 'Lecture impossible : ' + e.message })
  }
})

app.get('/api/fs/read', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'Connexion à l’hôte impossible : ' + e.message }) }
  const path = safePath(req.query.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  try {
    const st = await pf(t.sftp.stat.bind(t.sftp), path)
    if (st.size > MAX_READ) return reply.code(413).send({ error: 'Fichier trop gros pour l’éditeur (> 2 Mo).' })
    const buf = await pf(t.sftp.readFile.bind(t.sftp), path)
    return { path, content: buf.toString('utf8'), size: st.size }
  } catch (e) {
    return reply.code(400).send({ error: 'Ouverture impossible : ' + e.message })
  }
})

app.post('/api/fs/write', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const path = safePath(req.body?.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  try {
    await pf(t.sftp.writeFile.bind(t.sftp), path, req.body.content ?? '')
    audit(req, s.username, 'write', path)
    return { ok: true }
  } catch (e) { return reply.code(400).send({ error: 'Écriture impossible : ' + e.message }) }
})

app.post('/api/fs/mkdir', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const path = safePath(req.body?.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  try { await pf(t.sftp.mkdir.bind(t.sftp), path); audit(req, s.username, 'mkdir', path); return { ok: true } }
  catch (e) { return reply.code(400).send({ error: 'Création impossible : ' + e.message }) }
})

app.post('/api/fs/rename', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const from = safePath(req.body?.from), to = safePath(req.body?.to)
  if (!from || !to) return reply.code(400).send({ error: 'chemin invalide' })
  try { await pf(t.sftp.rename.bind(t.sftp), from, to); audit(req, s.username, 'rename', from + ' → ' + to); return { ok: true } }
  catch (e) { return reply.code(400).send({ error: 'Renommage impossible : ' + e.message }) }
})

app.post('/api/fs/delete', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const path = safePath(req.body?.path)
  if (!path || path === '/' || path === t.home) return reply.code(400).send({ error: 'chemin invalide' })
  if (path.startsWith(posix.join(t.home, '.hublo-trash'))) return reply.code(400).send({ error: 'déjà dans la corbeille' })
  // mise à la corbeille (déplacement vers ~/.hublo-trash/<id>/ sur la machine cible + mémo du chemin d'origine)
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const dir = posix.join(t.home, '.hublo-trash', id)
  const r = await sshRun(t.conn, `mkdir -p ${shq(dir)} && printf '%s' ${shq(path)} > ${shq(dir + '/.origpath')} && mv -- ${shq(path)} ${shq(dir + '/')}`)
  if (r.code !== 0) return reply.code(400).send({ error: 'Mise à la corbeille impossible : ' + (r.err || '').trim() })
  audit(req, s.username, 'trash', path)
  return { ok: true }
})

// upload (multipart) : dépose le(s) fichier(s) dans le dossier `path`
app.post('/api/fs/upload', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const dir = safePath(req.query.path)
  if (!dir) return reply.code(400).send({ error: 'chemin invalide' })
  const data = await req.file()
  if (!data) return reply.code(400).send({ error: 'aucun fichier' })
  const dest = posix.join(dir, posix.basename(data.filename))
  try {
    await new Promise((res, rej) => {
      const ws = t.sftp.createWriteStream(dest)
      ws.on('close', res); ws.on('error', rej)
      data.file.on('limit', () => rej(new Error('fichier trop gros (> 100 Mo)')))
      data.file.pipe(ws)
    })
    audit(req, s.username, 'upload', dest)
    return { ok: true, name: posix.basename(data.filename) }
  } catch (e) { return reply.code(400).send({ error: 'Import impossible : ' + e.message }) }
})

// download : renvoie le fichier en flux (attachment)
app.get('/api/fs/download', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const path = safePath(req.query.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  const name = posix.basename(path).replace(/["\\]/g, '')
  const inline = req.query.inline === '1'
  reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`)
  reply.header('Content-Type', inline ? mimeFor(name) : 'application/octet-stream')
  return reply.send(t.sftp.createReadStream(path))
})

// ---------- CORBEILLE ----------
app.get('/api/trash/list', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const base = posix.join(t.home, '.hublo-trash')
  const cmd = `for d in ${shq(base)}/*/; do [ -d "$d" ] || continue; id=$(basename "$d"); orig=$(cat "$d/.origpath" 2>/dev/null); item=$(ls -A "$d" | grep -vx '.origpath' | head -1); printf '%s\\t%s\\t%s\\n' "$id" "$orig" "$item"; done`
  const out = await sshExec(t.conn, cmd)
  const items = out.trim().split('\n').filter(Boolean).map(l => {
    const p = l.split('\t')
    return { id: p[0], orig: p[1] || '', name: p[2] || '' }
  }).filter(x => x.id && x.name)
  return { items }
})

app.post('/api/trash/restore', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const id = String(req.body?.id || '')
  if (!/^[a-z0-9]+$/.test(id)) return reply.code(400).send({ error: 'id invalide' })
  const d = posix.join(t.home, '.hublo-trash', id)
  const cmd = `d=${shq(d)}; orig=$(cat "$d/.origpath" 2>/dev/null); [ -z "$orig" ] && exit 3; item=$(ls -A "$d" | grep -vx '.origpath' | head -1); [ -z "$item" ] && exit 4; target="$orig"; [ -e "$target" ] && target="$orig-restauré-$(date +%s)"; mv -- "$d/$item" "$target" && rm -rf "$d" && printf '%s' "$target"`
  const r = await sshRun(t.conn, cmd)
  if (r.code !== 0) return reply.code(400).send({ error: 'Restauration impossible' })
  audit(req, s.username, 'restore', r.out)
  return { ok: true, path: r.out }
})

app.post('/api/trash/empty', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const base = posix.join(t.home, '.hublo-trash')
  const r = await sshRun(t.conn, `rm -rf ${shq(base)} && mkdir -p ${shq(base)}`)
  if (r.code !== 0) return reply.code(400).send({ error: 'Vidage impossible' })
  audit(req, s.username, 'trash-empty', '')
  return { ok: true }
})

// ---------- ARCHIVES ----------
app.post('/api/fs/compress', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const path = safePath(req.body?.path)
  if (!path || path === '/' || path === t.home) return reply.code(400).send({ error: 'chemin invalide' })
  const dir = posix.dirname(path), base = posix.basename(path)
  const out = base + '.tar.gz'
  const r = await sshRun(t.conn, `cd ${shq(dir)} && tar -czf ${shq(out)} -- ${shq(base)}`)
  if (r.code !== 0) return reply.code(400).send({ error: 'Compression impossible : ' + (r.err || '').trim() })
  audit(req, s.username, 'compress', path)
  return { ok: true, name: out }
})

app.post('/api/fs/extract', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const path = safePath(req.body?.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  const dir = posix.dirname(path), base = posix.basename(path), low = base.toLowerCase()
  let folder, tool
  if (low.endsWith('.zip')) {
    folder = base.replace(/\.zip$/i, ''); tool = `unzip -o -q ${shq(base)} -d "$f"`
  } else if (low.endsWith('.tar.gz') || low.endsWith('.tgz') || low.endsWith('.tar')) {
    folder = base.replace(/\.(tar\.gz|tgz|tar)$/i, ''); tool = `tar --no-same-owner --no-same-permissions -xf ${shq(base)} -C "$f"`
  } else {
    return reply.code(400).send({ error: 'Format non géré (zip, tar.gz, tgz, tar)' })
  }
  const cmd = `cd ${shq(dir)} || exit 1; f=${shq(folder)}; [ -e "$f" ] && f="$f-extrait-$(date +%s)"; mkdir -p "$f" && ${tool}`
  const r = await sshRun(t.conn, cmd)
  if (r.code !== 0) return reply.code(400).send({ error: 'Extraction impossible : ' + (r.err || '').trim() })
  audit(req, s.username, 'extract', path)
  return { ok: true }
})

// copie (gère la collision : suffixe -copie-<ts>)
app.post('/api/fs/copy', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let tg; try { tg = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const from = safePath(req.body?.from), to = safePath(req.body?.to)
  if (!from || !to) return reply.code(400).send({ error: 'chemin invalide' })
  const r = await sshRun(tg.conn, `t=${shq(to)}; [ -e "$t" ] && t="$t-copie-$(date +%s)"; cp -r -- ${shq(from)} "$t" && printf '%s' "$t"`)
  if (r.code !== 0) return reply.code(400).send({ error: 'Copie impossible : ' + (r.err || '').trim() })
  audit(req, s.username, 'copy', from + ' → ' + r.out)
  return { ok: true, path: r.out }
})

// transfert inter-hôtes (copie ou déplacement entre serveurs)
app.post('/api/fs/transfer', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const b = req.body || {}
  const fromPath = safePath(b.fromPath), toDir = safePath(b.toDir)
  const mode = b.mode === 'move' ? 'move' : 'copy'
  if (!fromPath || !toDir) return reply.code(400).send({ error: 'chemin invalide' })
  let src, dst
  try { src = await resolveTarget(s, b.fromHost); dst = await resolveTarget(s, b.toHost) }
  catch (e) { return reply.code(502).send({ error: 'hôte injoignable : ' + e.message }) }
  try {
    const st = await pf(src.sftp.stat.bind(src.sftp), fromPath)
    let destPath = posix.join(toDir, posix.basename(fromPath))
    const exists = await pf(dst.sftp.stat.bind(dst.sftp), destPath).then(() => true).catch(() => false)
    if (exists) destPath = destPath + '-' + Date.now().toString(36)
    if (st.isDirectory()) await transferDir(src.sftp, fromPath, dst.sftp, destPath)
    else await transferFile(src.sftp, fromPath, dst.sftp, destPath)
    if (mode === 'move') {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      const trash = posix.join(src.home, '.hublo-trash', id)
      await sshRun(src.conn, `mkdir -p ${shq(trash)} && printf '%s' ${shq(fromPath)} > ${shq(trash + '/.origpath')} && mv -- ${shq(fromPath)} ${shq(trash + '/')}`)
    }
    audit(req, s.username, 'transfer', `${b.fromHost || 'local'}:${fromPath} -> ${b.toHost || 'local'}:${destPath} (${mode})`)
    return { ok: true, name: posix.basename(destPath) }
  } catch (e) { return reply.code(400).send({ error: 'Transfert impossible : ' + e.message }) }
})

// infos détaillées (stat) d'un élément
app.get('/api/fs/info', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const path = safePath(req.query.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  const r = await sshRun(t.conn, `stat -c '%s|%Y|%a|%A|%U|%G|%F' -- ${shq(path)}`)
  if (r.code !== 0) return reply.code(400).send({ error: 'Infos indisponibles' })
  const [size, mtime, octal, perms, owner, group, ftype] = r.out.trim().split('|')
  return { name: posix.basename(path), path, size: Number(size), mtime: Number(mtime) * 1000, octal, perms, owner, group, ftype }
})

// usage disque : taille (du) de chaque enfant du dossier, trié desc + df
app.get('/api/fs/du', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const dir = safePath(req.query.path || t.home)
  if (!dir) return reply.code(400).send({ error: 'chemin invalide' })
  const script = 'cd "$1" 2>/dev/null || exit 0; for f in * .[!.]*; do [ -e "$f" ] || continue; sz=$(du -sb -- "$f" 2>/dev/null | cut -f1); ty=$([ -d "$f" ] && echo d || echo f); printf "%s\\t%s\\t%s\\n" "$sz" "$ty" "$f"; done | sort -rn | head -n 200'
  const out = await sshExec(t.conn, `timeout 120 sh -c ${shq(script)} _ ${shq(dir)}`)
  const entries = out.trim().split('\n').filter(Boolean).map(l => {
    const p = l.split('\t')
    return { size: Number(p[0]) || 0, type: p[1] === 'd' ? 'dir' : 'file', name: p.slice(2).join('\t') }
  }).filter(e => e.name)
  const dfOut = await sshExec(t.conn, `df -B1 -P ${shq(dir)} | awk 'NR==2{print $2,$3,$4}'`)
  const df = dfOut.trim().split(/\s+/).map(Number)
  const total = entries.reduce((a, e) => a + e.size, 0)
  return { path: dir, parent: dir === '/' ? null : posix.dirname(dir), entries, total, df: { total: df[0] || 0, used: df[1] || 0, avail: df[2] || 0 } }
})

// chmod
app.post('/api/fs/chmod', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const path = safePath(req.body?.path)
  const mode = String(req.body?.mode || '')
  if (!path || !/^[0-7]{3,4}$/.test(mode)) return reply.code(400).send({ error: 'paramètres invalides' })
  const r = await sshRun(t.conn, `chmod ${shq(mode)} -- ${shq(path)}`)
  if (r.code !== 0) return reply.code(400).send({ error: 'Modification des droits impossible : ' + (r.err || '').trim() })
  audit(req, s.username, 'chmod', mode + ' ' + path)
  return { ok: true }
})

// ===== Gestion des hôtes (lecteurs réseau) — stockés dans ~/.hublo =====
app.get('/api/hosts/list', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const hosts = await readHosts(s)
  return { hosts: hosts.map(h => ({ id: h.id, label: h.label, host: h.host, port: h.port, user: h.user, auth: h.auth })) }
})

app.post('/api/hosts/save', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const b = req.body || {}
  const host = String(b.host || '').trim()
  const user = String(b.user || '').trim()
  const port = Number(b.port) || 22
  const auth = b.auth === 'password' ? 'password' : 'key'
  const label = String(b.label || host).trim()
  if (!host || !user) return reply.code(400).send({ error: 'Hôte et utilisateur requis.' })
  const hosts = await readHosts(s)
  let entry = (b.id && hosts.find(h => h.id === b.id)) || null
  if (!entry) { entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }; hosts.push(entry) }
  Object.assign(entry, { label, host, port, user, auth })
  if (auth === 'password') {
    if (b.password != null) entry.password = String(b.password)
    if (entry.keyName) { await sshRun(s.conn, `rm -f ${shq(posix.join(hubloDir(s), 'keys', entry.keyName))}`); delete entry.keyName }
  } else {
    if (b.privateKey) {
      const keyName = entry.id + '.key'
      const kdir = posix.join(hubloDir(s), 'keys')
      await sshRun(s.conn, `mkdir -p ${shq(kdir)} && chmod 700 ${shq(kdir)}`)
      await pf(s.sftp.writeFile.bind(s.sftp), posix.join(kdir, keyName), String(b.privateKey))
      await sshRun(s.conn, `chmod 600 ${shq(posix.join(kdir, keyName))}`)
      entry.keyName = keyName
    }
    delete entry.password
  }
  await writeHosts(s, hosts)
  if (s.remotes && s.remotes[entry.id]) { try { s.remotes[entry.id].conn.end() } catch {} delete s.remotes[entry.id] }
  audit(req, s.username, 'host-save', entry.id + ' ' + user + '@' + host)
  return { ok: true, id: entry.id }
})

app.post('/api/hosts/delete', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const id = String(req.body?.id || '')
  const hosts = await readHosts(s)
  const entry = hosts.find(h => h.id === id)
  if (entry?.keyName) await sshRun(s.conn, `rm -f ${shq(posix.join(hubloDir(s), 'keys', entry.keyName))}`)
  await writeHosts(s, hosts.filter(h => h.id !== id))
  if (s.remotes && s.remotes[id]) { try { s.remotes[id].conn.end() } catch {} delete s.remotes[id] }
  audit(req, s.username, 'host-delete', id)
  return { ok: true }
})

app.post('/api/hosts/test', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  try { const r = await ensureRemote(s, String(req.body?.id || '')); return { ok: true, home: r.home } }
  catch (e) { return reply.code(400).send({ error: e.message }) }
})

// ===== Client base de données (Postgres) =====
app.get('/api/db/list', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const c = await readDbConns(s)
  return { conns: c.map(x => ({ id: x.id, label: x.label, host: x.host, port: x.port, database: x.database, user: x.user })) }
})

app.post('/api/db/save', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const b = req.body || {}
  const host = String(b.host || '127.0.0.1').trim(), database = String(b.database || '').trim(), user = String(b.user || '').trim()
  const port = Number(b.port) || 5432
  const label = String(b.label || database).trim()
  if (!database || !user) return reply.code(400).send({ error: 'database et user requis' })
  const conns = await readDbConns(s)
  let entry = (b.id && conns.find(x => x.id === b.id)) || null
  if (!entry) { entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }; conns.push(entry) }
  Object.assign(entry, { label, host, port, database, user })
  if (b.password != null && b.password !== '') entry.password = String(b.password)
  await writeDbConns(s, conns)
  dropPool(entry.id)   // credentials peut-être modifiés → forcer un nouveau pool
  audit(req, s.username, 'db-save', entry.id + ' ' + user + '@' + host + '/' + database)
  return { ok: true, id: entry.id }
})

app.post('/api/db/delete', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const id = String(req.body?.id || '')
  await writeDbConns(s, (await readDbConns(s)).filter(x => x.id !== id))
  dropPool(id)
  audit(req, s.username, 'db-delete', id)
  return { ok: true }
})

async function dbCfg (s, id) { return (await readDbConns(s)).find(x => x.id === id) }

app.post('/api/db/test', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const cfg = await dbCfg(s, String(req.body?.id || ''))
  if (!cfg) return reply.code(404).send({ error: 'connexion inconnue' })
  try { const r = await pgRun(cfg, 'SELECT version()'); return { ok: true, version: r.rows[0].version } }
  catch (e) { return reply.code(400).send({ error: e.message }) }
})

app.get('/api/db/tables', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const cfg = await dbCfg(s, String(req.query.conn || ''))
  if (!cfg) return reply.code(404).send({ error: 'connexion inconnue' })
  try {
    const r = await pgRun(cfg, "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name")
    return { tables: r.rows.map(x => ({ schema: x.table_schema, name: x.table_name })) }
  } catch (e) { return reply.code(400).send({ error: e.message }) }
})

app.post('/api/db/query', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const cfg = await dbCfg(s, String(req.body?.conn || ''))
  if (!cfg) return reply.code(404).send({ error: 'connexion inconnue' })
  const sql = String(req.body?.sql || '').trim()
  if (!sql) return reply.code(400).send({ error: 'requête vide' })
  try {
    const res = await pgRun(cfg, sql)
    const r = Array.isArray(res) ? res[res.length - 1] : res
    const columns = (r.fields || []).map(f => f.name)
    const rows = (r.rows || []).slice(0, 1000).map(row => columns.map(c => {
      const v = row[c]
      return v === null ? null : (typeof v === 'object' ? JSON.stringify(v) : v)
    }))
    audit(req, s.username, 'db-query', cfg.database + ': ' + sql.slice(0, 80))
    return { columns, rows, rowCount: r.rowCount ?? rows.length, command: r.command || '', truncated: (r.rows || []).length > 1000 }
  } catch (e) { return reply.code(400).send({ error: e.message }) }
})

// ===== Client Git =====
app.get('/api/git/status', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const dir = safePath(req.query.path)
  if (!dir) return reply.code(400).send({ error: 'chemin invalide' })
  const r = await sshRun(t.conn, `git -C ${shq(dir)} status --porcelain -b 2>&1`)
  if (r.code !== 0) return { isRepo: false, message: (r.out || '').trim() }
  let branch = '', ahead = 0, behind = 0
  const staged = [], unstaged = [], untracked = []
  for (const ln of r.out.split('\n')) {
    if (ln.startsWith('## ')) {
      const m = ln.slice(3)
      branch = m.split('...')[0].split(' ')[0]
      const am = m.match(/ahead (\d+)/); if (am) ahead = +am[1]
      const bm = m.match(/behind (\d+)/); if (bm) behind = +bm[1]
      continue
    }
    if (ln.length < 4) continue
    const x = ln[0], y = ln[1], p = ln.slice(3)
    if (x === '?' && y === '?') { untracked.push(p); continue }
    if (x !== ' ' && x !== '?') staged.push({ path: p, st: x })
    if (y !== ' ' && y !== '?') unstaged.push({ path: p, st: y })
  }
  return { isRepo: true, branch, ahead, behind, staged, unstaged, untracked }
})

app.get('/api/git/log', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const dir = safePath(req.query.path); if (!dir) return reply.code(400).send({ error: 'chemin invalide' })
  const r = await sshRun(t.conn, `git -C ${shq(dir)} log --max-count=40 --pretty=format:'%h%x1f%an%x1f%ar%x1f%s' 2>&1`)
  if (r.code !== 0) return { commits: [] }
  const commits = r.out.split('\n').filter(Boolean).map(l => { const p = l.split('\x1f'); return { hash: p[0], author: p[1], when: p[2], subject: p[3] || '' } })
  return { commits }
})

app.get('/api/git/diff', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let t; try { t = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const dir = safePath(req.query.path); if (!dir) return reply.code(400).send({ error: 'chemin invalide' })
  const file = String(req.query.file || '')
  const mode = req.query.mode
  let cmd
  if (mode === 'staged') cmd = `git -C ${shq(dir)} diff --cached -- ${shq(file)} 2>&1`
  else if (mode === 'untracked') cmd = `git -C ${shq(dir)} diff --no-index -- /dev/null ${shq(file)} 2>&1`
  else cmd = `git -C ${shq(dir)} diff -- ${shq(file)} 2>&1`
  const r = await sshRun(t.conn, cmd)
  return { diff: r.out }
})

async function gitWrite (s, req, reply, build, action) {
  let t; try { t = await resolveTarget(s, req.body?.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const dir = safePath(req.body?.path); if (!dir) return reply.code(400).send({ error: 'chemin invalide' })
  const r = await sshRun(t.conn, build(dir, shq))
  audit(req, s.username, 'git-' + action, dir)
  if (r.code !== 0) return reply.code(400).send({ error: (r.out || r.err || '').trim() || 'échec', output: r.out })
  return { ok: true, output: r.out }
}
app.post('/api/git/stage', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const file = String(req.body?.file || '')
  return gitWrite(s, req, reply, (dir, q) => file ? `git -C ${q(dir)} add -- ${q(file)} 2>&1` : `git -C ${q(dir)} add -A 2>&1`, 'stage')
})
app.post('/api/git/unstage', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const file = String(req.body?.file || '')
  return gitWrite(s, req, reply, (dir, q) => file ? `git -C ${q(dir)} restore --staged -- ${q(file)} 2>&1` : `git -C ${q(dir)} reset -q 2>&1`, 'unstage')
})
app.post('/api/git/commit', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const msg = String(req.body?.message || '').trim()
  if (!msg) return reply.code(400).send({ error: 'message requis' })
  return gitWrite(s, req, reply, (dir, q) => `git -C ${q(dir)} commit -m ${q(msg)} 2>&1`, 'commit')
})
app.post('/api/git/pull', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  return gitWrite(s, req, reply, (dir, q) => `timeout 90 git -C ${q(dir)} pull 2>&1`, 'pull')
})
app.post('/api/git/push', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  return gitWrite(s, req, reply, (dir, q) => `timeout 90 git -C ${q(dir)} push 2>&1`, 'push')
})

// ---------- PROCESS (exec d'une commande EN DUR) ----------
app.get('/api/ps', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const out = await new Promise((res) => {
    s.conn.exec('ps -eo pid,user,pcpu,pmem,rss,comm --sort=-pcpu | head -n 41', (err, stream) => {
      if (err) return res('')
      let data = ''
      stream.on('data', d => { data += d }).on('close', () => res(data))
    })
  })
  const lines = out.trim().split('\n')
  const rows = lines.slice(1).map(l => {
    const m = l.trim().split(/\s+/)
    return { pid: m[0], user: m[1], cpu: m[2], mem: m[3], rss: m[4], comm: m.slice(5).join(' ') }
  })
  return { rows }
})

// ---------- INFOS SYSTÈME ----------
app.get('/api/sysinfo', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const cmd = `echo "HOST:$(hostname)"; echo "OS:$(. /etc/os-release 2>/dev/null; echo $PRETTY_NAME)"; echo "KERNEL:$(uname -r)"; echo "UPTIME:$(uptime -p)"; echo "LOAD:$(cut -d' ' -f1-3 /proc/loadavg)"; echo "CPU:$(nproc)"; echo "MEM:$(free -b | awk '/^Mem:/{print $2,$3,$7}')"; echo "DISK:$(df -B1 -P "$HOME" | awk 'NR==2{print $2,$3,$4}')"`
  const out = await sshExec(s.conn, cmd)
  const m = {}
  out.trim().split('\n').forEach(l => { const i = l.indexOf(':'); if (i > 0) m[l.slice(0, i)] = l.slice(i + 1).trim() })
  const mem = (m.MEM || '').split(/\s+/).map(Number)
  const disk = (m.DISK || '').split(/\s+/).map(Number)
  return {
    host: m.HOST || '', os: m.OS || '', kernel: m.KERNEL || '',
    uptime: m.UPTIME || '', load: m.LOAD || '', cpu: Number(m.CPU || 0),
    mem: { total: mem[0] || 0, used: mem[1] || 0, avail: mem[2] || 0 },
    disk: { total: disk[0] || 0, used: disk[1] || 0, avail: disk[2] || 0 },
    user: s.username
  }
})

// ---------- RECHERCHE DE FICHIERS ----------
app.get('/api/fs/search', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  let tg; try { tg = await resolveTarget(s, req.query.host) } catch (e) { return reply.code(502).send({ error: 'hôte injoignable' }) }
  const dir = safePath(req.query.path || tg.home)
  const q = String(req.query.q || '').replace(/[^\w.\- ]/g, '').trim()
  if (!dir || q.length < 2) return { entries: [] }
  const cmd = `find ${shq(dir)} -maxdepth 4 -iname ${shq('*' + q + '*')} -not -path '*/.*' -printf '%y\\t%p\\n' 2>/dev/null | head -n 200`
  const out = await sshExec(tg.conn, cmd)
  const entries = out.trim().split('\n').filter(Boolean).map(l => {
    const tab = l.indexOf('\t'); if (tab < 0) return null
    const t = l.slice(0, tab), p = l.slice(tab + 1)
    return { name: posix.basename(p), path: p, type: t === 'd' ? 'dir' : (t === 'l' ? 'link' : 'file') }
  }).filter(e => e && e.path && e.path !== dir)
  return { entries }
})

// ---------- TERMINAL (WebSocket → PTY) ----------
app.get('/ws/terminal', { websocket: true }, (socket, req) => {
  const ws = socket.socket || socket
  const s = getSession(req)
  if (!s) { try { ws.close(4001, 'non connecte') } catch {} ; return }

  let stream = null
  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      const txt = data.toString()
      try {
        const msg = JSON.parse(txt)
        if (msg && msg.type === 'init') {
          s.conn.shell({ term: 'xterm-256color', cols: msg.cols || 80, rows: msg.rows || 24 }, (err, st) => {
            if (err) { try { ws.send('\r\n[hublo] impossible d\'ouvrir le shell: ' + err.message + '\r\n'); ws.close() } catch {} ; return }
            stream = st
            stream.on('data', d => { try { ws.send(d) } catch {} })
            stream.on('close', () => { try { ws.close() } catch {} })
          })
          return
        }
        if (msg && msg.type === 'resize' && stream) { stream.setWindow(msg.rows, msg.cols, 0, 0); return }
      } catch {}
      if (stream) stream.write(txt)
    } else if (stream) {
      stream.write(data)
    }
  })
  ws.on('close', () => { try { stream && stream.end() } catch {} })
})

// ---------- LOGS (suivi tail -F / journalctl -f en direct) ----------
app.get('/ws/logtail', { websocket: true }, async (socket, req) => {
  const ws = socket.socket || socket
  const s = getSession(req)
  if (!s) { try { ws.close(4001) } catch {} ; return }
  let t
  try { t = await resolveTarget(s, req.query.host) } catch (e) { try { ws.send('[hublo] hôte injoignable\n'); ws.close() } catch {} ; return }
  const source = req.query.source
  const path = safePath(req.query.path || '')
  let inner
  if (source === 'journal-user') inner = 'journalctl --user -n 300 -f --no-pager 2>&1'
  else if (source === 'journal-system') inner = 'journalctl -n 300 -f --no-pager 2>&1'
  else if (path) inner = 'tail -n 300 -F -- "$1" 2>&1'
  else { try { ws.send('[hublo] aucune source de log\n'); ws.close() } catch {} ; return }
  // le `cat >/dev/null` lit stdin : à la fermeture du WS on envoie EOF → cat sort → kill du tail/journalctl (pas d'orphelin)
  const script = `${inner} & P=$!; cat >/dev/null; kill $P 2>/dev/null`
  const cmd = `sh -c ${shq(script)} _ ${shq(path || '/dev/null')}`
  audit(req, s.username, 'logtail', source || path)
  t.conn.exec(cmd, (err, stream) => {
    if (err) { try { ws.send('[hublo] ' + err.message); ws.close() } catch {} ; return }
    stream.on('data', d => { try { ws.send(d.toString()) } catch {} })
    stream.stderr && stream.stderr.on('data', d => { try { ws.send(d.toString()) } catch {} })
    stream.on('close', () => { try { ws.close() } catch {} })
    ws.on('close', () => { try { stream.end() } catch {} })
  })
})

// ---------- balayage des sessions inactives ----------
setInterval(() => {
  const now = Date.now()
  for (const [t, s] of sessions) if (now - s.lastActive > IDLE_MS) closeSession(t)
}, 60 * 1000)

app.listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`Hublo gateway sur http://${HOST}:${PORT}`))
  .catch(e => { console.error(e); process.exit(1) })
