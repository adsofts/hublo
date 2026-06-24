<script setup>
import { computed } from 'vue'
import WindowFrame from '../WindowFrame.vue'
import { api, isPdf } from '../../api.js'
import { useWindowsStore } from '../../stores/windows.js'

const windows = useWindowsStore()
const win = computed(() => windows.byApp('preview'))
const path = computed(() => win.value?.path || '')
const src = computed(() => path.value ? api.rawUrl(path.value) : '')
const pdf = computed(() => path.value && isPdf(path.value))
</script>

<template>
  <WindowFrame app="preview">
    <div class="preview-body">
      <iframe v-if="pdf && src" :src="src" class="preview-pdf"></iframe>
      <img v-else-if="src" :src="src" alt="">
    </div>
  </WindowFrame>
</template>
