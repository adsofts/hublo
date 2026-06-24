<script setup>
import { ref, computed, onMounted } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useWindowsStore } from '../../stores/windows.js'
import { useToastStore } from '../../stores/toast.js'

const wp = defineProps({ winId: { type: Number, required: true } })
const windows = useWindowsStore()
const toast = useToastStore()
const win = computed(() => windows.byId(wp.winId))

const drives = ref([])
const host = ref(null)
const repoPath = ref('')
const status = ref(null)
const sel = ref(null)
const diff = ref('')
const log = ref([])
const tab = ref('diff')
const commitMsg = ref('')
const busy = ref(false)

const dir = () => repoPath.value.trim()
async function loadDrives () { try { drives.value = (await api.hostsList()).hosts } catch { /* */ } }
async function refresh () {
  if (!dir()) return
  busy.value = true
  try {
    status.value = await api.gitStatus(dir(), host.value)
    if (status.value.isRepo) loadLog(); else { log.value = []; diff.value = ''; sel.value = null }
  } catch (ex) { toast.show(ex.message) }
  busy.value = false
}
async function loadLog () { try { log.value = (await api.gitLog(dir(), host.value)).commits } catch { /* */ } }
async function selectFile (file, mode) {
  sel.value = { file, mode }; tab.value = 'diff'
  try { diff.value = (await api.gitDiff(dir(), file, mode, host.value)).diff } catch (ex) { diff.value = ''; toast.show(ex.message) }
}
async function stage (file) { try { await api.gitStage(dir(), file, host.value); refresh() } catch (ex) { toast.show(ex.message) } }
async function unstage (file) { try { await api.gitUnstage(dir(), file, host.value); refresh() } catch (ex) { toast.show(ex.message) } }
async function stageAll () { try { await api.gitStage(dir(), '', host.value); refresh() } catch (ex) { toast.show(ex.message) } }
async function commit () {
  if (!commitMsg.value.trim()) { toast.show('Message requis'); return }
  if (!status.value?.staged?.length) { toast.show('Rien d’indexé'); return }
  busy.value = true
  try { await api.gitCommit(dir(), commitMsg.value.trim(), host.value); commitMsg.value = ''; toast.show('Commit créé'); refresh() }
  catch (ex) { toast.show(ex.message) }
  busy.value = false
}
async function pull () { busy.value = true; try { const r = await api.gitPull(dir(), host.value); toast.show('Pull : ' + ((r.output || '').trim().split('\n').pop() || 'ok')); refresh() } catch (ex) { toast.show('Pull : ' + ex.message) } busy.value = false }
async function push () { busy.value = true; try { const r = await api.gitPush(dir(), host.value); toast.show('Push : ' + ((r.output || '').trim().split('\n').pop() || 'ok')); refresh() } catch (ex) { toast.show('Push : ' + ex.message) } busy.value = false }

const diffLines = computed(() => (diff.value ? diff.value.split('\n') : []))
function lineClass (l) {
  if (l.startsWith('+') && !l.startsWith('+++')) return 'g-add'
  if (l.startsWith('-') && !l.startsWith('---')) return 'g-del'
  if (l.startsWith('@@')) return 'g-hunk'
  if (l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('+++') || l.startsWith('---')) return 'g-dmeta'
  return ''
}

onMounted(() => {
  loadDrives()
  const w = win.value
  if (w && w.path) { repoPath.value = w.path; host.value = w.host || null; refresh() }
})
</script>

