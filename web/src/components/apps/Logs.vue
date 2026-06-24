<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useWindowsStore } from '../../stores/windows.js'

const { t } = useI18n()

const wp = defineProps({ winId: { type: Number, required: true } })
const windows = useWindowsStore()
const win = computed(() => windows.byId(wp.winId))

const drives = ref([])
const host = ref(null)
const source = ref('file')      // 'file' | 'journal-system' | 'journal-user'
const path = ref('')
const lines = ref([])
const filter = ref('')
const following = ref(false)
const autoscroll = ref(true)
const viewEl = ref(null)
let ws = null
let carry = ''

const filtered = computed(() => {
  const f = filter.value.trim().toLowerCase()
  return f ? lines.value.filter(l => l.toLowerCase().includes(f)) : lines.value
})

async function loadDrives () { try { drives.value = (await api.hostsList()).hosts } catch { /* */ } }

function stop () { following.value = false; if (ws) { try { ws.close() } catch {} ; ws = null } }
function start () {
  stop(); lines.value = []; carry = ''
  const q = []
  if (source.value === 'file') { if (!path.value.trim()) return; q.push('path=' + encodeURIComponent(path.value.trim())) }
  else q.push('source=' + encodeURIComponent(source.value))
  if (host.value) q.push('host=' + encodeURIComponent(host.value))
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(proto + '://' + location.host + '/ws/logtail?' + q.join('&'))
  following.value = true
  ws.onmessage = ev => append(typeof ev.data === 'string' ? ev.data : '')
  ws.onclose = () => { following.value = false }
  ws.onerror = () => { following.value = false }
}
function append (txt) {
  carry += txt.replace(/\r/g, '')
  const parts = carry.split('\n')
  carry = parts.pop()
  if (parts.length) {
    lines.value.push(...parts)
    if (lines.value.length > 5000) lines.value.splice(0, lines.value.length - 5000)
    if (autoscroll.value) nextTick(() => { const el = viewEl.value; if (el) el.scrollTop = el.scrollHeight })
  }
}
function onScroll () {
  const el = viewEl.value; if (!el) return
  autoscroll.value = (el.scrollHeight - el.scrollTop - el.clientHeight) < 30
}
function clear () { lines.value = []; carry = '' }

onMounted(() => {
  loadDrives()
  const w = win.value
  if (w && w.path) { source.value = 'file'; path.value = w.path; host.value = w.host || null; start() }
})
onBeforeUnmount(stop)
watch(() => win.value && win.value.path, (p) => {
  if (p) { source.value = 'file'; path.value = p; host.value = win.value?.host || null; start() }
})
</script>

<template>
  <WindowFrame :win-id="winId" body-class="flexcol">
    <div class="finder-bar">
      <select class="tr-host" v-model="source">
        <option value="file">{{ t('logs.file') }}</option>
        <option value="journal-system">{{ t('logs.systemJournal') }}</option>
        <option value="journal-user">{{ t('logs.userJournal') }}</option>
      </select>
      <input v-if="source === 'file'" class="fpath logp" v-model="path" placeholder="/var/log/syslog" spellcheck="false" @keydown.enter="start">
      <select class="tr-host" v-model="host">
        <option :value="null">{{ t('common.local') }}</option>
        <option v-for="d in drives" :key="d.id" :value="d.id">🌐 {{ d.label || d.host }}</option>
      </select>
      <button v-if="!following" class="fbtn" @click="start">{{ t('logs.follow') }}</button>
      <button v-else class="fbtn" @click="stop">{{ t('logs.stop') }}</button>
      <input class="fsearch" v-model="filter" type="search" :placeholder="t('logs.filter')">
      <button class="fbtn" @click="clear">{{ t('logs.clear') }}</button>
    </div>
    <div ref="viewEl" class="logview" @scroll="onScroll">
      <div v-for="(l, i) in filtered" :key="i" class="logline">{{ l }}</div>
      <div v-if="!lines.length" class="finder-empty" style="color:#888">{{ following ? t('logs.waiting') : t('logs.pickSource') }}</div>
    </div>
  </WindowFrame>
</template>
