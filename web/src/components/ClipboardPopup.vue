<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useClipboardStore } from '../stores/clipboard.js'

const store = useClipboardStore()

function pick (item) {
  navigator.clipboard.writeText(item.text).catch(() => {})
  store.open = false
}

// capture le texte copié via Ctrl+C / Cmd+C
function onCopy (e) {
  const sel = document.getSelection()?.toString().trim()
  if (sel) store.add(sel)
}

onMounted(() => document.addEventListener('copy', onCopy))
onUnmounted(() => document.removeEventListener('copy', onCopy))
</script>

<template>
  <div v-if="store.open" class="clip-popup">
    <div class="clip-head">
      <span>📋 Clipboard</span>
      <span class="clip-badge" v-if="store.items.length">{{ store.items.length }}</span>
      <span class="clip-clear" @click="store.clear()" v-if="store.items.length">clear</span>
    </div>
    <div class="clip-list" v-if="store.items.length">
      <div
        v-for="(item, i) in store.items"
        :key="item.ts"
        class="clip-item"
        @click="pick(item)"
      >
        <span class="clip-text">{{ item.text.slice(0, 80) }}</span>
        <span class="clip-del" @click.stop="store.remove(i)">×</span>
      </div>
    </div>
    <div v-else class="clip-empty">Empty — click 📋 in menu bar after copying</div>
  </div>
  <div v-if="store.open" class="clip-overlay" @click="store.open = false"></div>
</template>
