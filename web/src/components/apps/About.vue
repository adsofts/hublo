<script setup>
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { useAuthStore } from '../../stores/auth.js'

const { t } = useI18n()
defineProps({ winId: { type: Number, required: true } })
const auth = useAuthStore()
const host = location.host
</script>

<template>
  <WindowFrame :win-id="winId">
    <div class="about">
      <div class="big">💧</div>
      <h2>Hublo</h2>
      <p>{{ t('about.tagline') }}</p>
      <p>
        <i18n-t keypath="about.connectedAs" tag="span">
          <template #user><b>{{ auth.username }}</b></template>
        </i18n-t><br>
        {{ t('about.sshLine') }}
      </p>
      <p style="color:#aaa">{{ t('about.poc', { host }) }}</p>
    </div>
  </WindowFrame>
</template>
