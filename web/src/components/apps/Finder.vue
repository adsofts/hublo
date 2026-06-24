<script setup>
import { ref, reactive, computed, watch } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api, join, icoFor, isImage, isPdf, isArchive } from '../../api.js'
import { useAuthStore } from '../../stores/auth.js'
import { useWindowsStore } from '../../stores/windows.js'
import { useToastStore } from '../../stores/toast.js'

const wp = defineProps({ winId: { type: Number, required: true } })
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
  searching: false,
  host: null,        // null = local, sinon id de lecteur réseau
  hostLabel: ''
})
const dropTarget = ref(null) // nom du dossier survolé en drag
const uplInput = ref(null)
const ctx = reactive({ show: false, x: 0, y: 0, e: null })

// ---- lecteurs réseau ----
const drives = ref([])
const isRemote = computed(() => !!state.host)
async function loadDrives () { try { drives.value = (await api.hostsList()).hosts } catch { /* ignore */ } }
function goLocal () { state.host = null; state.hostLabel = ''; state.hist = []; state.query = ''; state.searching = false; load(null, false) }
function goHost (d) { state.host = d.id; state.hostLabel = d.label || d.host; state.hist = []; state.query = ''; state.searching = false; load(null, false) }

async function load (p, push = true) {
  try {
    const d = await api.list(p, state.host)
    if (push && state.path && state.path !== d.path) state.hist.push(state.path)
    state.path = d.path
    state.parent = d.parent
    state.sel = null
    state.entries = d.entries
    windows.setTitle(wp.winId, (state.host ? '🌐 ' + state.hostLabel + ' · ' : '') + state.path)
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
    const d = await api.search(state.path, q.trim(), state.host)
    state.entries = d.entries
    state.sel = null
    state.searching = true
  } catch (ex) { toast.show(ex.message) }
}
function refresh () { if (state.searching) doSearch(state.query); else load(state.path, false) }

function dblclick (e) {
  const full = entryPath(e)
  if (e.type === 'dir') { state.query = ''; state.searching = false; load(full) }
  else if (isImage(e.name) || isPdf(e.name)) windows.open('preview', { path: full, title: e.name, host: state.host })
  else windows.open('textedit', { path: full, host: state.host })
}

function goUp () { if (state.parent) load(state.parent) }
function goBack () { const p = state.hist.pop(); if (p) load(p, false) }
function reload () { load(state.path, false) }
function goPath () { const p = prompt('Aller au dossier :', state.path); if (p) load(p) }

async function mkdir () {
  const n = prompt('Nom du nouveau dossier :')
  if (!n) return
  try { await api.mkdir(join(state.path, n), state.host); refresh(); toast.show('Dossier créé') }
  catch (ex) { toast.show(ex.message) }
}

async function rename () {
  if (!state.sel) return
  const n = prompt('Nouveau nom :', state.sel.name)
  if (!n || n === state.sel.name) return
  try { const src = entryPath(state.sel); await api.rename(src, join(dirOf(src), n), state.host); refresh(); toast.show('Renommé') }
  catch (ex) { toast.show(ex.message) }
}

