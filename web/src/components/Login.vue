<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'

const auth = useAuthStore()
const user = ref('')
const pass = ref('')
const error = ref('')
const busy = ref(false)

async function submit () {
  error.value = ''
  busy.value = true
  try {
    await auth.login(user.value.trim(), pass.value)
    pass.value = ''
  } catch (ex) {
    error.value = ex.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login-screen">
    <div class="login-card">
      <div class="login-avatar">👤</div>
      <h1 class="login-name">Hublo</h1>
      <p class="login-sub">Votre espace, sur le serveur.</p>
      <form id="login-form" autocomplete="off" @submit.prevent="submit">
        <input
          v-model="user"
          type="text"
          placeholder="utilisateur"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          required
        >
        <input v-model="pass" type="password" placeholder="mot de passe" required>
        <button type="submit" id="login-btn" :disabled="busy">
          {{ busy ? 'Connexion…' : 'Se connecter →' }}
        </button>
      </form>
      <div class="login-error">{{ error }}</div>
    </div>
    <div class="login-foot">Hublo · POC</div>
  </div>
</template>
