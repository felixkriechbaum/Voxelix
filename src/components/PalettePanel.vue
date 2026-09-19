<script setup lang="ts">
import { computed } from 'vue';
import { useEditorStore } from '@/stores/editor';

const store = useEditorStore();

const palette = computed(() => {
  void store.paletteVersion;
  return store.palette();
});
const currentHex = computed(() => palette.value[store.currentColor] ?? '#000000');

function onColorInput(e: Event) {
  store.setPaletteColor(store.currentColor, (e.target as HTMLInputElement).value);
}

const columns = 10;
function onSwatchKey(e: KeyboardEvent, index: number) {
  let next = index;
  if (e.key === 'ArrowLeft') next--;
  else if (e.key === 'ArrowRight') next++;
  else if (e.key === 'ArrowUp') next -= columns;
  else if (e.key === 'ArrowDown') next += columns;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = palette.value.length - 1;
  else return;
  e.preventDefault();
  next = Math.max(0, Math.min(palette.value.length - 1, next));
  store.setColor(next);
  const buttons = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('.swatch');
  buttons?.[next]?.focus();
}
</script>

<template>
  <div class="panel palette">
    <div class="row">
      <h3>Palette</h3>
      <span class="spacer" />
      <span class="idx">#{{ store.currentColor }}</span>
    </div>

    <div class="grid" role="group" aria-label="Colour palette">
      <button
        v-for="(hex, i) in palette"
        :key="i"
        class="swatch"
        :class="{ sel: i === store.currentColor }"
        :style="{ background: hex }"
        :tabindex="i === store.currentColor ? 0 : -1"
        :aria-label="`Palette slot ${i}, ${hex}`"
        :aria-pressed="i === store.currentColor"
        :title="`Slot ${i} — ${hex}`"
        @click="store.setColor(i)"
        @keydown="onSwatchKey($event, i)"
      />
    </div>

    <div class="row edit">
      <input
        type="color"
        :value="currentHex"
        :title="`Change the colour of slot ${store.currentColor}`"
        @input="onColorInput"
      />
      <span class="hex">{{ currentHex }}</span>
    </div>
  </div>
</template>

<style scoped>
.palette {
  padding: 10px;
}
.idx {
  color: var(--text-dim);
}
.grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 2px;
  margin: 6px 0;
  max-height: 220px;
  padding: 2px;
  overflow: auto;
}
.swatch {
  padding: 0;
  aspect-ratio: 1;
  border: 1px solid var(--line);
  border-radius: 2px;
}
.swatch:hover {
  border-color: var(--line-strong);
}
.swatch.sel {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  z-index: 1;
}
.edit {
  margin-top: 6px;
}
.edit input[type='color'] {
  width: 40px;
  height: 28px;
  padding: 0;
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.hex {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
</style>
