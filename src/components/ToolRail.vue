<script setup lang="ts">
import { computed } from 'vue';
import { useEditorStore } from '@/stores/editor';
import Icon from './Icon.vue';
import {
  faCube,
  faEraser,
  faDrawSquare,
  faPaintbrush,
  faFillDrip,
  faEyedropper,
  faArrowPointer,
  faShapes,
  faCamera,
} from '@fortawesome/pro-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/pro-solid-svg-icons';
import type { ToolId } from '@/tools/types';

const store = useEditorStore();
const emit = defineEmits<{ (e: 'add-shape'): void }>();

/** `key` is the letter shortcut from ViewportCanvas; digits 1–7 follow the order. */
const tools: Array<{ id: ToolId; label: string; key: string; icon: IconDefinition }> = [
  { id: 'place', label: 'Place', key: 'W', icon: faCube },
  { id: 'erase', label: 'Erase', key: 'E', icon: faEraser },
  { id: 'box', label: 'Box', key: 'R', icon: faDrawSquare },
  { id: 'paint', label: 'Paint', key: 'T', icon: faPaintbrush },
  { id: 'bucket', label: 'Bucket', key: 'G', icon: faFillDrip },
  { id: 'eyedropper', label: 'Pick colour', key: 'Q', icon: faEyedropper },
  { id: 'select', label: 'Select', key: 'V', icon: faArrowPointer },
];

/** Picking a tool also leaves screenshot mode — you're back to modelling. */
function pickTool(id: ToolId) {
  store.toolId = id;
  store.screenshotMode = false;
}

const currentHex = computed(() => {
  void store.paletteVersion;
  return store.palette()[store.currentColor] ?? '#000000';
});
</script>

<template>
  <nav class="rail" aria-label="Tools">
    <div class="keys" role="group" aria-label="Modelling tools">
      <button
        v-for="(t, i) in tools"
        :key="t.id"
        class="key"
        :class="{ active: store.toolId === t.id && !store.screenshotMode }"
        :aria-pressed="store.toolId === t.id && !store.screenshotMode"
        :aria-label="t.label"
        :title="`${t.label} — ${t.key} or ${i + 1}`"
        @click="pickTool(t.id)"
      >
        <Icon :icon="t.icon" :size="15" />
        <span class="letter" aria-hidden="true">{{ t.key }}</span>
      </button>
    </div>

    <span class="sep" />
    <button
      class="key"
      title="Add a shape — box, sphere, cylinder or pyramid"
      aria-label="Add shape"
      @click="emit('add-shape')"
    >
      <Icon :icon="faShapes" :size="15" />
    </button>
    <button
      class="key"
      :class="{ active: store.screenshotMode }"
      :aria-pressed="store.screenshotMode"
      title="Screenshot — pick a view and save a picture of this object"
      aria-label="Screenshot mode"
      @click="store.screenshotMode = !store.screenshotMode"
    >
      <Icon :icon="faCamera" :size="15" />
    </button>

    <span class="grow" />
    <!-- the colour on the brush, drawn as the thing it makes: a voxel -->
    <div
      class="brush-colour"
      :style="{ '--c': currentHex }"
      :title="`Current colour: slot ${store.currentColor}, ${currentHex}`"
      role="img"
      :aria-label="`Current colour ${currentHex}`"
    >
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <polygon class="top" points="16,3 29,10 16,17 3,10" />
        <polygon class="left" points="3,10 16,17 16,30 3,23" />
        <polygon class="right" points="29,10 16,17 16,30 29,23" />
      </svg>
    </div>
  </nav>
</template>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 6px 10px;
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  min-height: 0;
  overflow: auto;
}
.keys {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* A tool key is a little voxel: a lit top face sitting on a 3px side face.
   Pressing (or being the active tool) sinks it and lights it in the accent. */
.key {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 38px;
  padding: 0;
  color: var(--ink-dim);
  background: var(--surface-2);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 3px 0 var(--key-side);
  margin-bottom: 3px;
  transition:
    transform 0.08s,
    box-shadow 0.08s,
    background-color 0.12s,
    color 0.12s;
}
.key:hover:not(:disabled) {
  color: var(--ink);
  background: var(--surface-hi);
}
.key:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 1px 0 var(--key-side);
}
.key.active,
.key.active:hover:not(:disabled) {
  color: var(--accent-ink);
  background: var(--accent);
  border-color: var(--accent);
  transform: translateY(1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 2px 0 var(--accent-side);
}
.letter {
  position: absolute;
  right: 3px;
  bottom: 1px;
  font: 600 8.5px/1 var(--font-display);
  opacity: 0.6;
}
.sep {
  width: 24px;
  height: 1px;
  margin: 2px 0 4px;
  background: var(--line);
  flex: none;
}
.grow {
  flex: 1;
}
.brush-colour {
  width: 34px;
  height: 34px;
  flex: none;
}
.brush-colour svg {
  display: block;
  width: 100%;
  height: 100%;
}
.brush-colour .top {
  fill: color-mix(in srgb, var(--c) 72%, white);
}
.brush-colour .left {
  fill: var(--c);
}
.brush-colour .right {
  fill: color-mix(in srgb, var(--c) 68%, black);
}
.brush-colour polygon {
  stroke: var(--line-strong);
  stroke-width: 0.6;
  stroke-linejoin: round;
}

@media (max-width: 720px) {
  .rail,
  .keys {
    flex-direction: row;
  }
  .rail {
    overflow-x: auto;
    padding: 6px 8px 8px;
    scrollbar-width: none;
  }
  .grow,
  .brush-colour {
    display: none;
  }
  .sep {
    width: 1px;
    height: 24px;
    margin: 0 2px;
  }
}
</style>
