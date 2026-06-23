<script setup>
import { computed } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api } from '../../api.js'
import { useWindowsStore } from '../../stores/windows.js'

const windows = useWindowsStore()
const win = computed(() => windows.byApp('preview'))
const src = computed(() => (win.value && win.value.path) ? api.downloadUrl(win.value.path) : '')
</script>

<template>
  <WindowFrame app="preview">
    <div class="preview-body">
      <img v-if="src" :src="src" alt="">
    </div>
  </WindowFrame>
</template>
