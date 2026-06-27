<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useAuthStore } from '../../stores/auth.js'
import { useWindowsStore } from '../../stores/windows.js'

const { t } = useI18n()
const tp = defineProps({ winId: { type: Number, required: true } })
const auth = useAuthStore()
const windows = useWindowsStore()

const hostRefs = ref([])    // DOM refs for each tab's terminal container
const tabs = ref([])        // { id, label, term, ws, fit, resizeObs }
const activeIdx = ref(0)
let nextId = 1
const enc = new TextEncoder()

function renumber () {
  for (let i = 0; i < tabs.value.length; i++) {
    if (!tabs.value[i]._titled) tabs.value[i].label = t('terminal.tab', { n: i + 1 })
  }
}

function createTab () {
  const id = nextId++
  tabs.value.push({ id, label: '', term: null, ws: null, fit: null, resizeObs: null })
  renumber()
  return tabs.value.length - 1
}

function initTab (idx) {
  const tab = tabs.value[idx]
  if (tab.term) return // déjà initialisé

  const host = hostRefs.value[idx]
  if (!host) return

  tab.term = new Terminal({
    fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
    fontSize: 13,
    theme: { background: '#1e1e1e' },
    cursorBlink: true
  })
  tab.fit = new FitAddon()
  tab.term.loadAddon(tab.fit)
  tab.term.open(host)

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  tab.ws = new WebSocket(proto + '://' + location.host + '/ws/terminal')
  tab.ws.binaryType = 'arraybuffer'
  tab.ws.onopen = () => {
    try { tab.fit.fit() } catch {}
    // envoie les dimensions réelles avant ouverture du shell (évite TUI cassée)
    tab.ws.send(JSON.stringify({ type: 'init', cols: tab.term.cols, rows: tab.term.rows }))
  }
  tab.ws.onmessage = ev => tab.term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data))
  tab.ws.onclose = () => tab.term.write('\r\n\x1b[31m' + t('terminal.sessionEnded') + '\x1b[0m\r\n')
  tab.term.onData(d => { if (tab.ws.readyState === 1) tab.ws.send(enc.encode(d)) })
  // titre de l'onglet = titre du shell (bash, ssh host, etc.)
  tab.term.onTitleChange(title => {
    if (title) tab._titled = true
    tab.label = title || t('terminal.tab', { n: idx + 1 })
    if (idx === activeIdx.value) windows.setTitle(tp.winId, tab.label)
  })

  tab.resizeObs = new ResizeObserver(() => {
    try { tab.fit.fit() } catch {}
    if (tab.ws && tab.ws.readyState === 1) {
      tab.ws.send(JSON.stringify({ type: 'resize', cols: tab.term.cols, rows: tab.term.rows }))
    }
  })
  tab.resizeObs.observe(host)
  setTimeout(() => { try { tab.fit.fit() } catch {} }, 60)
}

function destroyTab (idx) {
  const tab = tabs.value[idx]
  if (!tab) return
  try { tab.resizeObs && tab.resizeObs.disconnect() } catch {}
  try { tab.ws && tab.ws.close() } catch {}
  try { tab.term && tab.term.dispose() } catch {}
}

function closeTab (idx) {
  if (tabs.value.length <= 1) return
  destroyTab(idx)
  tabs.value.splice(idx, 1)
  if (activeIdx.value >= tabs.value.length) activeIdx.value = tabs.value.length - 1
  renumber()
}

function setActive (idx) {
  activeIdx.value = idx
  nextTick(() => initTab(idx))
}

watch(activeIdx, () => {
  windows.setTitle(tp.winId,
    (tabs.value[activeIdx.value]?.label || t('terminal.title', { user: auth.username || '' })))
})

onMounted(async () => {
  await nextTick()
  createTab()
  windows.setTitle(tp.winId, tabs.value[0].label)
  nextTick(() => initTab(0))
})

onBeforeUnmount(() => {
  for (let i = 0; i < tabs.value.length; i++) destroyTab(i)
})
</script>

<template>
  <WindowFrame :win-id="winId">
    <div class="term-tabs">
      <div
        v-for="(tab, i) in tabs"
        :key="tab.id"
        class="term-tab"
        :class="{ active: i === activeIdx }"
        @click="setActive(i)"
      >
        <span class="term-tab-label">{{ tab.label }}</span>
        <span v-if="tabs.length > 1" class="term-tab-close" @click.stop="closeTab(i)">×</span>
      </div>
      <span class="term-tab-add" @click="createTab(); setActive(tabs.length-1)">+</span>
    </div>
    <div
      v-for="(tab, i) in tabs"
      :key="tab.id"
      :ref="el => hostRefs[i] = el"
      class="term-host"
      :class="{ hidden: i !== activeIdx }"
    ></div>
  </WindowFrame>
</template>
