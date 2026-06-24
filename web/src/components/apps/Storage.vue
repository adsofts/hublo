<script setup>
import { ref, computed, onMounted } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api, fmtSize, icoFor, join } from '../../api.js'
import { useWindowsStore } from '../../stores/windows.js'
import { useToastStore } from '../../stores/toast.js'

const wp = defineProps({ winId: { type: Number, required: true } })
const windows = useWindowsStore()
const toast = useToastStore()
const win = computed(() => windows.byId(wp.winId))

const drives = ref([])
const host = ref(null)
const data = ref(null)     // { path, parent, entries, total, df }
const loading = ref(false)

const maxSize = computed(() => (data.value && data.value.entries.length ? data.value.entries[0].size : 1))
function pct (n) { return Math.min(100, Math.round((n / (maxSize.value || 1)) * 100)) }
function dfPct () { return data.value && data.value.df.total ? Math.round((data.value.df.used / data.value.df.total) * 100) : 0 }

async function loadDrives () { try { drives.value = (await api.hostsList()).hosts } catch { /* */ } }
async function analyze (p) {
  loading.value = true
  try { data.value = await api.du(p, host.value) }
  catch (ex) { toast.show(ex.message) }
  loading.value = false
}
function openEntry (e) { if (e.type === 'dir') analyze(join(data.value.path, e.name)) }
function up () { if (data.value?.parent) analyze(data.value.parent) }
function reveal () { windows.open('finder', { gotoHost: host.value }) }

onMounted(() => { loadDrives(); analyze(win.value?.path || null) })
</script>

<template>
  <WindowFrame :win-id="winId" body-class="flexcol">
    <div class="finder-bar">
      <button class="fbtn" title="Dossier parent" :disabled="!data?.parent" @click="up">↑</button>
      <select class="tr-host" v-model="host" @change="analyze(null)">
        <option :value="null">🖥️ local</option>
        <option v-for="d in drives" :key="d.id" :value="d.id">🌐 {{ d.label || d.host }}</option>
      </select>
      <span class="fpath">{{ data ? data.path : '…' }}</span>
      <button class="fbtn" @click="analyze(data ? data.path : null)">⟳ Analyser</button>
      <button class="fbtn" @click="reveal" title="Ouvrir dans le Finder">Finder</button>
    </div>
    <div class="du-df" v-if="data">
      <div class="du-dfhead"><span>Disque ({{ dfPct() }}% utilisé)</span><span>{{ fmtSize(data.df.used) }} / {{ fmtSize(data.df.total) }} · libre {{ fmtSize(data.df.avail) }}</span></div>
      <div class="gbar"><i :style="{ width: dfPct() + '%' }"></i></div>
    </div>
    <div class="du-list">
      <div v-if="loading" class="finder-empty">Analyse en cours… <span style="opacity:.6">(du peut prendre du temps sur un gros dossier)</span></div>
      <div v-else-if="data && !data.entries.length" class="finder-empty">Dossier vide</div>
      <div v-for="e in (data ? data.entries : [])" :key="e.name" class="du-row" @dblclick="openEntry(e)" :title="e.type === 'dir' ? 'Double-clic pour explorer' : e.name">
        <span class="du-ic">{{ icoFor(e) }}</span>
        <span class="du-name">{{ e.name }}</span>
        <span class="du-bar"><i :style="{ width: pct(e.size) + '%' }"></i></span>
        <span class="du-size">{{ fmtSize(e.size) }}</span>
      </div>
    </div>
  </WindowFrame>
</template>
