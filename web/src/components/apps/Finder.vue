<script setup>
import { ref, reactive } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api, join, icoFor, isImage, isPdf, isArchive } from '../../api.js'
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
  gridDrop: false,
  query: '',
  searching: false
})
const dropTarget = ref(null) // nom du dossier survolé en drag
const uplInput = ref(null)
const clipboard = ref(null)  // { path, name, mode: 'copy' | 'cut' }
const ctx = reactive({ show: false, x: 0, y: 0, e: null })

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
function entryPath (e) { return e.path || join(state.path, e.name) }
function dirOf (p) { const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : '/' }

// recherche de fichiers (find côté serveur, dans le dossier courant)
let searchTimer = null
function onSearchInput () {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => doSearch(state.query), 300)
}
async function doSearch (q) {
  if (!q || q.trim().length < 2) {
    if (state.searching) { state.searching = false; load(state.path, false) }
    return
  }
  try {
    const d = await api.search(state.path, q.trim())
    state.entries = d.entries
    state.sel = null
    state.searching = true
  } catch (ex) { toast.show(ex.message) }
}
function refresh () { if (state.searching) doSearch(state.query); else load(state.path, false) }

function dblclick (e) {
  const full = entryPath(e)
  if (e.type === 'dir') { state.query = ''; state.searching = false; load(full) }
  else if (isImage(e.name) || isPdf(e.name)) windows.open('preview', { path: full, title: e.name })
  else windows.open('textedit', { path: full })
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
  try { const src = entryPath(state.sel); await api.rename(src, join(dirOf(src), n)); refresh(); toast.show('Renommé') }
  catch (ex) { toast.show(ex.message) }
}

async function remove () {
  if (!state.sel) return
  if (!confirm('Mettre « ' + state.sel.name + ' » à la corbeille ?')) return
  try { await api.remove(entryPath(state.sel)); refresh(); toast.show('Supprimé') }
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
  a.href = api.downloadUrl(entryPath(state.sel))
  a.download = state.sel.name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function compress () {
  if (!state.sel) return
  try { const d = await api.compress(entryPath(state.sel)); refresh(); toast.show('Archive créée : ' + d.name) }
  catch (ex) { toast.show(ex.message) }
}
async function extract () {
  if (!state.sel) return
  try { await api.extract(entryPath(state.sel)); refresh(); toast.show('Extrait') }
  catch (ex) { toast.show(ex.message) }
}

// ---- menu contextuel (clic droit) ----
function openCtx (ev, e) {
  ev.preventDefault(); ev.stopPropagation()
  if (e) state.sel = e
  ctx.e = e
  ctx.x = Math.min(ev.clientX, window.innerWidth - 215)
  ctx.y = Math.min(ev.clientY, window.innerHeight - 340)
  ctx.show = true
  document.addEventListener('click', closeCtx)
  document.addEventListener('contextmenu', closeCtx)
}
function closeCtx () {
  ctx.show = false
  document.removeEventListener('click', closeCtx)
  document.removeEventListener('contextmenu', closeCtx)
}
function copyItem (e) { clipboard.value = { path: entryPath(e), name: e.name, mode: 'copy' }; toast.show('Copié') }
function cutItem (e) { clipboard.value = { path: entryPath(e), name: e.name, mode: 'cut' }; toast.show('Coupé') }
async function paste () {
  if (!clipboard.value) return
  const dest = join(state.path, clipboard.value.name)
  try {
    if (clipboard.value.mode === 'copy') await api.copy(clipboard.value.path, dest)
    else { await api.rename(clipboard.value.path, dest); clipboard.value = null }
    refresh(); toast.show('Collé')
  } catch (ex) { toast.show(ex.message) }
}
function properties (e) { windows.open('props', { path: entryPath(e), title: 'Infos — ' + e.name }) }

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
      <input class="fsearch" type="search" placeholder="Rechercher…" v-model="state.query" @input="onSearchInput">
      <button class="fbtn" title="Importer des fichiers" @click="importClick">⬆ Importer</button>
      <button class="fbtn" :disabled="!state.sel || state.sel.type === 'dir'" @click="download">⬇ Télécharger</button>
      <button class="fbtn" @click="mkdir">Nouveau dossier</button>
      <button class="fbtn" :disabled="!state.sel" @click="rename">Renommer</button>
      <button class="fbtn" :disabled="!state.sel" @click="remove">Supprimer</button>
      <button class="fbtn" :disabled="!state.sel" @click="compress" title="Compresser en .tar.gz">Compresser</button>
      <button v-if="state.sel && isArchive(state.sel.name)" class="fbtn" @click="extract">Extraire</button>
    </div>
    <div
      class="grid"
      :class="{ drop: state.gridDrop }"
      @dragover="onGridDragOver"
      @dragleave="onGridDragLeave"
      @drop="onGridDrop"
      @contextmenu="openCtx($event, null)"
    >
      <div v-if="!state.entries.length" class="finder-empty">{{ state.searching ? 'Aucun résultat' : 'Dossier vide' }}</div>
      <div
        v-for="e in state.entries"
        :key="entryPath(e)"
        class="cell"
        :class="{ sel: state.sel && entryPath(state.sel) === entryPath(e), drop: dropTarget === e.name }"
        :title="entryPath(e)"
        draggable="true"
        @click="select(e)"
        @dblclick="dblclick(e)"
        @contextmenu="openCtx($event, e)"
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

    <Teleport to="body">
    <div v-if="ctx.show" class="ctx" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }" @click.stop>
      <template v-if="ctx.e">
        <div class="ctx-item" @click="dblclick(ctx.e); closeCtx()">Ouvrir</div>
        <div v-if="ctx.e.type !== 'dir'" class="ctx-item" @click="download(); closeCtx()">Télécharger</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item" @click="copyItem(ctx.e); closeCtx()">Copier</div>
        <div class="ctx-item" @click="cutItem(ctx.e); closeCtx()">Couper</div>
        <div v-if="clipboard" class="ctx-item" @click="paste(); closeCtx()">Coller</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item" @click="rename(); closeCtx()">Renommer…</div>
        <div class="ctx-item" @click="compress(); closeCtx()">Compresser</div>
        <div v-if="isArchive(ctx.e.name)" class="ctx-item" @click="extract(); closeCtx()">Extraire</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item danger" @click="remove(); closeCtx()">Mettre à la corbeille</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item" @click="properties(ctx.e); closeCtx()">Propriétés…</div>
      </template>
      <template v-else>
        <div class="ctx-item" @click="mkdir(); closeCtx()">Nouveau dossier</div>
        <div class="ctx-item" @click="importClick(); closeCtx()">Importer des fichiers…</div>
        <div v-if="clipboard" class="ctx-item" @click="paste(); closeCtx()">Coller</div>
      </template>
    </div>
    </Teleport>
  </WindowFrame>
</template>
