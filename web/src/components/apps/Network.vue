<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useToastStore } from '../../stores/toast.js'

const { t } = useI18n()
defineProps({ winId: { type: Number, required: true } })
const toast = useToastStore()
const hosts = ref([])
function blank () { return { id: null, label: '', host: '', port: 22, user: '', auth: 'key', password: '', privateKey: '' } }
const form = reactive(blank())

async function load () { try { hosts.value = (await api.hostsList()).hosts } catch (ex) { toast.show(ex.message) } }
function edit (h) { Object.assign(form, blank(), h, { password: '', privateKey: '' }) }
function reset () { Object.assign(form, blank()) }
async function save () {
  if (!form.host || !form.user) { toast.show(t('network.hostUserRequired')); return }
  try {
    const p = { id: form.id, label: form.label, host: form.host, port: Number(form.port) || 22, user: form.user, auth: form.auth }
    if (form.auth === 'password') p.password = form.password
    else if (form.privateKey.trim()) p.privateKey = form.privateKey
    await api.hostSave(p); toast.show(t('network.saved')); reset(); load()
  } catch (ex) { toast.show(ex.message) }
}
async function del (h) {
  if (!confirm(t('network.confirmDelete', { name: h.label || h.host }))) return
  try { await api.hostDelete(h.id); toast.show(t('network.deleted')); load() } catch (ex) { toast.show(ex.message) }
}
async function test (h) {
  toast.show(t('network.testing'))
  try { const r = await api.hostTest(h.id); toast.show(t('network.connected', { home: r.home })) } catch (ex) { toast.show('❌ ' + ex.message) }
}
onMounted(load)
</script>

<template>
  <WindowFrame :win-id="winId">
    <div class="net">
      <div class="net-list">
        <div class="net-title">{{ t('network.myDrives') }}</div>
        <div v-if="!hosts.length" class="net-empty">{{ t('network.none') }}</div>
        <div v-for="h in hosts" :key="h.id" class="net-row">
          <span class="net-ic">🌐</span>
          <div class="net-info">
            <div class="net-name">{{ h.label || h.host }}</div>
            <div class="net-sub">{{ h.user }}@{{ h.host }}:{{ h.port }} · {{ h.auth === 'key' ? t('network.key') : t('network.password') }}</div>
          </div>
          <button class="fbtn" @click="test(h)">{{ t('network.test') }}</button>
          <button class="fbtn" @click="edit(h)">{{ t('network.edit') }}</button>
          <button class="fbtn" @click="del(h)" :title="t('network.delete')">✕</button>
        </div>
      </div>
      <div class="net-form">
        <div class="net-title">{{ form.id ? t('network.editHost') : t('network.addHost') }}</div>
        <label>{{ t('network.name') }}<input v-model="form.label" :placeholder="t('network.namePlaceholder')"></label>
        <div class="net-2">
          <label class="grow">{{ t('network.host') }}<input v-model="form.host" :placeholder="t('network.hostPlaceholder')" autocapitalize="none" spellcheck="false"></label>
          <label class="port">{{ t('network.port') }}<input v-model="form.port" type="number"></label>
        </div>
        <label>{{ t('network.user') }}<input v-model="form.user" :placeholder="t('network.userPlaceholder')" autocapitalize="none" spellcheck="false"></label>
        <label>{{ t('network.auth') }}
          <select v-model="form.auth"><option value="key">{{ t('network.privateKey') }}</option><option value="password">{{ t('network.passwordLabel') }}</option></select>
        </label>
        <label v-if="form.auth === 'password'">{{ t('network.passwordLabel') }}<input v-model="form.password" type="password" :placeholder="form.id ? t('network.unchangedFIfEmpty') : ''"></label>
        <label v-else>{{ t('network.privateKeyPem') }}<textarea v-model="form.privateKey" rows="4" spellcheck="false" :placeholder="form.id ? t('network.unchangedFIfEmpty') : '-----BEGIN OPENSSH PRIVATE KEY-----'"></textarea></label>
        <div class="net-actions">
          <button class="fbtn primary" @click="save">{{ form.id ? t('network.update') : t('network.add') }}</button>
          <button v-if="form.id" class="fbtn" @click="reset">{{ t('network.cancel') }}</button>
        </div>
      </div>
    </div>
  </WindowFrame>
</template>