<template>
  <WindowFrame :win-id="winId" body-class="flexcol">
    <div class="finder-bar">
      <input class="fpath logp" v-model="repoPath" placeholder="/chemin/vers/le/dépôt" spellcheck="false" @keydown.enter="refresh">
      <select class="tr-host" v-model="host" @change="refresh">
        <option :value="null">🖥️ local</option>
        <option v-for="d in drives" :key="d.id" :value="d.id">🌐 {{ d.label || d.host }}</option>
      </select>
      <button class="fbtn" @click="refresh">⟳</button>
      <template v-if="status && status.isRepo">
        <span class="g-branch">⎇ {{ status.branch }}<span v-if="status.ahead"> ↑{{ status.ahead }}</span><span v-if="status.behind"> ↓{{ status.behind }}</span></span>
        <button class="fbtn" :disabled="busy" @click="pull">⬇ Pull</button>
        <button class="fbtn" :disabled="busy" @click="push">⬆ Push</button>
      </template>
    </div>

    <div v-if="status && !status.isRepo" class="finder-empty">Pas un dépôt git ici.<br><span style="font-size:12px;opacity:.6">{{ status.message }}</span></div>
    <div v-else-if="!status" class="finder-empty" style="font-size:13px">Indique le chemin d'un dépôt git puis ⟳.</div>

    <div v-else class="git-main">
      <div class="git-left">
        <div class="git-sec">Indexé ({{ status.staged.length }}) <button v-if="status.staged.length" class="g-mini" @click="unstage('')">tout retirer</button></div>
        <div v-for="f in status.staged" :key="'s' + f.path" class="git-file" :class="{ sel: sel && sel.file === f.path && sel.mode === 'staged' }" @click="selectFile(f.path, 'staged')">
          <span class="g-st g-stg">{{ f.st }}</span><span class="g-fname">{{ f.path }}</span><button class="g-mini" @click.stop="unstage(f.path)">−</button>
        </div>
        <div class="git-sec">Modifié ({{ status.unstaged.length }}) <button v-if="status.unstaged.length" class="g-mini" @click="stageAll">tout indexer</button></div>
        <div v-for="f in status.unstaged" :key="'u' + f.path" class="git-file" :class="{ sel: sel && sel.file === f.path && sel.mode === 'unstaged' }" @click="selectFile(f.path, 'unstaged')">
          <span class="g-st g-mod">{{ f.st }}</span><span class="g-fname">{{ f.path }}</span><button class="g-mini" @click.stop="stage(f.path)">+</button>
        </div>
        <div class="git-sec">Non suivi ({{ status.untracked.length }})</div>
        <div v-for="p in status.untracked" :key="'t' + p" class="git-file" :class="{ sel: sel && sel.file === p && sel.mode === 'untracked' }" @click="selectFile(p, 'untracked')">
          <span class="g-st g-new">?</span><span class="g-fname">{{ p }}</span><button class="g-mini" @click.stop="stage(p)">+</button>
        </div>
        <div class="git-commit">
          <textarea v-model="commitMsg" placeholder="Message de commit…" rows="2"></textarea>
          <button class="fbtn primary" :disabled="busy || !status.staged.length" @click="commit">Committer ({{ status.staged.length }})</button>
        </div>
      </div>
      <div class="git-right">
        <div class="git-tabs">
          <button :class="{ on: tab === 'diff' }" @click="tab = 'diff'">Diff</button>
          <button :class="{ on: tab === 'log' }" @click="tab = 'log'">Historique</button>
        </div>
        <div v-if="tab === 'diff'" class="gdiff">
          <div v-if="!sel" class="finder-empty" style="font-size:13px">Sélectionne un fichier pour voir son diff.</div>
          <div v-else-if="!diff" class="finder-empty" style="font-size:13px">(aucune différence)</div>
          <div v-else><div v-for="(l, i) in diffLines" :key="i" class="gline" :class="lineClass(l)">{{ l || ' ' }}</div></div>
        </div>
        <div v-else class="gitlog">
          <div v-for="c in log" :key="c.hash" class="gitlog-row"><span class="g-hash">{{ c.hash }}</span> <span class="g-subj">{{ c.subject }}</span><div class="g-when">{{ c.author }} · {{ c.when }}</div></div>
          <div v-if="!log.length" class="finder-empty" style="font-size:12px">aucun commit</div>
        </div>
      </div>
    </div>
  </WindowFrame>
</template>
