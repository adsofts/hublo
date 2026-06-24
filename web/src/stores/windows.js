import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { t } from '../i18n.js'

// Métadonnées par app : clé i18n du nom convivial (menubar) + géométrie initiale.
const APP_META = {
  finder: { titleKey: 'dock.finder', w: 680, h: 450 },
  textedit: { titleKey: 'dock.textedit', w: 640, h: 460 },
  terminal: { titleKey: 'dock.terminal', w: 660, h: 400 },
  monitor: { titleKey: 'dock.activityMonitor', w: 560, h: 420 },
  preview: { titleKey: 'menubar.preview', w: 560, h: 440 },
  sysinfo: { titleKey: 'menubar.systemInfo', w: 380, h: 470 },
  trash: { titleKey: 'dock.trash', w: 520, h: 400 },
  network: { titleKey: 'dock.networkDrives', w: 580, h: 500 },
  logs: { titleKey: 'dock.logs', w: 720, h: 460 },
  storage: { titleKey: 'dock.storage', w: 560, h: 480 },
  db: { titleKey: 'dock.database', w: 820, h: 540 },
  git: { titleKey: 'dock.git', w: 800, h: 540 },
  props: { titleKey: 'props.infoTitleShort', w: 360, h: 480 },
  about: { titleKey: 'menubar.aboutHublo', w: 380, h: 300 }
}
// Renvoie la CLÉ i18n du nom d'app (résolue à l'affichage → réactif au changement de langue).
const friendlyKey = (app) => (APP_META[app] && APP_META[app].titleKey) || null

export const useWindowsStore = defineStore('windows', () => {
  const wins = ref([])            // [{ id, app, title, titleKey, x, y, w, h, z, min, zoom, prev, ...payload }]
  const activeAppKey = ref('dock.finder') // clé i18n du nom d'app affiché dans la menubar
  const activeApp = computed(() => activeAppKey.value === 'desktop.name' ? t('desktop.name') : t(activeAppKey.value))
  const clip = ref(null)          // presse-papier PARTAGÉ entre fenêtres { path, name, mode }
  let zCounter = 100
  let idCounter = 0

  const running = computed(() => new Set(wins.value.map(w => w.app)))
  function byId (id) { return wins.value.find(w => w.id === id) }
  function setClip (c) { clip.value = c }

  function focus (id) {
    const w = byId(id)
    if (!w) return
    w.z = ++zCounter; w.min = false; activeAppKey.value = friendlyKey(w.app) || 'desktop.name'
  }

  // Crée TOUJOURS une nouvelle fenêtre.
  function openNew (app, payload = {}) {
    const meta = APP_META[app] || { titleKey: null, w: 560, h: 380 }
    const idx = wins.value.length
    // titleKey = nom d'app par défaut (résolu réactivement) ; title (explicite) le remplace s'il existe.
    const w = {
      id: ++idCounter, app, titleKey: meta.titleKey || null, title: null,
      x: 70 + (idx % 7) * 30, y: 50 + (idx % 7) * 26,
      w: meta.w, h: meta.h, z: ++zCounter, min: false, zoom: false, prev: null, ...payload
    }
    wins.value.push(w)
    activeAppKey.value = friendlyKey(app) || 'desktop.name'
    return w
  }

  // Réutilise une fenêtre existante de l'app (focus) sinon en crée une.
  function open (app, payload = {}) {
    const ex = wins.value.find(w => w.app === app)
    if (ex) { Object.assign(ex, payload); focus(ex.id); return ex }
    return openNew(app, payload)
  }

  function close (id) {
    const i = wins.value.findIndex(w => w.id === id)
    if (i >= 0) wins.value.splice(i, 1)
    activeAppKey.value = wins.value.length
      ? (friendlyKey(wins.value.reduce((a, b) => (a.z > b.z ? a : b)).app) || 'desktop.name')
      : 'desktop.name'
  }
  function minimize (id) { const w = byId(id); if (w) w.min = true }
  function toggleZoom (id, { menuH = 26 } = {}) {
    const w = byId(id); if (!w) return
    w.zoom = !w.zoom
    if (w.zoom) {
      w.prev = { x: w.x, y: w.y, w: w.w, h: w.h }
      w.x = 30; w.y = menuH + 14; w.w = window.innerWidth - 60; w.h = window.innerHeight - 120
    } else if (w.prev) { Object.assign(w, w.prev); w.prev = null }
  }
  // Titre de la barre de la fenêtre (n'affecte pas le nom d'app de la menubar).
  function setTitle (id, title) { const w = byId(id); if (w) w.title = title }
  function move (id, x, y, { menuH = 26 } = {}) {
    const w = byId(id); if (!w) return
    w.x = Math.max(0, x); w.y = Math.max(menuH, y)
  }
  function resize (id, ww, hh) {
    const w = byId(id); if (!w) return
    w.w = Math.max(320, Math.round(ww)); w.h = Math.max(170, Math.round(hh)); w.zoom = false
  }

  return {
    wins, activeApp, running, clip,
    byId, setClip, open, openNew, focus, close, minimize, toggleZoom, setTitle, move, resize
  }
})
