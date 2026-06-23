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

async function logout () { await auth.logout() }

// ---- menus déroulants ----
const openMenu = ref(null)   // 'apple' | 'fichier' | 'presentation' | null
const ddLeft = ref(0)

function toggle (name, ev) {
  ev.stopPropagation()
  if (openMenu.value === name) { openMenu.value = null; return }
  openMenu.value = name
  ddLeft.value = ev.currentTarget.getBoundingClientRect().left
}
function hover (name, ev) {
  if (!openMenu.value) return            // ne s'ouvre au survol que si un menu est déjà ouvert
  openMenu.value = name
  ddLeft.value = ev.currentTarget.getBoundingClientRect().left
}
function closeMenus () { openMenu.value = null }
function run (it) {
  if (it.disabled) return
  openMenu.value = null
  it.act()
}

const menus = {
  apple: [
    { label: 'À propos de Hublo', act: () => windows.open('about') },
    { sep: true },
    { label: 'Se déconnecter', act: logout }
  ],
  fichier: [
    { label: 'Nouvelle fenêtre Finder', act: () => windows.open('finder') },
    { label: 'Nouveau document', act: () => windows.open('textedit', { path: null, title: 'TextEdit' }) },
    { label: 'Nouveau terminal', act: () => windows.open('terminal') }
  ],
  presentation: [
    { label: 'Moniteur d’activité', act: () => windows.open('monitor') },
    { sep: true },
    { label: '(astuce) double-clic sur une image dans le Finder pour l’aperçu', disabled: true, act: () => {} }
  ]
}

onMounted(() => { tick(); iv = setInterval(tick, 1000); document.addEventListener('click', closeMenus) })
onUnmounted(() => { clearInterval(iv); document.removeEventListener('click', closeMenus) })
</script>

<template>
  <div class="menubar">
    <div class="menu-left">
      <span class="apple" :class="{ active: openMenu === 'apple' }"
            @click="toggle('apple', $event)" @mouseenter="hover('apple', $event)"></span>
      <span class="menu-app">{{ windows.activeApp }}</span>
      <span class="menu-trigger" :class="{ active: openMenu === 'fichier' }"
            @click="toggle('fichier', $event)" @mouseenter="hover('fichier', $event)">Fichier</span>
      <span class="menu-trigger" :class="{ active: openMenu === 'presentation' }"
            @click="toggle('presentation', $event)" @mouseenter="hover('presentation', $event)">Présentation</span>
    </div>
    <div class="menu-right">
      <span class="menu-item">{{ auth.username }}</span>
      <span class="menu-item" title="Se déconnecter" @click="logout">⏻</span>
      <span class="menu-clock">{{ clock }}</span>
    </div>

    <div v-if="openMenu" class="menu-dd" :style="{ left: ddLeft + 'px' }" @click.stop>
      <template v-for="(it, i) in menus[openMenu]" :key="i">
        <div v-if="it.sep" class="dd-sep"></div>
        <div v-else class="dd-item" :class="{ disabled: it.disabled }" @click="run(it)">{{ it.label }}</div>
      </template>
    </div>
  </div>
</template>
