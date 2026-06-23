<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useToastStore } from '../../stores/toast.js'

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
  <WindowFrame app="monitor" body-class="mon">
    <table>
      <thead>
        <tr>
          <th>PID</th><th>Utilisateur</th><th class="r">%CPU</th>
          <th>%MEM</th><th class="r">Mém.</th><th>Process</th>
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
          <td class="r">{{ rssMo(r.rss) }} Mo</td>
          <td>{{ r.comm }}</td>
        </tr>
      </tbody>
    </table>
  </WindowFrame>
</template>
