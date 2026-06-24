import { createI18n } from 'vue-i18n'
import en from './locales/en.js'
import fr from './locales/fr.js'

export const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('hublo.lang') || 'en',
  fallbackLocale: 'en',
  messages: { en, fr }
})

export function setLocale (l) {
  i18n.global.locale.value = l
  try { localStorage.setItem('hublo.lang', l) } catch { /* ignore */ }
}

// Helper usable outside component setup (e.g. Pinia stores).
export function t (key, named) { return i18n.global.t(key, named) }
