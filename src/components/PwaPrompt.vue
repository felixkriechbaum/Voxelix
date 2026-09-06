<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue';

const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW();

function close() {
  offlineReady.value = false;
  needRefresh.value = false;
}
</script>

<template>
  <div v-if="offlineReady || needRefresh" class="pwa panel">
    <span v-if="needRefresh">A new version is available.</span>
    <span v-else>Voxelix is ready to work offline.</span>
    <span class="spacer" />
    <button v-if="needRefresh" class="primary" @click="updateServiceWorker(true)">Reload</button>
    <button @click="close">Dismiss</button>
  </div>
</template>

<style scoped>
.pwa {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  max-width: 360px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #0b1220;
  font-weight: 600;
}
</style>
