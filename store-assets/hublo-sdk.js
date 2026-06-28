// hublo-sdk.js — client SDK for Hublo apps.
//
// A Hublo app runs inside a sandboxed <iframe> (opaque origin, no network of its
// own). It CANNOT touch the host directly. Everything goes through this SDK, which
// speaks to the Hublo host over a postMessage bridge. The host checks every call
// against the permissions the user granted at install time, then performs the real
// action (as the user's Unix account, over SSH) and returns the result.
//
// Target: Hublo SDK v1. Import it in your app entry:
//
//   import hublo, { http, ui } from './hublo-sdk.js'
//   const ctx = await hublo.ready()          // { theme, locale, grants, app }
//   const res = await http.request({ method:'GET', url:'https://example.com' })
//   ui.toast('done')

const HOST = window.parent
let _seq = 0
const _pending = new Map()
const _listeners = new Map()

function call (capability, method, args) {
  return new Promise((resolve, reject) => {
    const id = ++_seq
    _pending.set(id, { resolve, reject })
    HOST.postMessage({ hublo: 1, id, type: 'call', capability, method, args: args || {} }, '*')
  })
}

window.addEventListener('message', (e) => {
  const m = e.data
  if (!m || m.hublo !== 1) return
  if (m.type === 'result') {
    const p = _pending.get(m.id); if (!p) return
    _pending.delete(m.id)
    m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || 'hublo: bridge error'))
  } else if (m.type === 'event') {
    for (const fn of (_listeners.get(m.name) || [])) { try { fn(m.payload) } catch { /* */ } }
  }
})

// --- lifecycle & host events -------------------------------------------------
// Call once on startup. Resolves with the runtime context and tells the host the
// app is mounted. Events: 'theme' ({theme}), 'resize' ({w,h}), 'focus', 'blur'.
export function ready () { return call('core', 'ready', {}) }
export function on (name, fn) { const a = _listeners.get(name) || []; a.push(fn); _listeners.set(name, a) }
export function off (name, fn) { _listeners.set(name, (_listeners.get(name) || []).filter(x => x !== fn)) }

// --- capability-gated namespaces --------------------------------------------
// Each requires the matching capability in your manifest; otherwise the call rejects.
export const fs = {
  list:  (path)          => call('fs.read',  'list',  { path }),   // -> [{name,type,size,mtime}]
  read:  (path)          => call('fs.read',  'read',  { path }),   // -> string
  write: (path, content) => call('fs.write', 'write', { path, content })
}
export const http = { request: (opts) => call('http', 'request', opts) } // {method,url,headers,body} -> {status,headers,body,...}
export const db = {
  connections:      ()          => call('db', 'connections', {}),       // -> [{id,label,host,port,database,user}] (no passwords)
  tables:           (conn)      => call('db', 'tables', { conn }),       // -> [{schema,name}]
  test:             (conn)      => call('db', 'test', { conn }),         // -> {version}
  query:            (conn, sql) => call('db', 'query', { conn, sql }),   // -> {columns,rows,rowCount,command,truncated}
  saveConnection:   (cfg)       => call('db', 'save', { cfg }),          // {label,host,port,database,user,password?} -> {id}
  deleteConnection: (conn)      => call('db', 'delete', { conn })
}

// host.pick is user-mediated: it opens a Hublo file/dir picker and returns ONLY
// what the user explicitly chose — the safe way to widen file access.
export const host = { pick: (opts = {}) => call('host.pick', 'pick', opts) } // {type:'file'|'dir'} -> path|null

// storage is app-private (no permission needed): a small KV store scoped to your app.
export const storage = {
  get:    (key)        => call('storage', 'get',    { key }),
  set:    (key, value) => call('storage', 'set',    { key, value }),
  remove: (key)        => call('storage', 'remove', { key })
}

export const ui = {
  toast:    (message)  => call('notify', 'toast', { message }),
  setTitle: (title)    => call('core', 'setTitle', { title }),
  clipboard: {
    write: (text) => call('clipboard', 'write', { text }),
    read:  ()     => call('clipboard', 'read', {})
  }
}

export default { ready, on, off, fs, http, db, host, storage, ui }
