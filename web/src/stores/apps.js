import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '../api.js'

// Magasin d'applications (v0) : catalogue d'apps vérifiées + ensemble installé par utilisateur.
export const useAppsStore = defineStore('apps', () => {
  const catalog = ref([])
  const installed = ref([])   // [{ id, version, grants, pinned }]
  const loaded = ref(false)
  const error = ref(null)
  const busy = ref('')        // id en cours d'install/désinstall
  const launchpadOpen = ref(false)

  async function load () {
    try {
      const r = await api.storeCatalog()
      catalog.value = r.catalog || []
      installed.value = r.installed || []
      error.value = r.error || null
      loaded.value = true
    } catch { /* non connecté / erreur réseau */ }
  }
  function isInstalled (id) { return installed.value.some(x => x.id === id) }
  function isPinned (id) { return installed.value.find(x => x.id === id)?.pinned === true }
  async function install (id, grants) { busy.value = id; try { installed.value = (await api.storeInstall(id, grants)).installed } finally { busy.value = '' } }
  async function uninstall (id) { busy.value = id; try { installed.value = (await api.storeUninstall(id)).installed } finally { busy.value = '' } }
  async function pin (id, pinned) { try { installed.value = (await api.storePin(id, pinned)).installed } catch { /* */ } }
  function toggleLaunchpad () { launchpadOpen.value = !launchpadOpen.value }

  const resolve = (i) => { const a = catalog.value.find(x => x.id === i.id); return a ? { ...a, pinned: i.pinned === true } : null }
  // toutes les apps installées (pour le Launchpad)
  const installedApps = computed(() => installed.value.map(resolve).filter(Boolean))
  // apps épinglées seulement (pour le dock)
  const pinnedApps = computed(() => installed.value.filter(i => i.pinned === true).map(resolve).filter(Boolean))

  return { catalog, installed, loaded, error, busy, launchpadOpen, load, isInstalled, isPinned, install, uninstall, pin, toggleLaunchpad, installedApps, pinnedApps }
})
