<script setup>
import { onMounted, watch, ref } from 'vue'
import { api } from './api.js'
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
import Network from './components/apps/Network.vue'
import Logs from './components/apps/Logs.vue'
import Storage from './components/apps/Storage.vue'
import DBClient from './components/apps/DBClient.vue'
import Git from './components/apps/Git.vue'
import HttpClient from './components/apps/HttpClient.vue'
import Props from './components/apps/Props.vue'
import Preview from './components/apps/Preview.vue'
import About from './components/apps/About.vue'
import ClipboardPopup from './components/ClipboardPopup.vue'

const auth = useAuthStore()
const windows = useWindowsStore()

const drives = ref([])
async function loadDrives () { try { drives.value = (await api.hostsList()).hosts } catch { /* ignore */ } }
function openDrive (d) { windows.open('finder', { gotoHost: d.id }) }

onMounted(() => auth.boot())

// à la connexion, ouvre le Finder + charge les lecteurs réseau
watch(() => auth.username, (u, old) => {
  if (u && !old) { windows.open('finder'); loadDrives() }
})
// rafraîchit les icônes du bureau quand une fenêtre s'ouvre/se ferme (ex. après le gestionnaire d'hôtes)
watch(() => windows.wins.length, () => { if (auth.username) loadDrives() })

const COMPS = { finder: Finder, textedit: TextEdit, terminal: Terminal, monitor: Monitor, sysinfo: SysInfo, trash: Trash, network: Network, logs: Logs, storage: Storage, db: DBClient, git: Git, http: HttpClient, props: Props, preview: Preview, about: About }
</script>

<template>
  <!-- en attendant la vérif /api/me, écran neutre -->
  <Login v-if="auth.ready && !auth.username" />

  <div v-else-if="auth.username" class="desktop">
    <MenuBar />
    <div class="desk-icons">
      <div v-for="d in drives" :key="d.id" class="desk-icon" :title="d.user + '@' + d.host" @dblclick="openDrive(d)">
        <div class="desk-ico">🌐</div>
        <div class="desk-label">{{ d.label || d.host }}</div>
      </div>
    </div>
    <div id="windows">
      <component v-for="w in windows.wins" :key="w.id" :is="COMPS[w.app]" :win-id="w.id" />
    </div>
    <Dock />
  </div>

  <Toast />
  <ClipboardPopup />
</template>
