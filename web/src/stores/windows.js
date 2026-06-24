import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Métadonnées par app : titre par défaut + géométrie initiale.
const APP_META = {
  finder: { title: 'Finder', w: 640, h: 430 },
  textedit: { title: 'TextEdit', w: 640, h: 460 },
  terminal: { title: 'Terminal', w: 660, h: 400 },
  monitor: { title: 'Moniteur d’activité', w: 560, h: 420 },
  preview: { title: 'Aperçu', w: 560, h: 440 },
  sysinfo: { title: 'Infos système', w: 380, h: 470 },
  trash: { title: 'Corbeille', w: 520, h: 400 },
  network: { title: 'Lecteurs réseau', w: 580, h: 500 },
  props: { title: 'Infos', w: 360, h: 480 },
  about: { title: 'À propos de Hublo', w: 380, h: 300 }
}

export const useWindowsStore = defineStore('windows', () => {
  const wins = ref([])           // [{ app, title, x, y, w, h, z, min, zoom, prev, payload }]
  const activeApp = ref('Finder') // nom affiché dans la menubar
  let zCounter = 100

  const running = computed(() => new Set(wins.value.map(w => w.app)))

  function byApp (app) { return wins.value.find(w => w.app === app) }

  function focus (app) {
    const w = byApp(app)
    if (!w) return
    w.z = ++zCounter
    w.min = false
    activeApp.value = w.title
  }

  // Ouvre (ou ré-affiche) une app. payload est fusionné dans la fenêtre existante.
  function open (app, payload = {}) {
    const meta = APP_META[app] || { title: app, w: 560, h: 380 }
    let w = byApp(app)
    if (w) {
      Object.assign(w, payload)
      focus(app)
      return w
    }
    const idx = wins.value.length
    w = {
      app,
      title: meta.title,
      x: 90 + idx * 28,
      y: 60 + idx * 24,
      w: meta.w,
      h: meta.h,
      z: ++zCounter,
      min: false,
      zoom: false,
      prev: null,
      payload: {},
      ...payload
    }
    if (!w.title) w.title = meta.title
    wins.value.push(w)
    activeApp.value = w.title
    return w
  }

  function close (app) {
    const i = wins.value.findIndex(w => w.app === app)
    if (i >= 0) wins.value.splice(i, 1)
    // remet l'app active sur la fenêtre la plus haute restante
    if (wins.value.length) {
      const top = wins.value.reduce((a, b) => (a.z > b.z ? a : b))
      activeApp.value = top.title
    } else {
      activeApp.value = 'Bureau'
    }
  }

  function minimize (app) {
    const w = byApp(app)
    if (w) w.min = true
  }

  function toggleZoom (app, { menuH = 26 } = {}) {
    const w = byApp(app)
    if (!w) return
    w.zoom = !w.zoom
    if (w.zoom) {
      w.prev = { x: w.x, y: w.y, w: w.w, h: w.h }
      w.x = 30
      w.y = menuH + 14
      w.w = window.innerWidth - 60
      w.h = window.innerHeight - 120
    } else if (w.prev) {
      Object.assign(w, w.prev)
      w.prev = null
    }
  }

  function setTitle (app, title) {
    const w = byApp(app)
    if (w) {
      w.title = title
      // si c'est la fenêtre la plus haute, mettre à jour la menubar
      const top = wins.value.reduce((a, b) => (a.z > b.z ? a : b), w)
      if (top.app === app) activeApp.value = title
    }
  }

  function move (app, x, y, { menuH = 26 } = {}) {
    const w = byApp(app)
    if (!w) return
    w.x = Math.max(0, x)
    w.y = Math.max(menuH, y)
  }

  function resize (app, w, h) {
    const win = byApp(app)
    if (!win) return
    win.w = Math.max(320, Math.round(w))
    win.h = Math.max(170, Math.round(h))
    win.zoom = false   // une fois redimensionnée à la main, ce n'est plus « plein écran »
  }

  return {
    wins, activeApp, running,
    byApp, open, close, focus, minimize, toggleZoom, setTitle, move, resize
  }
})
