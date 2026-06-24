<script setup>
import WindowFrame from '../WindowFrame.vue'
import { useAuthStore } from '../../stores/auth.js'

defineProps({ winId: { type: Number, required: true } })
const auth = useAuthStore()
const host = location.host
</script>

<template>
  <WindowFrame :win-id="winId">
    <div class="about">
      <div class="big">💧</div>
      <h2>Hublo</h2>
      <p>Votre espace, sur le serveur — sans la console.</p>
      <p>
        Connecté en tant que <b>{{ auth.username }}</b><br>
        via une session SSH sécurisée (vos droits Unix).
      </p>
      <p style="color:#aaa">POC · {{ host }}</p>
    </div>
  </WindowFrame>
</template>
