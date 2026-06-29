<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWindowsStore } from '../stores/windows.js'
import { useAppsStore } from '../stores/apps.js'

const { t } = useI18n()
const windows = useWindowsStore()
const apps = useAppsStore()

// apps livrées par défaut (le client HTTP / la base de données s'installent via le magasin)
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
// apps épinglées au dock (sous-ensemble des apps installées)
const dockApps = computed(() => apps.pinnedApps.map(a => ({ app: a.id, ico: a.icon, title: a.name, w: a.window?.w, h: a.window?.h })))

function open (app) { windows.open(app) }
function openStore (it) { windows.open(it.app, { title: it.title, titleKey: null, w: it.w || 720, h: it.h || 480 }) }
function onDragStart (e, id) { e.dataTransfer.setData('text/hublo-app', id); e.dataTransfer.effectAllowed = 'move' }
function onDrop (e) { const id = e.dataTransfer.getData('text/hublo-app'); if (id) apps.pin(id, true) }
</script>

<template>
  <div class="dock" @dragover.prevent @drop.stop.prevent="onDrop">
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
    <template v-if="dockApps.length">
      <div class="dock-sep"></div>
      <div
        v-for="it in dockApps"
        :key="it.app"
        class="dock-item"
        :class="{ running: windows.running.has(it.app) }"
        :title="it.title"
        draggable="true"
        @dragstart="onDragStart($event, it.app)"
        @click="openStore(it)"
      >
        <span class="dock-ico">{{ it.ico }}</span>
      </div>
    </template>
    <div class="dock-sep"></div>
    <div
      class="dock-item"
      :class="{ running: apps.launchpadOpen }"
      :title="t('dock.apps')"
      @click="apps.toggleLaunchpad()"
    >
      <span class="dock-ico">🚀</span>
    </div>
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
