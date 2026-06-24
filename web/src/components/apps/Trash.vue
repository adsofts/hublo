<script setup>
import { ref, onMounted } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useToastStore } from '../../stores/toast.js'

const toast = useToastStore()
const items = ref([])
const loading = ref(false)

async function load () {
  loading.value = true
  try { const d = await api.trashList(); items.value = d.items } catch (ex) { toast.show(ex.message) }
  loading.value = false
}
async function restore (it) {
  try { await api.trashRestore(it.id); toast.show('Restauré'); load() } catch (ex) { toast.show(ex.message) }
}
async function empty () {
  if (!items.value.length) return
  if (!confirm('Vider définitivement la corbeille ? (' + items.value.length + ' élément·s)')) return
  try { await api.trashEmpty(); toast.show('Corbeille vidée'); load() } catch (ex) { toast.show(ex.message) }
}
onMounted(load)
</script>

<template>
  <WindowFrame app="trash" body-class="flexcol">
    <div class="finder-bar">
      <button class="fbtn" @click="load">⟳</button>
      <span class="fpath">{{ items.length }} élément·s dans la corbeille</span>
      <button class="fbtn" :disabled="!items.length" @click="empty">Vider la corbeille</button>
    </div>
    <div class="trash-list">
      <div v-if="!items.length && !loading" class="finder-empty">Corbeille vide</div>
      <div v-for="it in items" :key="it.id" class="trash-row">
        <span class="trash-ic">🗑️</span>
        <div class="trash-info">
          <div class="trash-name">{{ it.name }}</div>
          <div class="trash-orig" :title="it.orig">{{ it.orig }}</div>
        </div>
        <button class="fbtn" @click="restore(it)">Restaurer</button>
      </div>
    </div>
  </WindowFrame>
</template>
