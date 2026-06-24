<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api, fmtSize } from '../../api.js'
import { useWindowsStore } from '../../stores/windows.js'
import { useToastStore } from '../../stores/toast.js'

const wp = defineProps({ winId: { type: Number, required: true } })
const windows = useWindowsStore()
const toast = useToastStore()
const win = computed(() => windows.byId(wp.winId))
const path = computed(() => win.value?.path || '')
const info = ref(null)
const perms = ref({ u: { r: false, w: false, x: false }, g: { r: false, w: false, x: false }, o: { r: false, w: false, x: false } })

function fillPerms (octal) {
  const o = String(octal).padStart(3, '0').slice(-3)
  const map = n => ({ r: !!(n & 4), w: !!(n & 2), x: !!(n & 1) })
  perms.value = { u: map(+o[0]), g: map(+o[1]), o: map(+o[2]) }
}
function toOctal () {
  const v = g => (g.r ? 4 : 0) + (g.w ? 2 : 0) + (g.x ? 1 : 0)
  return '' + v(perms.value.u) + v(perms.value.g) + v(perms.value.o)
}
async function load () {
  if (!path.value) return
  info.value = null
  try { info.value = await api.info(path.value, win.value?.host); fillPerms(info.value.octal) }
  catch (ex) { toast.show(ex.message) }
}
async function apply () {
  try { await api.chmod(path.value, toOctal(), win.value?.host); toast.show('Droits mis à jour'); load() }
  catch (ex) { toast.show(ex.message) }
}
function fmtDate (ms) { return new Date(ms).toLocaleString('fr-FR') }

onMounted(load)
watch(path, load)
</script>

<template>
  <WindowFrame :win-id="winId">
    <div class="props">
      <template v-if="info">
        <div class="props-head">
          <span class="props-ic">{{ info.ftype.includes('directory') ? '📁' : '📄' }}</span>
          <div class="props-htxt">
            <div class="props-name">{{ info.name }}</div>
            <div class="props-type">{{ info.ftype }}</div>
          </div>
        </div>
        <div class="props-rows">
          <div class="props-row"><span>Taille</span><b>{{ fmtSize(info.size) }}</b></div>
          <div class="props-row"><span>Modifié</span><b>{{ fmtDate(info.mtime) }}</b></div>
          <div class="props-row"><span>Propriétaire</span><b>{{ info.owner }} : {{ info.group }}</b></div>
          <div class="props-row"><span>Mode</span><b>{{ info.perms }} ({{ info.octal }})</b></div>
        </div>
        <div class="props-perms">
          <div class="pp-title">Droits Unix</div>
          <table>
            <thead><tr><th></th><th>Lire</th><th>Écrire</th><th>Exéc.</th></tr></thead>
            <tbody>
              <tr><td>Propriétaire</td><td><input type="checkbox" v-model="perms.u.r"></td><td><input type="checkbox" v-model="perms.u.w"></td><td><input type="checkbox" v-model="perms.u.x"></td></tr>
              <tr><td>Groupe</td><td><input type="checkbox" v-model="perms.g.r"></td><td><input type="checkbox" v-model="perms.g.w"></td><td><input type="checkbox" v-model="perms.g.x"></td></tr>
              <tr><td>Autres</td><td><input type="checkbox" v-model="perms.o.r"></td><td><input type="checkbox" v-model="perms.o.w"></td><td><input type="checkbox" v-model="perms.o.x"></td></tr>
            </tbody>
          </table>
          <div class="pp-foot"><span class="pp-oct">chmod {{ toOctal() }}</span><button class="fbtn" @click="apply">Appliquer</button></div>
        </div>
      </template>
      <p v-else class="si-loading">Chargement…</p>
    </div>
  </WindowFrame>
</template>
