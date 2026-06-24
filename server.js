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
import { randomBytes } from 'node:crypto'
import { appendFile, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, posix } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787
const HOST = '127.0.0.1'
const SSH_HOST = '127.0.0.1'
const SSH_PORT = 22
const COOKIE = 'hublo_sess'
const IDLE_MS = 30 * 60 * 1000          // 30 min d'inactivité → on ferme la session SSH
const MAX_READ = 2 * 1024 * 1024        // 2 Mo max pour ouvrir un fichier dans l'éditeur
// Allowlist : seuls ces comptes Unix peuvent se connecter (refus avant toute tentative SSH).
const ALLOWED = (process.env.HUBLO_ALLOWED || 'erwan,siwei').split(',').map(s => s.trim()).filter(Boolean)

// ---- sessions en mémoire : token -> { username, conn, sftp, lastActive, ip } ----
const sessions = new Map()
// ---- rate-limit login basique : ip -> { fails, until } ----
const loginGuard = new Map()

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
  if (s) { try { s.conn.end() } catch {} sessions.delete(token) }
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
  return s
}

app.get('/api/fs/list', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const path = safePath(req.query.path || s.home)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  try {
    const list = await pf(s.sftp.readdir.bind(s.sftp), path)
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
  const path = safePath(req.query.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  try {
    const st = await pf(s.sftp.stat.bind(s.sftp), path)
    if (st.size > MAX_READ) return reply.code(413).send({ error: 'Fichier trop gros pour l’éditeur (> 2 Mo).' })
    const buf = await pf(s.sftp.readFile.bind(s.sftp), path)
    return { path, content: buf.toString('utf8'), size: st.size }
  } catch (e) {
    return reply.code(400).send({ error: 'Ouverture impossible : ' + e.message })
  }
})

app.post('/api/fs/write', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const path = safePath(req.body?.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  try {
    await pf(s.sftp.writeFile.bind(s.sftp), path, req.body.content ?? '')
    audit(req, s.username, 'write', path)
    return { ok: true }
  } catch (e) { return reply.code(400).send({ error: 'Écriture impossible : ' + e.message }) }
})

app.post('/api/fs/mkdir', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const path = safePath(req.body?.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  try { await pf(s.sftp.mkdir.bind(s.sftp), path); audit(req, s.username, 'mkdir', path); return { ok: true } }
  catch (e) { return reply.code(400).send({ error: 'Création impossible : ' + e.message }) }
})

app.post('/api/fs/rename', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const from = safePath(req.body?.from), to = safePath(req.body?.to)
  if (!from || !to) return reply.code(400).send({ error: 'chemin invalide' })
  try { await pf(s.sftp.rename.bind(s.sftp), from, to); audit(req, s.username, 'rename', from + ' → ' + to); return { ok: true } }
  catch (e) { return reply.code(400).send({ error: 'Renommage impossible : ' + e.message }) }
})

app.post('/api/fs/delete', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const path = safePath(req.body?.path)
  if (!path || path === '/' || path === s.home) return reply.code(400).send({ error: 'chemin invalide' })
  if (path.startsWith(posix.join(s.home, '.hublo-trash'))) return reply.code(400).send({ error: 'déjà dans la corbeille' })
  // mise à la corbeille (déplacement vers ~/.hublo-trash/<id>/ + mémo du chemin d'origine)
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const dir = posix.join(s.home, '.hublo-trash', id)
  const r = await sshRun(s.conn, `mkdir -p ${shq(dir)} && printf '%s' ${shq(path)} > ${shq(dir + '/.origpath')} && mv -- ${shq(path)} ${shq(dir + '/')}`)
  if (r.code !== 0) return reply.code(400).send({ error: 'Mise à la corbeille impossible : ' + (r.err || '').trim() })
  audit(req, s.username, 'trash', path)
  return { ok: true }
})

