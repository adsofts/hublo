<script setup>
import { ref, reactive } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api, join, icoFor, isImage } from '../../api.js'
import { useAuthStore } from '../../stores/auth.js'
import { useWindowsStore } from '../../stores/windows.js'
import { useToastStore } from '../../stores/toast.js'

const auth = useAuthStore()
const windows = useWindowsStore()
const toast = useToastStore()

const state = reactive({
  path: auth.home || '/',
  parent: null,
  entries: [],
  sel: null,
  hist: [],
  gridDrop: false
})
const dropTarget = ref(null) // nom du dossier survolé en drag
const uplInput = ref(null)

async function load (p, push = true) {
  try {
    const d = await api.list(p)
    if (push && state.path && state.path !== d.path) state.hist.push(state.path)
    state.path = d.path
    state.parent = d.parent
    state.sel = null
    state.entries = d.entries
  } catch (ex) {
    toast.show(ex.message)
  }
}

function select (e) { state.sel = e }

function dblclick (e) {
  const full = join(state.path, e.name)
  if (e.type === 'dir') load(full)
  else if (isImage(e.name)) windows.open('preview', { title: e.name, payload: { path: full } })
  else windows.open('textedit', { payload: { path: full } })
}

function goUp () { if (state.parent) load(state.parent) }
function goBack () { const p = state.hist.pop(); if (p) load(p, false) }
function reload () { load(state.path, false) }

async function mkdir () {
  const n = prompt('Nom du nouveau dossier :')
  if (!n) return
  try { await api.mkdir(join(state.path, n)); load(state.path, false); toast.show('Dossier créé') }
  catch (ex) { toast.show(ex.message) }
}

async function rename () {
  if (!state.sel) return
  const n = prompt('Nouveau nom :', state.sel.name)
  if (!n || n === state.sel.name) return
  try { await api.rename(join(state.path, state.sel.name), join(state.path, n)); load(state.path, false); toast.show('Renommé') }
  catch (ex) { toast.show(ex.message) }
}

async function remove () {
  if (!state.sel) return
  if (!confirm('Supprimer « ' + state.sel.name + ' » ?')) return
  try { await api.remove(join(state.path, state.sel.name)); load(state.path, false); toast.show('Supprimé') }
  catch (ex) { toast.show(ex.message) }
}

function importClick () { uplInput.value?.click() }
async function onUpload (ev) {
  const files = ev.target.files
  if (!files.length) return
  await uploadFiles(files, state.path)
  ev.target.value = ''
  load(state.path, false)
}

function download () {
  if (!state.sel || state.sel.type === 'dir') return
  const a = document.createElement('a')
  a.href = api.downloadUrl(join(state.path, state.sel.name))
  a.download = state.sel.name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function uploadFiles (files, destDir) {
  for (const f of files) {
    try { const d = await api.upload(f, destDir); toast.show('Importé : ' + d.name) }
    catch (ex) { toast.show(ex.message) }
  }
}

// ---- drag & drop ----
function onDragStart (ev, e) {
  ev.dataTransfer.setData('application/x-hublo', e.name)
  ev.dataTransfer.effectAllowed = 'move'
}
function onCellDragOver (ev, e) {
  if (e.type !== 'dir') return
  if (ev.dataTransfer.types.includes('application/x-hublo') || ev.dataTransfer.types.includes('Files')) {
    ev.preventDefault()
    dropTarget.value = e.name
  }
}
function onCellDragLeave (e) {
  if (dropTarget.value === e.name) dropTarget.value = null
}
async function onCellDrop (ev, e) {
  if (e.type !== 'dir') return
  ev.preventDefault()
  ev.stopPropagation()
  dropTarget.value = null
  const folder = join(state.path, e.name)
  if (ev.dataTransfer.files.length) {
    await uploadFiles(ev.dataTransfer.files, folder)
    load(state.path, false)
    return
  }
  const src = ev.dataTransfer.getData('application/x-hublo')
  if (!src || src === e.name) return
  try {
    await api.rename(join(state.path, src), join(folder, src))
    load(state.path, false)
    toast.show('Déplacé → ' + e.name)
  } catch (ex) { toast.show(ex.message) }
}

function onGridDragOver (ev) {
  if (ev.dataTransfer.types.includes('Files')) { ev.preventDefault(); state.gridDrop = true }
}
function onGridDragLeave (ev) {
  if (ev.target.classList.contains('grid')) state.gridDrop = false
}
async function onGridDrop (ev) {
  state.gridDrop = false
  if (!ev.dataTransfer.files.length) return
  ev.preventDefault()
  await uploadFiles(ev.dataTransfer.files, state.path)
  load(state.path, false)
}

// chargement initial
load(state.path, false)
</script>

<template>
  <WindowFrame app="finder" body-class="flexcol">
    <div class="finder-bar">
      <button class="fbtn" title="Précédent" :disabled="!state.hist.length" @click="goBack">‹</button>
      <button class="fbtn" title="Dossier parent" :disabled="!state.parent" @click="goUp">↑</button>
      <button class="fbtn" title="Rafraîchir" @click="reload">⟳</button>
      <span class="fpath">{{ state.path }}</span>
      <button class="fbtn" title="Importer des fichiers" @click="importClick">⬆ Importer</button>
      <button class="fbtn" :disabled="!state.sel || state.sel.type === 'dir'" @click="download">⬇ Télécharger</button>
      <button class="fbtn" @click="mkdir">Nouveau dossier</button>
      <button class="fbtn" :disabled="!state.sel" @click="rename">Renommer</button>
      <button class="fbtn" :disabled="!state.sel" @click="remove">Supprimer</button>
    </div>
    <div
      class="grid"
      :class="{ drop: state.gridDrop }"
      @dragover="onGridDragOver"
      @dragleave="onGridDragLeave"
      @drop="onGridDrop"
    >
      <div v-if="!state.entries.length" class="finder-empty">Dossier vide</div>
      <div
        v-for="e in state.entries"
        :key="e.name"
        class="cell"
        :class="{ sel: state.sel && state.sel.name === e.name, drop: dropTarget === e.name }"
        draggable="true"
        @click="select(e)"
        @dblclick="dblclick(e)"
        @dragstart="onDragStart($event, e)"
        @dragover="onCellDragOver($event, e)"
        @dragleave="onCellDragLeave(e)"
        @drop="onCellDrop($event, e)"
      >
        <div class="ic">{{ icoFor(e) }}</div>
        <div class="nm">{{ e.name }}</div>
      </div>
    </div>
    <input ref="uplInput" type="file" multiple style="display:none" @change="onUpload">
  </WindowFrame>
</template>
