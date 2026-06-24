<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useToastStore } from '../../stores/toast.js'

const { t, locale } = useI18n()
defineProps({ winId: { type: Number, required: true } })
const toast = useToastStore()
const info = ref(null)
let iv = null

async function load () {
  try { info.value = await api.sysinfo() } catch (ex) { toast.show(ex.message) }
}
function pct (used, total) { return total ? Math.round((used / total) * 100) : 0 }
function gib (n) { return (n / 1073741824).toFixed(1) + (locale.value === 'fr' ? ' Go' : ' GB') }

onMounted(() => { load(); iv = setInterval(load, 5000) })
onBeforeUnmount(() => clearInterval(iv))
</script>

<template>
  <WindowFrame :win-id="winId">
    <div class="sysinfo">
      <template v-if="info">
        <div class="si-logo">🖥️</div>
        <h2 class="si-host">{{ info.host }}</h2>
        <p class="si-os">{{ info.os }}<br><span>{{ t('sysinfo.kernel', { kernel: info.kernel }) }}</span></p>

        <div class="si-rows">
          <div class="si-row"><span>{{ t('sysinfo.session') }}</span><b>{{ info.user }}</b></div>
          <div class="si-row"><span>{{ t('sysinfo.cpus') }}</span><b>{{ t('sysinfo.cores', { n: info.cpu }) }}</b></div>
          <div class="si-row"><span>{{ t('sysinfo.load') }}</span><b>{{ info.load }}</b></div>
          <div class="si-row"><span>{{ t('sysinfo.uptime') }}</span><b>{{ info.uptime }}</b></div>
        </div>

        <div class="si-gauge">
          <div class="si-gh"><span>{{ t('sysinfo.memory') }}</span><span>{{ gib(info.mem.used) }} / {{ gib(info.mem.total) }}</span></div>
          <div class="gbar"><i :style="{ width: pct(info.mem.used, info.mem.total) + '%' }"></i></div>
        </div>
        <div class="si-gauge">
          <div class="si-gh"><span>{{ t('sysinfo.disk') }}</span><span>{{ gib(info.disk.used) }} / {{ gib(info.disk.total) }}</span></div>
          <div class="gbar"><i :style="{ width: pct(info.disk.used, info.disk.total) + '%' }"></i></div>
        </div>
      </template>
      <p v-else class="si-loading">{{ t('sysinfo.loading') }}</p>
    </div>
  </WindowFrame>
</template>
