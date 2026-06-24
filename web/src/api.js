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

export const api = {
  post,
  get,
  // auth
  me () { return get('/api/me') },
  login (username, password) { return post('/api/login', { username, password }) },
  logout () { return post('/api/logout') },
  // fs
  list (path) { return get('/api/fs/list?path=' + encodeURIComponent(path)) },
  read (path) { return get('/api/fs/read?path=' + encodeURIComponent(path)) },
  write (path, content) { return post('/api/fs/write', { path, content }) },
  mkdir (path) { return post('/api/fs/mkdir', { path }) },
  rename (from, to) { return post('/api/fs/rename', { from, to }) },
  remove (path) { return post('/api/fs/delete', { path }) },
  ps () { return get('/api/ps') },
  sysinfo () { return get('/api/sysinfo') },
  search (path, q) { return get('/api/fs/search?path=' + encodeURIComponent(path) + '&q=' + encodeURIComponent(q)) },
  downloadUrl (path) { return '/api/fs/download?path=' + encodeURIComponent(path) },
  rawUrl (path) { return '/api/fs/download?path=' + encodeURIComponent(path) + '&inline=1' },
  compress (path) { return post('/api/fs/compress', { path }) },
  extract (path) { return post('/api/fs/extract', { path }) },
  copy (from, to) { return post('/api/fs/copy', { from, to }) },
  info (path) { return get('/api/fs/info?path=' + encodeURIComponent(path)) },
  chmod (path, mode) { return post('/api/fs/chmod', { path, mode }) },
  trashList () { return get('/api/trash/list') },
  trashRestore (id) { return post('/api/trash/restore', { id }) },
  trashEmpty () { return post('/api/trash/empty') },
  async upload (file, destDir) {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fetch('/api/fs/upload?path=' + encodeURIComponent(destDir), {
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
