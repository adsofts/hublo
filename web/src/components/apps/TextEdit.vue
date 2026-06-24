<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { monaco, langFor } from '../../monaco-env.js'
import { api, baseName, fmtSize } from '../../api.js'
import { useAuthStore } from '../../stores/auth.js'
import { useWindowsStore } from '../../stores/windows.js'
import { useToastStore } from '../../stores/toast.js'

const auth = useAuthStore()
const windows = useWindowsStore()
const toast = useToastStore()

const tp = defineProps({ winId: { type: Number, required: true } })
const win = computed(() => windows.byId(tp.winId))

const editorHost = ref(null)
let editor = null
let resizeObs = null

const curPath = ref(null)
const dirty = ref(false)
const status = ref('')

const docName = computed(() => curPath.value || 'Nouveau document')

function setTitle (t) { windows.setTitle(tp.winId, t) }

async function openPath (path) {
  if (!editor) return
  curPath.value = path
  if (!path) {
    editor.setValue('')
    monaco.editor.setModelLanguage(editor.getModel(), 'plaintext')
    status.value = ''
    dirty.value = false
    setTitle('TextEdit')
    return
  }
  status.value = 'chargement…'
  try {
    const d = await api.read(path, win.value?.host)
    editor.setValue(d.content)
    monaco.editor.setModelLanguage(editor.getModel(), langFor(path))
    status.value = fmtSize(d.size)
    dirty.value = false
    setTitle(baseName(path))
  } catch (ex) {
    editor.setValue('')
    status.value = ''
    curPath.value = null
    setTitle('TextEdit')
    toast.show(ex.message)
  }
}

async function save () {
  if (win.value?.host) { toast.show('Lecture seule (lecteur réseau)'); return }
  let path = curPath.value
  if (!path) {
    path = prompt('Chemin du fichier à enregistrer :', (auth.home || '') + '/sans-titre.txt')
    if (!path) return
    curPath.value = path
    monaco.editor.setModelLanguage(editor.getModel(), langFor(path))
    setTitle(baseName(path))
  }
  try {
    await api.write(path, editor.getValue())
    status.value = 'enregistré ✓'
    dirty.value = false
    toast.show('Enregistré')
  } catch (ex) { toast.show(ex.message) }
}

onMounted(async () => {
  await nextTick()
  editor = monaco.editor.create(editorHost.value, {
    value: '',
    language: 'plaintext',
    theme: 'vs',
    fontSize: 13,
    automaticLayout: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    readOnly: !!win.value?.host,
    fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
  })
  editor.onDidChangeModelContent(() => {
    if (curPath.value) { dirty.value = true; status.value = '• modifié' }
  })
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save())

  resizeObs = new ResizeObserver(() => editor && editor.layout())
  resizeObs.observe(editorHost.value)

  // charge le fichier demandé à l'ouverture, le cas échéant
  await openPath(win.value?.path || null)
})

onBeforeUnmount(() => {
  resizeObs && resizeObs.disconnect()
  editor && editor.dispose()
})

// recharge si on rouvre TextEdit avec un nouveau chemin
watch(() => win.value && win.value.path, (p, old) => {
  if (editor) editor.updateOptions({ readOnly: !!win.value?.host })
  if (p && p !== old && p !== curPath.value) openPath(p)
})
</script>

<template>
  <WindowFrame :win-id="winId" body-class="flexcol">
    <div class="te-bar">
      <span class="te-name">{{ docName }}</span>
      <button class="fbtn" @click="save" :disabled="!!win?.host">Enregistrer</button>
      <span class="te-status">{{ win?.host ? '🌐 lecture seule' : status }}</span>
    </div>
    <div ref="editorHost" class="te-editor"></div>
  </WindowFrame>
</template>
