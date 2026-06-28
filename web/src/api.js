// Hublo — client API. Cookie de session httpOnly, même origine.

async function post (url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body || {})
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || ('Erreur ' + r.status))
  return d
}

async function get (url) {
  const r = await fetch(url, { credentials: 'same-origin' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || ('Erreur ' + r.status))
  return d
}

const hq = h => (h ? '&host=' + encodeURIComponent(h) : '')

export const api = {
  post,
  get,
  // auth
  me () { return get('/api/me') },
  login (username, password) { return post('/api/login', { username, password }) },
  logout () { return post('/api/logout') },
  // fs
  list (path, host) {
    const q = []
    if (path) q.push('path=' + encodeURIComponent(path))
    if (host) q.push('host=' + encodeURIComponent(host))
    return get('/api/fs/list?' + q.join('&'))
  },
  read (path, host) { return get('/api/fs/read?path=' + encodeURIComponent(path) + hq(host)) },
  write (path, content, host) { return post('/api/fs/write', { path, content, host }) },
  mkdir (path, host) { return post('/api/fs/mkdir', { path, host }) },
  rename (from, to, host) { return post('/api/fs/rename', { from, to, host }) },
  remove (path, host) { return post('/api/fs/delete', { path, host }) },
  ps () { return get('/api/ps') },
  sysinfo () { return get('/api/sysinfo') },
  search (path, q, host) { return get('/api/fs/search?path=' + encodeURIComponent(path) + '&q=' + encodeURIComponent(q) + hq(host)) },
  downloadUrl (path, host) { return '/api/fs/download?path=' + encodeURIComponent(path) + hq(host) },
  rawUrl (path, host) { return '/api/fs/download?path=' + encodeURIComponent(path) + '&inline=1' + hq(host) },
  compress (path, host) { return post('/api/fs/compress', { path, host }) },
  extract (path, host) { return post('/api/fs/extract', { path, host }) },
  copy (from, to, host) { return post('/api/fs/copy', { from, to, host }) },
  transfer (fromHost, fromPath, toHost, toDir, mode) { return post('/api/fs/transfer', { fromHost, fromPath, toHost, toDir, mode }) },
  info (path, host) { return get('/api/fs/info?path=' + encodeURIComponent(path) + hq(host)) },
  du (path, host) {
    const q = []
    if (path) q.push('path=' + encodeURIComponent(path))
    if (host) q.push('host=' + encodeURIComponent(host))
    return get('/api/fs/du?' + q.join('&'))
  },
  chmod (path, mode, host) { return post('/api/fs/chmod', { path, mode, host }) },
  hostsList () { return get('/api/hosts/list') },
  hostSave (h) { return post('/api/hosts/save', h) },
  hostDelete (id) { return post('/api/hosts/delete', { id }) },
  hostTest (id) { return post('/api/hosts/test', { id }) },
  dbList () { return get('/api/db/list') },
  dbSave (c) { return post('/api/db/save', c) },
  dbDelete (id) { return post('/api/db/delete', { id }) },
  dbTest (id) { return post('/api/db/test', { id }) },
  dbTables (conn) { return get('/api/db/tables?conn=' + encodeURIComponent(conn)) },
  dbQuery (conn, sql) { return post('/api/db/query', { conn, sql }) },
  gitStatus (path, host) { return get('/api/git/status?path=' + encodeURIComponent(path) + hq(host)) },
  gitLog (path, host) { return get('/api/git/log?path=' + encodeURIComponent(path) + hq(host)) },
  gitDiff (path, file, mode, host) { return get('/api/git/diff?path=' + encodeURIComponent(path) + '&file=' + encodeURIComponent(file) + '&mode=' + encodeURIComponent(mode) + hq(host)) },
  gitStage (path, file, host) { return post('/api/git/stage', { path, file, host }) },
  gitUnstage (path, file, host) { return post('/api/git/unstage', { path, file, host }) },
  gitCommit (path, message, host) { return post('/api/git/commit', { path, message, host }) },
  gitPull (path, host) { return post('/api/git/pull', { path, host }) },
  gitPush (path, host) { return post('/api/git/push', { path, host }) },
  trashList (host) { return get('/api/trash/list' + (host ? '?host=' + encodeURIComponent(host) : '')) },
  trashRestore (id, host) { return post('/api/trash/restore', { id, host }) },
  trashEmpty (host) { return post('/api/trash/empty', { host }) },
  httpRequest (payload) { return post('/api/http/request', payload) },
  async upload (file, destDir, host) {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch('/api/fs/upload?path=' + encodeURIComponent(destDir) + hq(host), {
      method: 'POST',
      credentials: 'same-origin',
      body: fd
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error || 'import')
    return d
  }
}

// ---- helpers chemins / fichiers ----
export function join (dir, name) { return (dir === '/' ? '' : dir) + '/' + name }
export function baseName (p) { return p.split('/').pop() }
export function fmtSize (n) {
  if (n < 1024) return n + ' o'
  if (n < 1048576) return (n / 1024).toFixed(1) + ' Ko'
  return (n / 1048576).toFixed(1) + ' Mo'
}
export function isImage (n) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']
    .includes((n.split('.').pop() || '').toLowerCase())
}
export function isPdf (n) { return (n.split('.').pop() || '').toLowerCase() === 'pdf' }
export function isArchive (n) {
  const l = n.toLowerCase()
  return l.endsWith('.zip') || l.endsWith('.tar.gz') || l.endsWith('.tgz') || l.endsWith('.tar')
}
export function icoFor (e) {
  if (e.type === 'dir') return '📁'
  if (e.type === 'link') return '🔗'
  const x = (e.name.split('.').pop() || '').toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(x)) return '🖼️'
  if (['mp3', 'wav', 'flac', 'ogg'].includes(x)) return '🎵'
  if (['mp4', 'mov', 'mkv', 'webm'].includes(x)) return '🎬'
  if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(x)) return '🗜️'
  if (['pdf'].includes(x)) return '📕'
  if (['js', 'ts', 'vue', 'php', 'py', 'sh', 'json', 'html', 'css', 'c', 'cpp', 'go', 'rs', 'md', 'conf', 'yml', 'yaml'].includes(x)) return '📜'
  return '📄'
}
