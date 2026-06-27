import { defineStore } from 'pinia'
import { ref } from 'vue'

const MAX = 50

export const useClipboardStore = defineStore('clipboard', () => {
  const items = ref([]) // { text, ts }
  const open = ref(false)

  function toggle () { open.value = !open.value }

  function add (text) {
    if (!text || typeof text !== 'string') return
    // évite les doublons consécutifs
    if (items.value.length && items.value[0].text === text) return
    items.value.unshift({ text, ts: Date.now() })
    if (items.value.length > MAX) items.value.pop()
  }

  function remove (idx) {
    items.value.splice(idx, 1)
  }

  function clear () {
    items.value = []
  }

  return { items, open, add, remove, clear, toggle }
})
