<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import WindowFrame from '../WindowFrame.vue'
import { useAppsStore } from '../../stores/apps.js'

const { t } = useI18n()
defineProps({ winId: { type: Number, required: true } })
const apps = useAppsStore()
const consent = ref(null)   // app en attente de consentement

// permissions « sensibles » (affichées en rouge)
const SENSITIVE = new Set(['terminal', 'fs.write', 'db'])

onMounted(() => { if (!apps.loaded) apps.load() })

function askInstall (a) { consent.value = a }
async function confirmInstall () {
  const a = consent.value; consent.value = null
  await apps.install(a.id, (a.capabilities || []).map(c => c.id))
}
</script>

<template>
  <WindowFrame :win-id="winId" body-class="flexcol">
    <div class="store-head">
      <span class="store-title">🛍️ {{ t('store.title') }}</span>
      <span class="store-sub">{{ t('store.subtitle') }}</span>
    </div>
    <div v-if="apps.error" class="store-banner">{{ t('store.offline') }}</div>
    <div class="store-list">
      <div v-for="a in apps.catalog" :key="a.id" class="store-card">
        <div class="store-ico">{{ a.icon }}</div>
        <div class="store-body">
          <div class="store-row1">
            <span class="store-name">{{ a.name }}</span>
            <span class="store-ver">v{{ a.version }}</span>
            <span v-if="a.verified" class="store-badge verified" :title="t('store.verifiedHint')">✓ {{ t('store.verified') }}</span>
            <span v-else class="store-badge community" :title="t('store.communityHint')">{{ t('store.community') }}</span>
          </div>
          <div class="store-author">{{ t('store.by', { author: a.author }) }}</div>
          <div class="store-desc">{{ a.description }}</div>
          <div v-if="a.capabilities && a.capabilities.length" class="store-caps">
            <span class="caps-label">{{ t('store.capabilities') }}:</span>
            <span v-for="c in a.capabilities" :key="c.id" class="cap-chip" :class="{ sensitive: SENSITIVE.has(c.id) }" :title="c.reason">{{ c.id }}</span>
          </div>
        </div>
        <div class="store-action">
          <button v-if="!apps.isInstalled(a.id)" class="fbtn primary" :disabled="apps.busy === a.id" @click="askInstall(a)">
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

    <!-- consentement aux permissions -->
    <div v-if="consent" class="consent-overlay" @click.self="consent = null">
      <div class="consent-box">
        <div class="consent-title">{{ consent.icon }} {{ t('store.consentTitle', { name: consent.name }) }}</div>
        <div class="consent-sub">{{ t('store.consentSub') }}</div>
        <div v-if="consent.capabilities && consent.capabilities.length" class="consent-caps">
          <div v-for="c in consent.capabilities" :key="c.id" class="consent-cap">
            <span class="cap-chip" :class="{ sensitive: SENSITIVE.has(c.id) }">{{ c.id }}</span>
            <span class="consent-reason">{{ c.reason || t('store.capGeneric') }}</span>
          </div>
        </div>
        <div v-else class="consent-none">{{ t('store.noPerms') }}</div>
        <div class="consent-actions">
          <button class="fbtn" @click="consent = null">{{ t('store.cancel') }}</button>
          <button class="fbtn primary" @click="confirmInstall">{{ t('store.allowInstall') }}</button>
        </div>
      </div>
    </div>
  </WindowFrame>
</template>
