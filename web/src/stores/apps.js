import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '../api.js'

// Magasin d'applications (v0) : catalogue d'apps vérifiées + ensemble installé par utilisateur.
export const useAppsStore = defineStore('apps', () => {
  const catalog = ref([])
  const installed = ref([])   // ids installés
  const loaded = ref(false)
  const busy = ref('')        // id en cours d'install/désinstall

  async function load () {
    try {
      const r = await api.storeCatalog()
      catalog.value = r.catalog || []
      installed.value = r.installed || []
      loaded.value = true
    } catch { /* non connecté / erreur réseau */ }
  }
  function isInstalled (id) { return installed.value.includes(id) }
  async function install (id) { busy.value = id; try { installed.value = (await api.storeInstall(id)).installed } finally { busy.value = '' } }
  async function uninstall (id) { busy.value = id; try { installed.value = (await api.storeUninstall(id)).installed } finally { busy.value = '' } }

  // apps installées résolues depuis le catalogue (pour le dock)
  const installedApps = computed(() => installed.value.map(id => catalog.value.find(a => a.id === id)).filter(Boolean))

  return { catalog, installed, loaded, busy, load, isInstalled, install, uninstall, installedApps }
})
