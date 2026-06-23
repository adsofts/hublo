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
await app.register(fastifyStatic, { root: join(__dirname, 'public'), prefix: '/' })

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
  try {
    const st = await pf(s.sftp.stat.bind(s.sftp), path)
    if (st.isDirectory()) await pf(s.sftp.rmdir.bind(s.sftp), path)
    else await pf(s.sftp.unlink.bind(s.sftp), path)
    audit(req, s.username, 'delete', path)
    return { ok: true }
  } catch (e) { return reply.code(400).send({ error: 'Suppression impossible : ' + e.message + ' (dossier non vide ?)' }) }
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
  reply.header('Content-Disposition', `attachment; filename="${name}"`)
  reply.header('Content-Type', 'application/octet-stream')
  return reply.send(s.sftp.createReadStream(path))
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