async function remove () {
  if (!state.sel) return
  if (!confirm('Mettre « ' + state.sel.name + ' » à la corbeille ?')) return
  try { await api.remove(entryPath(state.sel), state.host); refresh(); toast.show('Supprimé') }
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
  a.href = api.downloadUrl(entryPath(state.sel), state.host)
  a.download = state.sel.name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function compress () {
  if (!state.sel) return
  try { const d = await api.compress(entryPath(state.sel), state.host); refresh(); toast.show('Archive créée : ' + d.name) }
  catch (ex) { toast.show(ex.message) }
}
async function extract () {
  if (!state.sel) return
  try { await api.extract(entryPath(state.sel), state.host); refresh(); toast.show('Extrait') }
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
function copyItem (e) { windows.setClip({ path: entryPath(e), name: e.name, mode: 'copy', host: state.host }); toast.show('Copié') }
function cutItem (e) { windows.setClip({ path: entryPath(e), name: e.name, mode: 'cut', host: state.host }); toast.show('Coupé') }
async function paste () {
  const c = windows.clip
  if (!c) return
  try {
    if ((c.host || null) !== (state.host || null)) {
      // transfert inter-hôtes (vrai stream serveur→serveur)
      await api.transfer(c.host || null, c.path, state.host || null, state.path, c.mode === 'cut' ? 'move' : 'copy')
      if (c.mode === 'cut') windows.setClip(null)
      refresh(); toast.show('Transféré')
      return
    }
    const dest = join(state.path, c.name)
    if (c.mode === 'copy') await api.copy(c.path, dest, state.host)
    else { await api.rename(c.path, dest, state.host); windows.setClip(null) }
    refresh(); toast.show('Collé')
  } catch (ex) { toast.show(ex.message) }
}
function properties (e) { windows.open('props', { path: entryPath(e), title: 'Infos — ' + e.name, host: state.host }) }

async function uploadFiles (files, destDir) {
  for (const f of files) {
    try { const d = await api.upload(f, destDir, state.host); toast.show('Importé : ' + d.name) }
    catch (ex) { toast.show(ex.message) }
  }
}

// ---- drag & drop ----
function onDragStart (ev, e) {
  // on transporte le chemin complet + l'hôte → déplaçable vers un autre Finder
  ev.dataTransfer.setData('application/x-hublo', JSON.stringify({ path: entryPath(e), name: e.name, host: state.host || null }))
  ev.dataTransfer.effectAllowed = 'move'
}
// déplace une source (drag interne, éventuellement d'une autre fenêtre) dans un dossier cible
async function moveInto (raw, destDir, okMsg) {
  let src
  try { src = JSON.parse(raw) } catch { return }
  if (!src || !src.path) return
  try {
    if ((src.host || null) !== (state.host || null)) {
      await api.transfer(src.host || null, src.path, state.host || null, destDir, 'move')
      refresh(); toast.show('Transféré'); return
    }
    const dest = join(destDir, src.name)
    if (dest === src.path) return
    await api.rename(src.path, dest, state.host); refresh(); toast.show(okMsg)
  } catch (ex) { toast.show(ex.message) }
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
  if (ev.dataTransfer.files.length) { await uploadFiles(ev.dataTransfer.files, folder); refresh(); return }
  const raw = ev.dataTransfer.getData('application/x-hublo')
  if (raw) await moveInto(raw, folder, 'Déplacé → ' + e.name)
}

function onGridDragOver (ev) {
  if (ev.dataTransfer.types.includes('Files') || ev.dataTransfer.types.includes('application/x-hublo')) { ev.preventDefault(); state.gridDrop = true }
}
function onGridDragLeave (ev) {
  if (ev.target.classList.contains('grid')) state.gridDrop = false
}
async function onGridDrop (ev) {
  state.gridDrop = false
  if (ev.dataTransfer.files.length) { ev.preventDefault(); await uploadFiles(ev.dataTransfer.files, state.path); refresh(); return }
  const raw = ev.dataTransfer.getData('application/x-hublo')
  if (raw) { ev.preventDefault(); await moveInto(raw, state.path, 'Déplacé') }
}

// chargement initial — honore un éventuel hôte demandé depuis le bureau
loadDrives()
const finderWin = computed(() => windows.byId(wp.winId))
if (finderWin.value?.gotoHost) { state.host = finderWin.value.gotoHost; load(null, false) }
else load(state.path, false)
watch(() => finderWin.value?.gotoHost, (hid, old) => {
  if (hid === old || hid === undefined) return
  if (!hid) { goLocal(); return }
  const d = drives.value.find(x => x.id === hid)
  state.host = hid; state.hostLabel = d ? (d.label || d.host) : ''
  state.hist = []; state.query = ''; state.searching = false; load(null, false)
})
</script>

<template>
  <WindowFrame :win-id="winId" body-class="finder-body">
    <div class="finder-side">
      <div class="side-sec">Emplacements</div>
      <div class="side-item" :class="{ active: !state.host }" @click="goLocal"><span>🖥️</span> Cet ordinateur</div>
      <div class="side-sec">Lecteurs réseau</div>
      <div v-for="d in drives" :key="d.id" class="side-item" :class="{ active: state.host === d.id }" :title="d.user + '@' + d.host" @click="goHost(d)"><span>🌐</span> {{ d.label || d.host }}</div>
      <div class="side-item dim" @click="windows.open('network')"><span>＋</span> Gérer…</div>
    </div>
    <div class="finder-main">
    <div class="finder-bar">
      <button class="fbtn" title="Précédent" :disabled="!state.hist.length" @click="goBack">‹</button>
      <button class="fbtn" title="Dossier parent" :disabled="!state.parent" @click="goUp">↑</button>
      <button class="fbtn" title="Rafraîchir" @click="reload">⟳</button>
      <button class="fbtn" title="Aller au dossier…" @click="goPath">📂 Aller à…</button>
      <span class="fspace"></span>
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
    </div>

    <Teleport to="body">
    <div v-if="ctx.show" class="ctx" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }" @click.stop>
      <template v-if="ctx.e">
        <div class="ctx-item" @click="dblclick(ctx.e); closeCtx()">Ouvrir</div>
        <div v-if="ctx.e.type !== 'dir'" class="ctx-item" @click="download(); closeCtx()">Télécharger</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item" @click="copyItem(ctx.e); closeCtx()">Copier</div>
        <div class="ctx-item" @click="cutItem(ctx.e); closeCtx()">Couper</div>
        <div v-if="windows.clip" class="ctx-item" @click="paste(); closeCtx()">Coller</div>
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
        <div v-if="windows.clip" class="ctx-item" @click="paste(); closeCtx()">Coller</div>
      </template>
    </div>
    </Teleport>
  </WindowFrame>
</template>
