<script setup>
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { useAppsStore } from '../../stores/apps.js'

const { t } = useI18n()
defineProps({ winId: { type: Number, required: true } })
const apps = useAppsStore()

onMounted(() => { if (!apps.loaded) apps.load() })
</script>

<template>
  <WindowFrame :win-id="winId" body-class="flexcol">
    <div class="store-head">
      <span class="store-title">🛍️ {{ t('store.title') }}</span>
      <span class="store-sub">{{ t('store.subtitle') }}</span>
    </div>
    <div class="store-list">
      <div v-for="a in apps.catalog" :key="a.id" class="store-card">
        <div class="store-ico">{{ a.icon }}</div>
        <div class="store-body">
          <div class="store-row1">
            <span class="store-name">{{ a.name }}</span>
            <span class="store-ver">v{{ a.version }}</span>
            <span v-if="a.verified" class="store-badge verified" :title="t('store.verifiedHint')">✓ {{ t('store.verified') }}</span>
            <span v-else class="store-badge community">{{ t('store.community') }}</span>
          </div>
          <div class="store-author">{{ t('store.by', { author: a.author }) }}</div>
          <div class="store-desc">{{ a.description }}</div>
          <div v-if="a.capabilities && a.capabilities.length" class="store-caps">
            <span class="caps-label">{{ t('store.capabilities') }}:</span>
            <span v-for="c in a.capabilities" :key="c" class="cap-chip">{{ c }}</span>
          </div>
        </div>
        <div class="store-action">
          <button v-if="!apps.isInstalled(a.id)" class="fbtn primary" :disabled="apps.busy === a.id" @click="apps.install(a.id)">
            {{ apps.busy === a.id ? '…' : t('store.install') }}
          </button>
          <button v-else class="fbtn store-remove" :disabled="apps.busy === a.id" @click="apps.uninstall(a.id)">
            {{ apps.busy === a.id ? '…' : t('store.remove') }}
          </button>
          <span v-if="apps.isInstalled(a.id)" class="store-installed">✓ {{ t('store.installed') }}</span>
        </div>
      </div>
      <div v-if="apps.loaded && !apps.catalog.length" class="finder-empty">{{ t('store.empty') }}</div>
    </div>
  </WindowFrame>
</template>
