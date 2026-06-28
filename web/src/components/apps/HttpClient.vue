<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useToastStore } from '../../stores/toast.js'

const { t } = useI18n()
defineProps({ winId: { type: Number, required: true } })
const toast = useToastStore()

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const drives = ref([])
const host = ref(null)
const method = ref('GET')
const url = ref('')
const headers = ref([{ name: '', value: '', enabled: true }])
const body = ref('')
const followRedirects = ref(false)
const reqTab = ref('headers')
const respTab = ref('body')
const bodyView = ref('pretty')
const running = ref(false)
const result = ref(null)
const history = ref([])

const HKEY = 'hublo.httpHistory'
const hasBody = computed(() => method.value !== 'GET' && method.value !== 'HEAD')

async function loadDrives () { try { drives.value = (await api.hostsList()).hosts } catch { /* */ } }
function loadHistory () { try { history.value = JSON.parse(localStorage.getItem(HKEY) || '[]') } catch { history.value = [] } }
function saveHistory () { try { localStorage.setItem(HKEY, JSON.stringify(history.value.slice(0, 25))) } catch { /* */ } }

function addHeader () { headers.value.push({ name: '', value: '', enabled: true }) }
function rmHeader (i) { headers.value.splice(i, 1); if (!headers.value.length) addHeader() }

