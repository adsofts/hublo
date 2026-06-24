<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWindowsStore } from '../stores/windows.js'

const props = defineProps({
  winId: { type: Number, required: true },
  bodyClass: { type: String, default: '' }
})

const windows = useWindowsStore()
const { t } = useI18n()
const MENU_H = 26
const win = computed(() => windows.byId(props.winId))
// Titre explicite (chemin, nom de doc…) sinon nom d'app par défaut (réactif à la langue).
const winTitle = computed(() => {
  const w = win.value
  if (!w) return ''
  return w.title || (w.titleKey ? t(w.titleKey) : w.app)
})

const style = computed(() => {
  const w = win.value
  if (!w) return {}
  return { left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }
})

function focus () { windows.focus(props.winId) }
function close () { windows.close(props.winId) }
function minimize () { windows.minimize(props.winId) }
function zoom () { windows.toggleZoom(props.winId, { menuH: MENU_H }) }

function startDrag (e) {
  if (e.target.classList.contains('light')) return
  const w = win.value
  const ox = e.clientX - w.x, oy = e.clientY - w.y
  const mv = ev => windows.move(props.winId, ev.clientX - ox, ev.clientY - oy, { menuH: MENU_H })
  const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up) }
  document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
}
function startResize (e) {
  e.stopPropagation(); e.preventDefault()
  const w = win.value
  const sx = e.clientX, sy = e.clientY, sw = w.w, sh = w.h
  const mv = ev => windows.resize(props.winId, sw + (ev.clientX - sx), sh + (ev.clientY - sy))
  const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.style.userSelect = '' }
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
}
</script>

<template>
  <div v-if="win" class="win open" :class="{ min: win.min }" :style="style" @mousedown="focus">
    <div class="titlebar" @mousedown="startDrag">
      <div class="lights">
        <span class="light r" @click.stop="close"></span>
        <span class="light y" @click.stop="minimize"></span>
        <span class="light g" @click.stop="zoom"></span>
      </div>
      <div class="title">{{ winTitle }}</div>
    </div>
    <div class="win-body" :class="bodyClass">
      <slot :win="win" />
    </div>
    <div class="win-resize" :title="t('common.resize')" @mousedown="startResize"></div>
  </div>
</template>
