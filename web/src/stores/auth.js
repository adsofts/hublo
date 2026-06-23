import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api.js'

export const useAuthStore = defineStore('auth', () => {
  const username = ref(null)
  const home = ref(null)
  const ready = ref(false) // true une fois la vérification /api/me terminée

  function setMe (d) {
    username.value = d.username
    home.value = d.home
  }

  async function boot () {
    try {
      const d = await api.me()
      setMe(d)
    } catch {
      username.value = null
      home.value = null
    } finally {
      ready.value = true
    }
  }

  async function login (user, pass) {
    const d = await api.login(user, pass)
    setMe(d)
    return d
  }

  async function logout () {
    try { await api.logout() } catch { /* ignore */ }
    username.value = null
    home.value = null
  }

  return { username, home, ready, boot, login, logout }
})
