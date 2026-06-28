<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWindowsStore } from '../stores/windows.js'
import { useAppsStore } from '../stores/apps.js'

const { t } = useI18n()
const windows = useWindowsStore()
const apps = useAppsStore()

// apps livrées par défaut (le client HTTP n'y est plus : il s'installe via le magasin)
const builtins = computed(() => [
  { app: 'finder', ico: '🗂️', title: t('dock.finder') },
  { app: 'textedit', ico: '📝', title: t('dock.textedit') },
  { app: 'terminal', ico: '🖥️', title: t('dock.terminal') },
  { app: 'monitor', ico: '📊', title: t('dock.activityMonitor') },
  { app: 'logs', ico: '📜', title: t('dock.logs') },
  { app: 'storage', ico: '💾', title: t('dock.storage') },
  { app: 'git', ico: '🔀', title: t('dock.git') },
  { app: 'network', ico: '🌐', title: t('dock.networkDrives') }
])
// apps installées depuis le magasin (clé de fenêtre = id de l'app → montée en SandboxedApp)
const storeApps = computed(() => apps.installedApps.map(a => ({ app: a.id, ico: a.icon, title: a.name, w: a.window?.w, h: a.window?.h })))

function open (app) { windows.open(app) }
function openStore (it) { windows.open(it.app, { title: it.title, titleKey: null, w: it.w || 720, h: it.h || 480 }) }
</script>

<template>
  <div class="dock">
    <div
      v-for="it in builtins"
      :key="it.app"
      class="dock-item"
      :class="{ running: windows.running.has(it.app) }"
      :title="it.title"
      @click="open(it.app)"
    >
      <span class="dock-ico">{{ it.ico }}</span>
    </div>
    <template v-if="storeApps.length">
      <div class="dock-sep"></div>
      <div
        v-for="it in storeApps"
        :key="it.app"
        class="dock-item"
        :class="{ running: windows.running.has(it.app) }"
        :title="it.title"
        @click="openStore(it)"
      >
        <span class="dock-ico">{{ it.ico }}</span>
      </div>
    </template>
    <div class="dock-sep"></div>
    <div
      class="dock-item"
      :class="{ running: windows.running.has('store') }"
      :title="t('dock.store')"
      @click="open('store')"
    >
      <span class="dock-ico">🛍️</span>
    </div>
    <div
      class="dock-item"
      :class="{ running: windows.running.has('about') }"
      :title="t('dock.about')"
      @click="open('about')"
    >
      <span class="dock-ico">💧</span>
    </div>
    <div class="dock-sep"></div>
    <div
      class="dock-item"
      :class="{ running: windows.running.has('trash') }"
      :title="t('dock.trash')"
      @click="open('trash')"
    >
      <span class="dock-ico">🗑️</span>
    </div>
  </div>
</template>
