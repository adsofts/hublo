<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useWindowsStore } from '../../stores/windows.js'
import { useToastStore } from '../../stores/toast.js'
import { useAppsStore } from '../../stores/apps.js'

const { t, locale } = useI18n()
const wp = defineProps({ winId: { type: Number, required: true } })
const windows = useWindowsStore()
const toast = useToastStore()
const apps = useAppsStore()
const win = computed(() => windows.byId(wp.winId))
const appId = computed(() => win.value?.app)

const iframe = ref(null)
const frameSrc = '/api/store/frame?id=' + encodeURIComponent(appId.value || '')
let grants = []
let themeObs = null

const ALWAYS = new Set(['core', 'notify', 'storage'])   // capacités sans permission requise
const curTheme = () => document.documentElement.dataset.theme || 'light'
let markReady
const hostReady = new Promise((r) => { markReady = r })   // résolu quand les grants sont chargés

// storage app-privé (localStorage namespacé côté hôte)
const sk = (k) => 'hublo.app.' + appId.value + '.' + k
function lsGet (k) { try { const v = localStorage.getItem(sk(k)); return v == null ? null : JSON.parse(v) } catch { return null } }
function lsSet (k, v) { try { localStorage.setItem(sk(k), JSON.stringify(v)) } catch { /* */ } }

// pont : exécute une requête de l'app contre les API de l'hôte, selon les permissions accordées
async function dispatch (m) {
  const cap = m.capability, a = m.args || {}
  if (!ALWAYS.has(cap) && !grants.includes(cap)) throw new Error('permission not granted: ' + cap)
  switch (cap + '.' + m.method) {
    case 'core.ready':    await hostReady; return { theme: curTheme(), locale: locale.value, grants, app: { id: appId.value, name: win.value?.title } }
    case 'core.setTitle': windows.setTitle(wp.winId, String(a.title || '')); return true
    case 'notify.toast':  toast.show(String(a.message || '')); return true
    case 'storage.get':   return lsGet(a.key)
    case 'storage.set':   lsSet(a.key, a.value); return true
    case 'storage.remove':localStorage.removeItem(sk(a.key)); return true
    case 'http.request':  return await api.httpRequest({ method: a.method, url: a.url, headers: a.headers, body: a.body, followRedirects: a.followRedirects })
    case 'fs.list':       return (await api.list(a.path)).entries
    case 'fs.read':       return (await api.read(a.path)).content
    case 'fs.write':      await api.write(a.path, a.content); return true
    case 'db.connections':return (await api.dbList()).conns
    case 'db.tables':     return (await api.dbTables(a.conn)).tables
    case 'db.test':       return await api.dbTest(a.conn)
    case 'db.query':      return await api.dbQuery(a.conn, a.sql)
    case 'db.save':       return await api.dbSave(a.cfg)
    case 'db.delete':     await api.dbDelete(a.conn); return true
    case 'host.pick': {   const p = window.prompt(t('store.pickPrompt', { type: a.type || 'file' })); return p ? p.trim() : null }
    default: throw new Error('unknown method: ' + cap + '.' + m.method)
  }
}

function onMessage (e) {
  if (!iframe.value || e.source !== iframe.value.contentWindow) return  // n'accepte QUE notre iframe
  const m = e.data
  if (!m || m.hublo !== 1 || m.type !== 'call') return
  dispatch(m).then(
    (data) => post({ hublo: 1, id: m.id, type: 'result', ok: true, data }),
    (err) => post({ hublo: 1, id: m.id, type: 'result', ok: false, error: err.message || String(err) })
  )
}
// JSON-clone : garantit des objets simples (un proxy réactif Vue ferait échouer structuredClone)
function post (msg) {
  try { iframe.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify(msg)), '*') }
  catch (e) { console.warn('[hublo] bridge post failed', e.message) }
}
function emit (name, payload) { post({ hublo: 1, type: 'event', name, payload }) }

// ATTACHÉ EN SETUP (synchrone) : l'iframe poste son ready() dès son chargement —
// si le listener était posé après un await dans onMounted, le message serait perdu.
window.addEventListener('message', onMessage)

onMounted(async () => {
  if (!apps.loaded) await apps.load()
  const inst = apps.installed.find(x => x.id === appId.value)
  grants = (inst?.grants || []).map(s => String(s))   // tableau simple (pas un proxy réactif)
  const meta = apps.catalog.find(a => a.id === appId.value)
  if (meta && win.value && !win.value.title) windows.setTitle(wp.winId, meta.name)
  markReady()   // débloque core.ready : l'app ne démarre qu'avec les grants prêts
  themeObs = new MutationObserver(() => emit('theme', { theme: curTheme() }))
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  if (themeObs) themeObs.disconnect()
})
</script>

<template>
  <WindowFrame :win-id="winId" body-class="flexcol">
    <iframe
      ref="iframe"
      class="sandbox-frame"
      sandbox="allow-scripts allow-modals"
      :src="frameSrc"
    ></iframe>
  </WindowFrame>
</template>

<style scoped>
.sandbox-frame { flex: 1; width: 100%; border: 0; background: var(--win-bg); }
</style>
