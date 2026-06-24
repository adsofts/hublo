<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useToastStore } from '../../stores/toast.js'

const { t } = useI18n()
defineProps({ winId: { type: Number, required: true } })
const toast = useToastStore()
const items = ref([])
const loading = ref(false)
const drives = ref([])
const host = ref(null)   // null = local

async function loadDrives () { try { drives.value = (await api.hostsList()).hosts } catch { /* */ } }
async function load () {
  loading.value = true
  try { const d = await api.trashList(host.value); items.value = d.items } catch (ex) { toast.show(ex.message) }
  loading.value = false
}
function pick (h) { host.value = h; load() }
async function restore (it) {
  try { await api.trashRestore(it.id, host.value); toast.show(t('trash.restored')); load() } catch (ex) { toast.show(ex.message) }
}
async function empty () {
  if (!items.value.length) return
  if (!confirm(t('trash.confirmEmpty', { n: items.value.length }))) return
  try { await api.trashEmpty(host.value); toast.show(t('trash.emptied')); load() } catch (ex) { toast.show(ex.message) }
}
onMounted(() => { loadDrives(); load() })
</script>

<template>
  <WindowFrame :win-id="winId" body-class="flexcol">
    <div class="finder-bar">
      <button class="fbtn" @click="load">⟳</button>
      <select class="tr-host" :value="host || ''" @change="pick($event.target.value || null)">
        <option value="">{{ t('common.thisComputer') }}</option>
        <option v-for="d in drives" :key="d.id" :value="d.id">🌐 {{ d.label || d.host }}</option>
      </select>
      <span class="fpath">{{ t('trash.count', { n: items.length }) }}</span>
      <button class="fbtn" :disabled="!items.length" @click="empty">{{ t('trash.emptyTrash') }}</button>
    </div>
    <div class="trash-list">
      <div v-if="!items.length && !loading" class="finder-empty">{{ t('trash.empty') }}</div>
      <div v-for="it in items" :key="it.id" class="trash-row">
        <span class="trash-ic">🗑️</span>
        <div class="trash-info">
          <div class="trash-name">{{ it.name }}</div>
          <div class="trash-orig" :title="it.orig">{{ it.orig }}</div>
        </div>
        <button class="fbtn" @click="restore(it)">{{ t('trash.restore') }}</button>
      </div>
    </div>
  </WindowFrame>
</template>
