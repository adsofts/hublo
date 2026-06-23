<script setup>
import { computed } from 'vue'
import { useWindowsStore } from '../stores/windows.js'

const props = defineProps({
  app: { type: String, required: true },
  // bodyClass permet aux apps d'ajuster le conteneur (flexcol, mon, etc.)
  bodyClass: { type: String, default: '' }
})

const windows = useWindowsStore()
const MENU_H = 26

const win = computed(() => windows.byApp(props.app))

const style = computed(() => {
  const w = win.value
  if (!w) return {}
  return {
    left: w.x + 'px',
    top: w.y + 'px',
    width: w.w + 'px',
    height: w.h + 'px',
    zIndex: w.z
  }
})

function focus () { windows.focus(props.app) }
function close () { windows.close(props.app) }
function minimize () { windows.minimize(props.app) }
function zoom () { windows.toggleZoom(props.app, { menuH: MENU_H }) }

function startDrag (e) {
  if (e.target.classList.contains('light')) return
  const w = win.value
  const ox = e.clientX - w.x
  const oy = e.clientY - w.y
  const mv = ev => windows.move(props.app, ev.clientX - ox, ev.clientY - oy, { menuH: MENU_H })
  const up = () => {
    document.removeEventListener('mousemove', mv)
    document.removeEventListener('mouseup', up)
  }
  document.addEventListener('mousemove', mv)
  document.addEventListener('mouseup', up)
}
</script>

<template>
  <div
    v-if="win"
    class="win open"
    :class="{ min: win.min }"
    :style="style"
    @mousedown="focus"
  >
    <div class="titlebar" @mousedown="startDrag">
      <div class="lights">
        <span class="light r" @click.stop="close"></span>
        <span class="light y" @click.stop="minimize"></span>
        <span class="light g" @click.stop="zoom"></span>
      </div>
      <div class="title">{{ win.title }}</div>
    </div>
    <div class="win-body" :class="bodyClass">
      <slot :win="win" />
    </div>
  </div>
</template>
