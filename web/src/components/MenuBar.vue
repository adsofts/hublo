<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { useWindowsStore } from '../stores/windows.js'

const auth = useAuthStore()
const windows = useWindowsStore()

const clock = ref('')
let iv = null
const days = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']

function tick () {
  const d = new Date()
  clock.value = days[d.getDay()] + ' ' +
    d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + '  ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

onMounted(() => { tick(); iv = setInterval(tick, 1000) })
onUnmounted(() => clearInterval(iv))

async function logout () {
  await auth.logout()
}
</script>

<template>
  <div class="menubar">
    <div class="menu-left">
      <span class="apple"></span>
      <span class="menu-app">{{ windows.activeApp }}</span>
      <span class="menu-item">Fichier</span>
      <span class="menu-item">Édition</span>
      <span class="menu-item">Présentation</span>
    </div>
    <div class="menu-right">
      <span class="menu-item">{{ auth.username }}</span>
      <span class="menu-item" title="Se déconnecter" @click="logout">⏻</span>
      <span class="menu-clock">{{ clock }}</span>
    </div>
  </div>
</template>
