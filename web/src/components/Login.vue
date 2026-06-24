<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth.js'

const { t } = useI18n()
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
      <p class="login-sub">{{ t('login.subtitle') }}</p>
      <form id="login-form" autocomplete="off" @submit.prevent="submit">
        <input
          v-model="user"
          type="text"
          :placeholder="t('login.user')"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          required
        >
        <input v-model="pass" type="password" :placeholder="t('login.password')" required>
        <button type="submit" id="login-btn" :disabled="busy">
          {{ busy ? t('login.connecting') : t('login.signIn') }}
        </button>
      </form>
      <div class="login-error">{{ error }}</div>
    </div>
    <div class="login-foot">{{ t('login.foot') }}</div>
  </div>
</template>
