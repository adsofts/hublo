<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { api, fmtSize } from '../../api.js'
import { useWindowsStore } from '../../stores/windows.js'
import { useToastStore } from '../../stores/toast.js'

const { t, locale } = useI18n()
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
  try { await api.chmod(path.value, toOctal(), win.value?.host); toast.show(t('props.rightsUpdated')); load() }
  catch (ex) { toast.show(ex.message) }
}
function fmtDate (ms) { return new Date(ms).toLocaleString(locale.value === 'fr' ? 'fr-FR' : 'en-US') }

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
          <div class="props-row"><span>{{ t('props.size') }}</span><b>{{ fmtSize(info.size) }}</b></div>
          <div class="props-row"><span>{{ t('props.modified') }}</span><b>{{ fmtDate(info.mtime) }}</b></div>
          <div class="props-row"><span>{{ t('props.owner') }}</span><b>{{ info.owner }} : {{ info.group }}</b></div>
          <div class="props-row"><span>{{ t('props.mode') }}</span><b>{{ info.perms }} ({{ info.octal }})</b></div>
        </div>
        <div class="props-perms">
          <div class="pp-title">{{ t('props.unixRights') }}</div>
          <table>
            <thead><tr><th></th><th>{{ t('props.read') }}</th><th>{{ t('props.write') }}</th><th>{{ t('props.exec') }}</th></tr></thead>
            <tbody>
              <tr><td>{{ t('props.ownerRow') }}</td><td><input type="checkbox" v-model="perms.u.r"></td><td><input type="checkbox" v-model="perms.u.w"></td><td><input type="checkbox" v-model="perms.u.x"></td></tr>
              <tr><td>{{ t('props.group') }}</td><td><input type="checkbox" v-model="perms.g.r"></td><td><input type="checkbox" v-model="perms.g.w"></td><td><input type="checkbox" v-model="perms.g.x"></td></tr>
              <tr><td>{{ t('props.others') }}</td><td><input type="checkbox" v-model="perms.o.r"></td><td><input type="checkbox" v-model="perms.o.w"></td><td><input type="checkbox" v-model="perms.o.x"></td></tr>
            </tbody>
          </table>
          <div class="pp-foot"><span class="pp-oct">chmod {{ toOctal() }}</span><button class="fbtn" @click="apply">{{ t('props.apply') }}</button></div>
        </div>
      </template>
      <p v-else class="si-loading">{{ t('props.loading') }}</p>
    </div>
  </WindowFrame>
</template>
