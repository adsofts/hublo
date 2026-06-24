<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useToastStore } from '../../stores/toast.js'

defineProps({ winId: { type: Number, required: true } })
const toast = useToastStore()
const info = ref(null)
let iv = null

async function load () {
  try { info.value = await api.sysinfo() } catch (ex) { toast.show(ex.message) }
}
function pct (used, total) { return total ? Math.round((used / total) * 100) : 0 }
function gib (n) { return (n / 1073741824).toFixed(1) + ' Go' }

onMounted(() => { load(); iv = setInterval(load, 5000) })
onBeforeUnmount(() => clearInterval(iv))
</script>

<template>
  <WindowFrame :win-id="winId">
    <div class="sysinfo">
      <template v-if="info">
        <div class="si-logo">🖥️</div>
        <h2 class="si-host">{{ info.host }}</h2>
        <p class="si-os">{{ info.os }}<br><span>noyau {{ info.kernel }}</span></p>

        <div class="si-rows">
          <div class="si-row"><span>Session</span><b>{{ info.user }}</b></div>
          <div class="si-row"><span>Processeurs</span><b>{{ info.cpu }} cœurs</b></div>
          <div class="si-row"><span>Charge 1 / 5 / 15 min</span><b>{{ info.load }}</b></div>
          <div class="si-row"><span>En service</span><b>{{ info.uptime }}</b></div>
        </div>

        <div class="si-gauge">
          <div class="si-gh"><span>Mémoire</span><span>{{ gib(info.mem.used) }} / {{ gib(info.mem.total) }}</span></div>
          <div class="gbar"><i :style="{ width: pct(info.mem.used, info.mem.total) + '%' }"></i></div>
        </div>
        <div class="si-gauge">
          <div class="si-gh"><span>Disque</span><span>{{ gib(info.disk.used) }} / {{ gib(info.disk.total) }}</span></div>
          <div class="gbar"><i :style="{ width: pct(info.disk.used, info.disk.total) + '%' }"></i></div>
        </div>
      </template>
      <p v-else class="si-loading">Chargement…</p>
    </div>
  </WindowFrame>
</template>
