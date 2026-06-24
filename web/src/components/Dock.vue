<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWindowsStore } from '../stores/windows.js'

const { t } = useI18n()
const windows = useWindowsStore()

const items = computed(() => [
  { app: 'finder', ico: '🗂️', title: t('dock.finder') },
  { app: 'textedit', ico: '📝', title: t('dock.textedit') },
  { app: 'terminal', ico: '🖥️', title: t('dock.terminal') },
  { app: 'monitor', ico: '📊', title: t('dock.activityMonitor') },
  { app: 'logs', ico: '📜', title: t('dock.logs') },
  { app: 'storage', ico: '💾', title: t('dock.storage') },
  { app: 'db', ico: '🗄️', title: t('dock.database') },
  { app: 'git', ico: '🔀', title: t('dock.git') },
  { app: 'network', ico: '🌐', title: t('dock.networkDrives') }
])

function open (app) {
  windows.open(app)
}
</script>

<template>
  <div class="dock">
    <div
      v-for="it in items"
      :key="it.app"
      class="dock-item"
      :class="{ running: windows.running.has(it.app) }"
      :title="it.title"
      @click="open(it.app)"
    >
      <span class="dock-ico">{{ it.ico }}</span>
    </div>
    <div class="dock-sep"></div>
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
