<script setup>
import { useWindowsStore } from '../stores/windows.js'

const windows = useWindowsStore()

const items = [
  { app: 'finder', ico: '🗂️', title: 'Finder' },
  { app: 'textedit', ico: '📝', title: 'TextEdit' },
  { app: 'terminal', ico: '🖥️', title: 'Terminal' },
  { app: 'monitor', ico: '📊', title: 'Moniteur d’activité' },
  { app: 'logs', ico: '📜', title: 'Logs' },
  { app: 'storage', ico: '💾', title: 'Stockage' },
  { app: 'db', ico: '🗄️', title: 'Base de données' },
  { app: 'network', ico: '🌐', title: 'Lecteurs réseau' }
]

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
      title="À propos"
      @click="open('about')"
    >
      <span class="dock-ico">💧</span>
    </div>
    <div class="dock-sep"></div>
    <div
      class="dock-item"
      :class="{ running: windows.running.has('trash') }"
      title="Corbeille"
      @click="open('trash')"
    >
      <span class="dock-ico">🗑️</span>
    </div>
  </div>
</template>
