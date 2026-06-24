<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useToastStore } from '../../stores/toast.js'

const { t } = useI18n()
defineProps({ winId: { type: Number, required: true } })
const toast = useToastStore()
const rows = ref([])
let iv = null

function memPct (m) { return Math.min(100, parseFloat(m) * 8) }
function rssMo (rss) { return (parseInt(rss) / 1024).toFixed(0) }

async function refresh () {
  try { const d = await api.ps(); rows.value = d.rows }
  catch (ex) { toast.show(ex.message) }
}

onMounted(() => { refresh(); iv = setInterval(refresh, 3000) })
onBeforeUnmount(() => clearInterval(iv))
</script>

<template>
  <WindowFrame :win-id="winId" body-class="mon">
    <table>
      <thead>
        <tr>
          <th>{{ t('monitor.pid') }}</th><th>{{ t('monitor.user') }}</th><th class="r">{{ t('monitor.cpu') }}</th>
          <th>{{ t('monitor.mem') }}</th><th class="r">{{ t('monitor.rss') }}</th><th>{{ t('monitor.process') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.pid">
          <td>{{ r.pid }}</td>
          <td>{{ r.user }}</td>
          <td class="r">{{ r.cpu }}</td>
          <td>
            <span class="bar"><i :style="{ width: memPct(r.mem) + '%' }"></i></span>
            {{ r.mem }}
          </td>
          <td class="r">{{ rssMo(r.rss) }} {{ t('monitor.mo') }}</td>
          <td>{{ r.comm }}</td>
        </tr>
      </tbody>
    </table>
  </WindowFrame>
</template>
