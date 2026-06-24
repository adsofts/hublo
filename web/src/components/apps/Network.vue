<script setup>
import { ref, reactive, onMounted } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useToastStore } from '../../stores/toast.js'

const toast = useToastStore()
const hosts = ref([])
function blank () { return { id: null, label: '', host: '', port: 22, user: '', auth: 'key', password: '', privateKey: '' } }
const form = reactive(blank())

async function load () { try { hosts.value = (await api.hostsList()).hosts } catch (ex) { toast.show(ex.message) } }
function edit (h) { Object.assign(form, blank(), h, { password: '', privateKey: '' }) }
function reset () { Object.assign(form, blank()) }
async function save () {
  if (!form.host || !form.user) { toast.show('Hôte et utilisateur requis'); return }
  try {
    const p = { id: form.id, label: form.label, host: form.host, port: Number(form.port) || 22, user: form.user, auth: form.auth }
    if (form.auth === 'password') p.password = form.password
    else if (form.privateKey.trim()) p.privateKey = form.privateKey
    await api.hostSave(p); toast.show('Enregistré'); reset(); load()
  } catch (ex) { toast.show(ex.message) }
}
async function del (h) {
  if (!confirm('Supprimer le lecteur « ' + (h.label || h.host) + ' » ?')) return
  try { await api.hostDelete(h.id); toast.show('Supprimé'); load() } catch (ex) { toast.show(ex.message) }
}
async function test (h) {
  toast.show('Test de connexion…')
  try { const r = await api.hostTest(h.id); toast.show('✅ Connecté — ' + r.home) } catch (ex) { toast.show('❌ ' + ex.message) }
}
onMounted(load)
</script>

<template>
  <WindowFrame app="network">
    <div class="net">
      <div class="net-list">
        <div class="net-title">Mes lecteurs réseau</div>
        <div v-if="!hosts.length" class="net-empty">Aucun hôte enregistré.</div>
        <div v-for="h in hosts" :key="h.id" class="net-row">
          <span class="net-ic">🌐</span>
          <div class="net-info">
            <div class="net-name">{{ h.label || h.host }}</div>
            <div class="net-sub">{{ h.user }}@{{ h.host }}:{{ h.port }} · {{ h.auth === 'key' ? 'clé' : 'mot de passe' }}</div>
          </div>
          <button class="fbtn" @click="test(h)">Tester</button>
          <button class="fbtn" @click="edit(h)">Éditer</button>
          <button class="fbtn" @click="del(h)" title="Supprimer">✕</button>
        </div>
      </div>
      <div class="net-form">
        <div class="net-title">{{ form.id ? 'Modifier l’hôte' : 'Ajouter un hôte' }}</div>
        <label>Nom<input v-model="form.label" placeholder="Mon serveur"></label>
        <div class="net-2">
          <label class="grow">Hôte<input v-model="form.host" placeholder="exemple.com / IP" autocapitalize="none" spellcheck="false"></label>
          <label class="port">Port<input v-model="form.port" type="number"></label>
        </div>
        <label>Utilisateur<input v-model="form.user" placeholder="root" autocapitalize="none" spellcheck="false"></label>
        <label>Authentification
          <select v-model="form.auth"><option value="key">Clé privée</option><option value="password">Mot de passe</option></select>
        </label>
        <label v-if="form.auth === 'password'">Mot de passe<input v-model="form.password" type="password" :placeholder="form.id ? '(inchangé si vide)' : ''"></label>
        <label v-else>Clé privée (PEM)<textarea v-model="form.privateKey" rows="4" spellcheck="false" :placeholder="form.id ? '(inchangée si vide)' : '-----BEGIN OPENSSH PRIVATE KEY-----'"></textarea></label>
        <div class="net-actions">
          <button class="fbtn primary" @click="save">{{ form.id ? 'Mettre à jour' : 'Ajouter' }}</button>
          <button v-if="form.id" class="fbtn" @click="reset">Annuler</button>
        </div>
      </div>
    </div>
  </WindowFrame>
</template>
