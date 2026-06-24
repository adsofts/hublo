import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Métadonnées par app : nom convivial (menubar) + géométrie initiale.
const APP_META = {
  finder: { title: 'Finder', w: 680, h: 450 },
  textedit: { title: 'TextEdit', w: 640, h: 460 },
  terminal: { title: 'Terminal', w: 660, h: 400 },
  monitor: { title: 'Moniteur d’activité', w: 560, h: 420 },
  preview: { title: 'Aperçu', w: 560, h: 440 },
  sysinfo: { title: 'Infos système', w: 380, h: 470 },
  trash: { title: 'Corbeille', w: 520, h: 400 },
  network: { title: 'Lecteurs réseau', w: 580, h: 500 },
  logs: { title: 'Logs', w: 720, h: 460 },
  storage: { title: 'Stockage', w: 560, h: 480 },
  props: { title: 'Infos', w: 360, h: 480 },
  about: { title: 'À propos de Hublo', w: 380, h: 300 }
}
const friendly = (app) => (APP_META[app] && APP_META[app].title) || app

export const useWindowsStore = defineStore('windows', () => {
  const wins = ref([])            // [{ id, app, title, x, y, w, h, z, min, zoom, prev, ...payload }]
  const activeApp = ref('Finder') // nom d'app affiché dans la menubar
  const clip = ref(null)          // presse-papier PARTAGÉ entre fenêtres { path, name, mode }
  let zCounter = 100
  let idCounter = 0

  const running = computed(() => new Set(wins.value.map(w => w.app)))
  function byId (id) { return wins.value.find(w => w.id === id) }
  function setClip (c) { clip.value = c }

  function focus (id) {
    const w = byId(id)
    if (!w) return
    w.z = ++zCounter; w.min = false; activeApp.value = friendly(w.app)
  }

  // Crée TOUJOURS une nouvelle fenêtre.
  function openNew (app, payload = {}) {
    const meta = APP_META[app] || { title: app, w: 560, h: 380 }
    const idx = wins.value.length
    const w = {
      id: ++idCounter, app, title: meta.title,
      x: 70 + (idx % 7) * 30, y: 50 + (idx % 7) * 26,
      w: meta.w, h: meta.h, z: ++zCounter, min: false, zoom: false, prev: null, ...payload
    }
    if (!w.title) w.title = meta.title
    wins.value.push(w)
    activeApp.value = friendly(app)
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
    activeApp.value = wins.value.length
      ? friendly(wins.value.reduce((a, b) => (a.z > b.z ? a : b)).app)
      : 'Bureau'
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
