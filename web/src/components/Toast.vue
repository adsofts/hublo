<script setup>
import { useToastStore } from '../stores/toast.js'
const toast = useToastStore()
</script>

<template>
  <div class="toast" :class="{ show: toast.visible }">{{ toast.message }}</div>
</template>
