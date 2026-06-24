<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { monaco } from '../../monaco-env.js'
import { api } from '../../api.js'
import { useToastStore } from '../../stores/toast.js'

const { t } = useI18n()
defineProps({ winId: { type: Number, required: true } })
const toast = useToastStore()

const conns = ref([])
const connId = ref('')
const tables = ref([])
const showForm = ref(false)
const running = ref(false)
const result = ref(null)
const editorHost = ref(null)
let editor = null

function blank () { return { id: null, label: '', host: '127.0.0.1', port: 5432, database: '', user: '', password: '' } }
const form = reactive(blank())

async function loadConns () {
  try { conns.value = (await api.dbList()).conns; if (!connId.value && conns.value.length) connId.value = conns.value[0].id }
  catch (ex) { toast.show(ex.message) }
}
async function loadTables () {
  tables.value = []
  if (!connId.value) return
  try { tables.value = (await api.dbTables(connId.value)).tables } catch (ex) { toast.show(ex.message) }
}
function onConnChange () { result.value = null; loadTables() }

async function run () {
  if (!connId.value) { toast.show(t('db.pickConnection')); return }
  const sql = editor ? editor.getValue().trim() : ''
  if (!sql) return
  running.value = true; result.value = null
  try { result.value = await api.dbQuery(connId.value, sql) }
  catch (ex) { result.value = { error: ex.message } }
  running.value = false
}
function pickTable (t) {
  const q = 'SELECT * FROM "' + t.schema + '"."' + t.name + '" LIMIT 100;'
  if (editor) editor.setValue(q)
  run()
}

function newConn () { Object.assign(form, blank()); showForm.value = true }
function editConn () { const c = conns.value.find(x => x.id === connId.value); if (c) { Object.assign(form, blank(), c, { password: '' }); showForm.value = true } }
async function saveConn () {
  if (!form.database || !form.user) { toast.show(t('db.dbUserRequired')); return }
  try { const r = await api.dbSave({ ...form, port: Number(form.port) || 5432 }); connId.value = r.id; showForm.value = false; await loadConns(); loadTables(); toast.show(t('db.saved')) }
  catch (ex) { toast.show(ex.message) }
}
async function delConn () {
  const c = conns.value.find(x => x.id === connId.value); if (!c) return
  if (!confirm(t('db.confirmDelete', { name: c.label || c.database }))) return
  try { await api.dbDelete(c.id); connId.value = ''; showForm.value = false; await loadConns(); loadTables() } catch (ex) { toast.show(ex.message) }
}
async function testConn () {
  if (!connId.value) return
  try { const r = await api.dbTest(connId.value); toast.show('✅ ' + r.version.split(',')[0]) } catch (ex) { toast.show('❌ ' + ex.message) }
}

onMounted(async () => {
  await nextTick()
  editor = monaco.editor.create(editorHost.value, {
    value: 'SELECT 1;', language: 'sql', theme: 'vs', fontSize: 13,
    minimap: { enabled: false }, automaticLayout: false, scrollBeyondLastLine: false
  })
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => run())
  const ro = new ResizeObserver(() => editor && editor.layout()); ro.observe(editorHost.value); editor._ro = ro
  await loadConns(); loadTables()
})
onBeforeUnmount(() => { try { editor._ro && editor._ro.disconnect(); editor && editor.dispose() } catch {} })
</script>

<template>
  <WindowFrame :win-id="winId" body-class="flexcol">
    <div class="finder-bar">
      <select class="tr-host" v-model="connId" @change="onConnChange">
        <option value="" disabled>{{ t('db.connection') }}</option>
        <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.label || c.database }}</option>
      </select>
      <button class="fbtn" :disabled="!connId" @click="testConn">{{ t('db.test') }}</button>
      <button class="fbtn" :title="t('db.newConnection')" @click="newConn">＋</button>
      <button class="fbtn" :disabled="!connId" @click="editConn">{{ t('db.edit') }}</button>
      <button class="fbtn" :disabled="!connId" @click="delConn" :title="t('db.delete')">✕</button>
      <span class="fspace"></span>
      <button class="fbtn primary" :disabled="running || !connId" @click="run">{{ running ? '…' : t('db.run') }}</button>
    </div>

    <div v-if="showForm" class="db-form">
      <input v-model="form.label" :placeholder="t('db.name')" style="flex:1">
      <input v-model="form.host" :placeholder="t('db.host')" style="width:130px">
      <input v-model.number="form.port" type="number" :placeholder="t('db.port')" style="width:70px">
      <input v-model="form.database" :placeholder="t('db.database')" style="width:130px">
      <input v-model="form.user" :placeholder="t('db.user')" style="width:120px">
      <input v-model="form.password" type="password" :placeholder="form.id ? t('db.unchangedIfEmpty') : t('db.password')" style="width:140px">
      <button class="fbtn primary" @click="saveConn">{{ t('db.save') }}</button>
      <button class="fbtn" @click="showForm = false">{{ t('db.cancel') }}</button>
    </div>

    <div class="db-main">
      <div class="db-side">
        <div class="side-sec">{{ t('db.tables', { n: tables.length }) }}</div>
        <div v-for="tb in tables" :key="tb.schema + '.' + tb.name" class="side-item" :title="tb.schema + '.' + tb.name" @click="pickTable(tb)"><span>🧱</span> {{ tb.name }}</div>
        <div v-if="!tables.length" class="finder-empty" style="font-size:12px">{{ t('db.none') }}</div>
      </div>
      <div class="db-work">
        <div ref="editorHost" class="db-editor"></div>
        <div class="db-result">
          <div v-if="result && result.error" class="db-err">{{ result.error }}</div>
          <template v-else-if="result">
            <div class="db-meta">{{ t('db.rows', { command: result.command, n: result.rowCount }) }}{{ result.truncated ? t('db.truncated') : '' }}</div>
            <div v-if="result.columns.length" class="db-table-wrap">
              <table class="db-table">
                <thead><tr><th v-for="c in result.columns" :key="c">{{ c }}</th></tr></thead>
                <tbody><tr v-for="(row, i) in result.rows" :key="i"><td v-for="(cell, j) in row" :key="j" :class="{ dbnull: cell === null }">{{ cell === null ? 'NULL' : cell }}</td></tr></tbody>
              </table>
            </div>
          </template>
          <div v-else class="finder-empty" style="font-size:13px">{{ t('db.queryHint') }}</div>
        </div>
      </div>
    </div>
  </WindowFrame>
</template>