async function send () {
  const u = url.value.trim()
  if (!/^https?:\/\//i.test(u)) { toast.show(t('http.urlRequired')); return }
  running.value = true; result.value = null
  const payload = {
    method: method.value, url: u, host: host.value,
    headers: headers.value.filter(h => h.name && h.name.trim()),
    body: hasBody.value ? body.value : '',
    followRedirects: followRedirects.value
  }
  try {
    const r = await api.httpRequest(payload)
    result.value = r
    if (r.ok) { respTab.value = 'body'; bodyView.value = 'pretty' }
    pushHistory(payload, r)
  } catch (ex) {
    result.value = { ok: false, error: ex.message }
  }
  running.value = false
}

function pushHistory (payload, r) {
  history.value.unshift({
    method: payload.method, url: payload.url, host: payload.host,
    headers: payload.headers, body: payload.body, follow: payload.followRedirects,
    status: r.ok ? r.status : 0, ms: r.ok ? r.timeMs : 0, ts: Date.now()
  })
  history.value = history.value.slice(0, 25)
  saveHistory()
}
function replay (h) {
  method.value = h.method; url.value = h.url; host.value = h.host || null
  headers.value = (h.headers && h.headers.length ? h.headers.map(x => ({ name: x.name, value: x.value, enabled: x.enabled !== false })) : [{ name: '', value: '', enabled: true }])
  body.value = h.body || ''; followRedirects.value = !!h.follow
}
function clearHistory () { history.value = []; saveHistory() }

const statusClass = computed(() => {
  if (!result.value || !result.value.ok) return 'st-err'
  const s = result.value.status
  if (s >= 500) return 'st-err'
  if (s >= 400) return 'st-warn'
  if (s >= 300) return 'st-redir'
  return 'st-ok'
})
const isJson = computed(() => {
  const r = result.value
  if (!r || !r.ok) return false
  if ((r.contentType || '').includes('json')) return true
  const b = (r.body || '').trim()
  return b.startsWith('{') || b.startsWith('[')
})
const prettyBody = computed(() => {
  const r = result.value
  if (!r || !r.ok) return ''
  if (bodyView.value === 'raw' || !isJson.value) return r.body
  try { return JSON.stringify(JSON.parse(r.body), null, 2) } catch { return r.body }
})
function copyBody () {
  navigator.clipboard.writeText(result.value?.body || '').then(() => toast.show(t('http.copied'))).catch(() => {})
}
function fmtTime (ts) { const d = new Date(ts); return d.toLocaleTimeString() }

onMounted(() => { loadDrives(); loadHistory() })
</script>

<template>
  <WindowFrame :win-id="winId" body-class="flexcol">
    <div class="finder-bar http-bar">
      <select class="http-method" v-model="method" :class="'m-' + method.toLowerCase()">
        <option v-for="m in METHODS" :key="m" :value="m">{{ m }}</option>
      </select>
      <input class="fpath http-url" v-model="url" :placeholder="t('http.url')" spellcheck="false" @keydown.enter="send" @keydown.meta.enter="send" @keydown.ctrl.enter="send">
      <select class="tr-host" v-model="host">
        <option :value="null">{{ t('common.local') }}</option>
        <option v-for="d in drives" :key="d.id" :value="d.id">🌐 {{ d.label || d.host }}</option>
      </select>
      <button class="fbtn primary http-send" :disabled="running" @click="send">{{ running ? t('http.sending') : t('http.send') }}</button>
    </div>

    <div class="http-main">
      <div class="http-side">
        <div class="side-sec">{{ t('http.history') }} <button v-if="history.length" class="g-mini" @click="clearHistory">{{ t('http.clearHistory') }}</button></div>
        <div v-for="h in history" :key="h.ts" class="hist-item" @click="replay(h)" :title="h.url">
          <span class="hist-m" :class="'m-' + h.method.toLowerCase()">{{ h.method }}</span>
          <span class="hist-st" :class="h.status >= 500 || !h.status ? 'st-err' : h.status >= 400 ? 'st-warn' : h.status >= 300 ? 'st-redir' : 'st-ok'">{{ h.status || '×' }}</span>
          <span class="hist-url">{{ h.url.replace(/^https?:\/\//, '') }}</span>
        </div>
        <div v-if="!history.length" class="finder-empty" style="font-size:12px">{{ t('http.noHistory') }}</div>
      </div>

      <div class="http-work">
        <div class="http-req">
          <div class="http-tabs">
            <button :class="{ on: reqTab === 'headers' }" @click="reqTab = 'headers'">{{ t('http.headers') }}<span v-if="headers.filter(h => h.name).length" class="tab-n">{{ headers.filter(h => h.name).length }}</span></button>
            <button :class="{ on: reqTab === 'body' }" @click="reqTab = 'body'">{{ t('http.body') }}</button>
            <label class="http-follow"><input type="checkbox" v-model="followRedirects"> {{ t('http.follow') }}</label>
          </div>
          <div v-show="reqTab === 'headers'" class="http-headers">
            <div v-for="(h, i) in headers" :key="i" class="hdr-row">
              <input type="checkbox" v-model="h.enabled">
              <input class="hdr-k" v-model="h.name" :placeholder="t('http.headerName')" spellcheck="false">
              <input class="hdr-v" v-model="h.value" :placeholder="t('http.headerValue')" spellcheck="false">
              <button class="g-mini" @click="rmHeader(i)">−</button>
            </div>
            <button class="fbtn http-addh" @click="addHeader">+ {{ t('http.addHeader') }}</button>
          </div>
          <div v-show="reqTab === 'body'" class="http-bodyarea">
            <textarea v-if="hasBody" v-model="body" :placeholder="t('http.bodyPlaceholder')" spellcheck="false"></textarea>
            <div v-else class="finder-empty" style="font-size:13px">{{ t('http.noBody', { method }) }}</div>
          </div>
        </div>

        <div class="http-resp">
          <div v-if="result && !result.ok" class="http-respmeta"><span class="st-pill st-err">{{ t('http.failed') }}</span></div>
          <div v-else-if="result" class="http-respmeta">
            <span class="st-pill" :class="statusClass">{{ result.status }}</span>
            <span class="resp-meta">{{ result.statusLine.replace(/^HTTP\/[\d.]+ /, '') }}</span>
            <span class="resp-dot">·</span><span class="resp-meta">{{ result.timeMs }} ms</span>
            <span class="resp-dot">·</span><span class="resp-meta">{{ result.size }} o</span>
            <span v-if="result.contentType" class="resp-dot">·</span><span v-if="result.contentType" class="resp-meta resp-ct">{{ result.contentType }}</span>
          </div>

          <template v-if="result && !result.ok">
            <div class="http-err">{{ result.error }}</div>
          </template>
          <template v-else-if="result">
            <div class="http-tabs resp-tabs">
              <button :class="{ on: respTab === 'body' }" @click="respTab = 'body'">{{ t('http.response') }}</button>
              <button :class="{ on: respTab === 'headers' }" @click="respTab = 'headers'">{{ t('http.respHeaders') }}<span class="tab-n">{{ result.headers.length }}</span></button>
              <template v-if="respTab === 'body'">
                <span class="fspace"></span>
                <button v-if="isJson" class="g-mini" :class="{ on: bodyView === 'pretty' }" @click="bodyView = 'pretty'">{{ t('http.pretty') }}</button>
                <button v-if="isJson" class="g-mini" :class="{ on: bodyView === 'raw' }" @click="bodyView = 'raw'">{{ t('http.raw') }}</button>
                <button class="g-mini" @click="copyBody">{{ t('http.copy') }}</button>
              </template>
            </div>
            <div v-if="respTab === 'body'" class="http-respbody">
              <pre>{{ prettyBody }}<span v-if="result.truncated" class="resp-trunc">{{ t('http.truncated') }}</span></pre>
            </div>
            <div v-else class="http-respheaders">
              <div v-for="(h, i) in result.headers" :key="i" class="rh-row"><span class="rh-k">{{ h.name }}</span><span class="rh-v">{{ h.value }}</span></div>
            </div>
          </template>
          <div v-else class="finder-empty" style="font-size:13px">{{ t('http.waiting') }}</div>
        </div>
      </div>
    </div>
  </WindowFrame>
</template>
