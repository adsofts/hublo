<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppsStore } from '../stores/apps.js'
import { useWindowsStore } from '../stores/windows.js'

const { t } = useI18n()
const apps = useAppsStore()
const windows = useWindowsStore()

function openApp (a) {
  windows.open(a.id, { title: a.name, titleKey: null, w: a.window?.w || 720, h: a.window?.h || 480 })
  apps.launchpadOpen = false
}
function togglePin (a) { apps.pin(a.id, !apps.isPinned(a.id)) }
function onDragStart (e, a) {
  e.dataTransfer.setData('text/hublo-app', a.id)
  e.dataTransfer.setData('text/plain', a.id)
  e.dataTransfer.effectAllowed = 'copy'
}
function onKey (e) { if (e.key === 'Escape') apps.launchpadOpen = false }
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="apps.launchpadOpen" class="lp-overlay" @click.self="apps.launchpadOpen = false">
    <div class="lp-head">{{ t('launchpad.title') }}</div>
    <div v-if="apps.installedApps.length" class="lp-grid">
      <div
        v-for="a in apps.installedApps"
        :key="a.id"
        class="lp-app"
        draggable="true"
        @dragstart="onDragStart($event, a)"
        @click="openApp(a)"
      >
        <div class="lp-ico">{{ a.icon }}</div>
        <div class="lp-name">{{ a.name }}</div>
        <button
          class="lp-pin"
          :class="{ on: apps.isPinned(a.id) }"
          :title="apps.isPinned(a.id) ? t('launchpad.unpin') : t('launchpad.pin')"
          @click.stop="togglePin(a)"
        >{{ apps.isPinned(a.id) ? '📌' : '➕' }}</button>
      </div>
    </div>
    <div v-else class="lp-empty">
      {{ t('launchpad.empty') }}
    </div>
    <div class="lp-hint">{{ t('launchpad.hint') }}</div>
  </div>
</template>
