<script setup>
import { onMounted, watch } from 'vue'
import { useAuthStore } from './stores/auth.js'
import { useWindowsStore } from './stores/windows.js'
import Login from './components/Login.vue'
import MenuBar from './components/MenuBar.vue'
import Dock from './components/Dock.vue'
import Toast from './components/Toast.vue'
import Finder from './components/apps/Finder.vue'
import TextEdit from './components/apps/TextEdit.vue'
import Terminal from './components/apps/Terminal.vue'
import Monitor from './components/apps/Monitor.vue'
import SysInfo from './components/apps/SysInfo.vue'
import Trash from './components/apps/Trash.vue'
import Props from './components/apps/Props.vue'
import Preview from './components/apps/Preview.vue'
import About from './components/apps/About.vue'

const auth = useAuthStore()
const windows = useWindowsStore()

onMounted(() => auth.boot())

// à la connexion, ouvre le Finder
watch(() => auth.username, (u, old) => {
  if (u && !old) windows.open('finder')
})

function has (app) { return windows.running.has(app) }
</script>

<template>
  <!-- en attendant la vérif /api/me, écran neutre -->
  <Login v-if="auth.ready && !auth.username" />

  <div v-else-if="auth.username" class="desktop">
    <MenuBar />
    <div id="windows">
      <Finder v-if="has('finder')" />
      <TextEdit v-if="has('textedit')" />
      <Terminal v-if="has('terminal')" />
      <Monitor v-if="has('monitor')" />
      <SysInfo v-if="has('sysinfo')" />
      <Trash v-if="has('trash')" />
      <Props v-if="has('props')" />
      <Preview v-if="has('preview')" />
      <About v-if="has('about')" />
    </div>
    <Dock />
  </div>

  <Toast />
</template>