// upload (multipart) : dépose le(s) fichier(s) dans le dossier `path`
app.post('/api/fs/upload', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const dir = safePath(req.query.path)
  if (!dir) return reply.code(400).send({ error: 'chemin invalide' })
  const data = await req.file()
  if (!data) return reply.code(400).send({ error: 'aucun fichier' })
  const dest = posix.join(dir, posix.basename(data.filename))
  try {
    await new Promise((res, rej) => {
      const ws = s.sftp.createWriteStream(dest)
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
  const path = safePath(req.query.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  const name = posix.basename(path).replace(/["\\]/g, '')
  const inline = req.query.inline === '1'
  reply.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`)
  reply.header('Content-Type', inline ? mimeFor(name) : 'application/octet-stream')
  return reply.send(s.sftp.createReadStream(path))
})

// ---------- CORBEILLE ----------
app.get('/api/trash/list', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const base = posix.join(s.home, '.hublo-trash')
  const cmd = `for d in ${shq(base)}/*/; do [ -d "$d" ] || continue; id=$(basename "$d"); orig=$(cat "$d/.origpath" 2>/dev/null); item=$(ls -A "$d" | grep -vx '.origpath' | head -1); printf '%s\\t%s\\t%s\\n' "$id" "$orig" "$item"; done`
  const out = await sshExec(s.conn, cmd)
  const items = out.trim().split('\n').filter(Boolean).map(l => {
    const p = l.split('\t')
    return { id: p[0], orig: p[1] || '', name: p[2] || '' }
  }).filter(x => x.id && x.name)
  return { items }
})

app.post('/api/trash/restore', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const id = String(req.body?.id || '')
  if (!/^[a-z0-9]+$/.test(id)) return reply.code(400).send({ error: 'id invalide' })
  const d = posix.join(s.home, '.hublo-trash', id)
  const cmd = `d=${shq(d)}; orig=$(cat "$d/.origpath" 2>/dev/null); [ -z "$orig" ] && exit 3; item=$(ls -A "$d" | grep -vx '.origpath' | head -1); [ -z "$item" ] && exit 4; target="$orig"; [ -e "$target" ] && target="$orig-restauré-$(date +%s)"; mv -- "$d/$item" "$target" && rm -rf "$d" && printf '%s' "$target"`
  const r = await sshRun(s.conn, cmd)
  if (r.code !== 0) return reply.code(400).send({ error: 'Restauration impossible' })
  audit(req, s.username, 'restore', r.out)
  return { ok: true, path: r.out }
})

app.post('/api/trash/empty', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const base = posix.join(s.home, '.hublo-trash')
  const r = await sshRun(s.conn, `rm -rf ${shq(base)} && mkdir -p ${shq(base)}`)
  if (r.code !== 0) return reply.code(400).send({ error: 'Vidage impossible' })
  audit(req, s.username, 'trash-empty', '')
  return { ok: true }
})

// ---------- ARCHIVES ----------
app.post('/api/fs/compress', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const path = safePath(req.body?.path)
  if (!path || path === '/' || path === s.home) return reply.code(400).send({ error: 'chemin invalide' })
  const dir = posix.dirname(path), base = posix.basename(path)
  const out = base + '.tar.gz'
  const r = await sshRun(s.conn, `cd ${shq(dir)} && tar -czf ${shq(out)} -- ${shq(base)}`)
  if (r.code !== 0) return reply.code(400).send({ error: 'Compression impossible : ' + (r.err || '').trim() })
  audit(req, s.username, 'compress', path)
  return { ok: true, name: out }
})

app.post('/api/fs/extract', async (req, reply) => {
  const s = requireSession(req, reply); if (!s) return
  const path = safePath(req.body?.path)
  if (!path) return reply.code(400).send({ error: 'chemin invalide' })
  const dir = posix.dirname(path), base = posix.basename(path), low = base.toLowerCase()
  let folder, tool
  if (low.endsWith('.zip')) {
    folder = base.replace(/\.zip$/i, ''); tool = `unzip -o -q ${shq(base)} -d "$f"`
  } else if (low.endsWith('.tar.gz') || low.endsWith('.tgz') || low.endsWith('.tar')) {
    folder = base.replace(/\.(tar\.gz|tgz|tar)$/i, ''); tool = `tar -xf ${shq(base)} -C "$f"`
  } else {
    return reply.code(400).send({ error: 'Format non géré (zip, tar.gz, tgz, tar)' })
  }
  const cmd = `cd ${shq(dir)} || exit 1; f=${shq(folder)}; [ -e "$f" ] && f="$f-extrait-$(date +%s)"; mkdir -p "$f" && ${tool}`
  const r = await sshRun(s.conn, cmd)
  if (r.code !== 0) return reply.code(400).send({ error: 'Extraction impossible : ' + (r.err || '').trim() })
  audit(req, s.username, 'extract', path)
  return { ok: true }
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
  const dir = safePath(req.query.path || s.home)
  const q = String(req.query.q || '').replace(/[^\w.\- ]/g, '').trim()
  if (!dir || q.length < 2) return { entries: [] }
  const cmd = `find ${shq(dir)} -maxdepth 4 -iname ${shq('*' + q + '*')} -not -path '*/.*' -printf '%y\\t%p\\n' 2>/dev/null | head -n 200`
  const out = await sshExec(s.conn, cmd)
  const entries = out.trim().split('\n').filter(Boolean).map(l => {
    const tab = l.indexOf('\t'); if (tab < 0) return null
    const t = l.slice(0, tab), p = l.slice(tab + 1)
    return { name: posix.basename(p), path: p, type: t === 'd' ? 'dir' : (t === 'l' ? 'link' : 'file') }
  }).filter(e => e && e.path && e.path !== dir)
  return { entries }
})

// ---------- TERMINAL (WebSocket → PTY) ----------
app.get('/ws/terminal', { websocket: true }, (socket, req) => {
  const ws = socket.socket || socket   // compat versions @fastify/websocket
  const s = getSession(req)
  if (!s) { try { ws.close(4001, 'non connecté') } catch {} ; return }

  s.conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
    if (err) { try { ws.send('\r\n[hublo] impossible d’ouvrir le shell: ' + err.message + '\r\n'); ws.close() } catch {} ; return }
    stream.on('data', d => { try { ws.send(d) } catch {} })
    stream.on('close', () => { try { ws.close() } catch {} })
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const txt = data.toString()
        try {
          const msg = JSON.parse(txt)
          if (msg && msg.type === 'resize') { stream.setWindow(msg.rows, msg.cols, 0, 0); return }
        } catch { /* pas du JSON → entrée terminal */ }
        stream.write(txt)
      } else {
        stream.write(data)
      }
    })
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
