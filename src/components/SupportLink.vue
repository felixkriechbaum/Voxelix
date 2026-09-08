<script setup lang="ts">
import Icon from './Icon.vue';
import { faMugHot } from '@fortawesome/pro-solid-svg-icons';

/**
 * Where the coffee button points — a Ko-fi / Buy Me a Coffee page.
 * Left empty the button stays hidden, so nothing half-configured ever ships.
 */
const SUPPORT_URL: string = '';
</script>

<template>
  <a
    v-if="SUPPORT_URL"
    class="support panel"
    :href="SUPPORT_URL"
    target="_blank"
    rel="noopener noreferrer"
    title="Voxelix is free and has no ads — buy me a coffee if it's useful to you"
  >
    <Icon :icon="faMugHot" :size="13" />
    <span>Buy me a coffee</span>
  </a>
</template>

<style scoped>
.support {
  /* sits at the foot of the sidebar, below the palette */
  margin-top: auto;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--ink-dim);
  text-decoration: none;
}
.support:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>
