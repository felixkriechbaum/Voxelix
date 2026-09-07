<script setup lang="ts">
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

const props = defineProps<{ icon: IconDefinition; size?: number }>();
const paths = () => {
  const d = props.icon.icon[4];
  return Array.isArray(d) ? d : [d];
};
</script>

<template>
  <svg
    :width="size ?? 14"
    :height="size ?? 14"
    :viewBox="`0 0 ${icon.icon[0]} ${icon.icon[1]}`"
    fill="currentColor"
    aria-hidden="true"
    class="icon-svg"
  >
    <path v-for="(d, i) in paths()" :key="i" :d="d" />
  </svg>
</template>

<style scoped>
.icon-svg {
  display: block;
}
</style>
