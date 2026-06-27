<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/auth.js'
import { useWindowsStore } from '../stores/windows.js'
import { useClipboardStore } from '../stores/clipboard.js'
import { setLocale } from '../i18n.js'

const { t, tm, locale } = useI18n()
const auth = useAuthStore()
const windows = useWindowsStore()
const clipStore = useClipboardStore()

const clock = ref('')
let iv = null
const localeTag = computed(() => (locale.value === 'fr' ? 'fr-FR' : 'en-US'))

function tick () {
  const d = new Date()
  const days = tm('menubar.days')
  clock.value = days[d.getDay()] + ' ' +
    d.toLocaleDateString(localeTag.value, { day: 'numeric', month: 'short' }) + '  ' +
    d.toLocaleTimeString(localeTag.value, { hour: '2-digit', minute: '2-digit' })
}

function pickLang (l) { setLocale(l); openMenu.value = null; tick() }

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

const menus = computed(() => ({
  apple: [
    { label: t('menubar.aboutHublo'), act: () => windows.open('about') },
    { label: t('menubar.systemInfo'), act: () => windows.open('sysinfo') },
    { sep: true },
    { label: t('menubar.english'), mark: locale.value === 'en', act: () => pickLang('en') },
    { label: t('menubar.french'), mark: locale.value === 'fr', act: () => pickLang('fr') },
    { sep: true },
    { label: t('menubar.logout'), act: logout }
  ],
  fichier: [
    { label: t('menubar.newFinder'), act: () => windows.openNew('finder') },
    { label: t('menubar.newDocument'), act: () => windows.openNew('textedit', { path: null }) },
    { label: t('menubar.newTerminal'), act: () => windows.openNew('terminal') }
  ],
  presentation: [
    { label: t('menubar.activityMonitor'), act: () => windows.open('monitor') },
    { sep: true },
    { label: t('menubar.previewTip'), disabled: true, act: () => {} }
  ]
}))

onMounted(() => { tick(); iv = setInterval(tick, 1000); document.addEventListener('click', closeMenus) })
onUnmounted(() => { clearInterval(iv); document.removeEventListener('click', closeMenus) })

// dark mode toggle - ponytail: data-theme + localStorage, 0 dépendance
const theme = ref(localStorage.getItem('hublo-theme') || 'light')
function toggleTheme () {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme.value
  localStorage.setItem('hublo-theme', theme.value)
}
// appliquer au mount
document.documentElement.dataset.theme = theme.value
</script>

<template>
  <div class="menubar">
    <div class="menu-left">
      <span class="apple" :class="{ active: openMenu === 'apple' }"
            @click="toggle('apple', $event)" @mouseenter="hover('apple', $event)"></span>
      <span class="menu-app">{{ windows.activeApp }}</span>
      <span class="menu-trigger" :class="{ active: openMenu === 'fichier' }"
            @click="toggle('fichier', $event)" @mouseenter="hover('fichier', $event)">{{ t('menubar.file') }}</span>
      <span class="menu-trigger" :class="{ active: openMenu === 'presentation' }"
            @click="toggle('presentation', $event)" @mouseenter="hover('presentation', $event)">{{ t('menubar.view') }}</span>
    </div>
    <div class="menu-right">
      <span class="menu-item">{{ auth.username }}</span>
      <span class="menu-item clip-menu-btn" @click="clipStore.toggle()" :title="t('clipboard.menuTitle', { n: clipStore.items.length })">
        📋<span class="clip-menu-badge" v-if="clipStore.items.length">{{ clipStore.items.length }}</span>
      </span>
      <span class="menu-item" :title="t('menubar.logout')" @click="logout">⏻</span>
      <span class="menu-item theme-toggle" @click="toggleTheme">{{ theme === 'dark' ? '☀️' : '🌙' }}</span>
      <span class="menu-clock">{{ clock }}</span>
    </div>

    <div v-if="openMenu" class="menu-dd" :style="{ left: ddLeft + 'px' }" @click.stop>
      <template v-for="(it, i) in menus[openMenu]" :key="i">
        <div v-if="it.sep" class="dd-sep"></div>
        <div v-else class="dd-item" :class="{ disabled: it.disabled }" @click="run(it)"><span class="dd-check">{{ it.mark ? '✓' : '' }}</span>{{ it.label }}</div>
      </template>
    </div>
  </div>
</template>
