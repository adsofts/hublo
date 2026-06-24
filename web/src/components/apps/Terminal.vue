<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useAuthStore } from '../../stores/auth.js'
import { useWindowsStore } from '../../stores/windows.js'

const tp = defineProps({ winId: { type: Number, required: true } })
const auth = useAuthStore()
const windows = useWindowsStore()

const host = ref(null)
let term = null
let fit = null
let ws = null
let resizeObs = null
const enc = new TextEncoder()

function doFit () {
  try {
    fit.fit()
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
  } catch { /* ignore */ }
}

onMounted(async () => {
  await nextTick()
  windows.setTitle(tp.winId, 'Terminal — ' + (auth.username || ''))

  term = new Terminal({
    fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
    fontSize: 13,
    theme: { background: '#1e1e1e' },
    cursorBlink: true
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host.value)

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(proto + '://' + location.host + '/ws/terminal')
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => doFit()
  ws.onmessage = ev => term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data))
  ws.onclose = () => term.write('\r\n\x1b[31m[session terminée]\x1b[0m\r\n')
  term.onData(d => { if (ws.readyState === 1) ws.send(enc.encode(d)) })

  resizeObs = new ResizeObserver(() => doFit())
  resizeObs.observe(host.value)
  setTimeout(doFit, 60)
})

onBeforeUnmount(() => {
  try { resizeObs && resizeObs.disconnect() } catch {}
  try { ws && ws.close() } catch {}
  try { term && term.dispose() } catch {}
})
</script>

<template>
  <WindowFrame :win-id="winId">
    <div ref="host" class="term-host"></div>
  </WindowFrame>
</template>
