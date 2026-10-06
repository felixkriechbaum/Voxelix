<script setup lang="ts">
import { computed } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { hexAlpha, hexOpaque, withAlpha } from '@/core/palette';
import { paletteCollapsed } from '@/editor/panelPrefs';
import Icon from './Icon.vue';
import { faChevronDown } from '@fortawesome/pro-solid-svg-icons';

const store = useEditorStore();

const palette = computed(() => {
  void store.paletteVersion;
  return store.palette();
});
const currentHex = computed(() => palette.value[store.currentColor] ?? '#000000');

/** the colour picker has no alpha — keep the slot's opacity when the colour changes */
function onColorInput(e: Event) {
  store.setPaletteColor(store.currentColor, withAlpha((e.target as HTMLInputElement).value, hexAlpha(currentHex.value)));
}

const opacityPct = computed(() => Math.round(hexAlpha(currentHex.value) * 100));
function onOpacityInput(e: Event) {
  const pct = Number((e.target as HTMLInputElement).value);
  store.setPaletteColor(store.currentColor, withAlpha(currentHex.value, pct / 100));
}

/** A see-through colour is drawn over a checkerboard, so its opacity is visible. */
function swatchStyle(hex: string) {
  return hexAlpha(hex) < 1
    ? { background: `linear-gradient(${hex}, ${hex}), var(--checker)` }
    : { background: hex };
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
  <section class="panel palette" :class="{ collapsed: paletteCollapsed }" aria-labelledby="palette-heading">
    <h3>
      <button
        id="palette-heading"
        class="fold"
        :aria-expanded="!paletteCollapsed"
        aria-controls="palette-grid"
        :title="paletteCollapsed ? 'Show all palette colours' : 'Fold the palette down to the current colour'"
        @click="paletteCollapsed = !paletteCollapsed"
      >
        <Icon class="fold-chev" :icon="faChevronDown" :size="10" />
        Palette
      </button>
    </h3>

    <div class="current">
      <label class="chip" :style="swatchStyle(currentHex)" :title="`Change the colour of slot ${store.currentColor}`">
        <input type="color" :value="hexOpaque(currentHex)" :aria-label="`Colour of slot ${store.currentColor}`" @input="onColorInput" />
      </label>
      <div class="meta">
        <span class="hex">{{ hexOpaque(currentHex) }}</span>
        <span class="slot">Slot {{ store.currentColor }}, click the colour to edit it</span>
      </div>
    </div>

    <label class="opacity" title="How see-through voxels in this colour are — lower it for glass or water">
      <span>Opacity</span>
      <input type="range" min="5" max="100" step="1" :value="opacityPct" @input="onOpacityInput" />
      <span class="pct">{{ opacityPct }}%</span>
    </label>

    <div v-show="!paletteCollapsed" id="palette-grid" class="grid" role="group" aria-label="Colour palette">
      <button
        v-for="(hex, i) in palette"
        :key="i"
        class="swatch"
        :class="{ sel: i === store.currentColor }"
        :style="swatchStyle(hex)"
        :tabindex="i === store.currentColor ? 0 : -1"
        :aria-label="`Palette slot ${i}, ${hex}`"
        :aria-pressed="i === store.currentColor"
        :title="`Slot ${i} — ${hex}`"
        @click="store.setColor(i)"
        @keydown="onSwatchKey($event, i)"
      />
    </div>
  </section>
</template>

<style scoped>
.palette {
  padding: 10px 10px 12px;
  display: flex;
  flex-direction: column;
  min-height: 220px;
  flex: 1;
}
.palette.collapsed {
  min-height: 0;
  flex: none;
  padding-bottom: 2px;
}
.current {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.chip {
  position: relative;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  box-shadow: 0 3px 0 var(--key-side);
  cursor: pointer;
}
.chip:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.chip input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.hex {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-transform: uppercase;
}
.slot {
  font-size: 11.5px;
  color: var(--ink-faint);
}
.palette {
  --checker: repeating-conic-gradient(#b9bec8 0 25%, #eef0f3 0 50%) 0 0 / 8px 8px;
}
.opacity {
  display: grid;
  grid-template-columns: auto 1fr 3.2em;
  align-items: center;
  gap: 8px;
  margin: -2px 0 10px;
  font-size: 12px;
  color: var(--ink-dim);
}
.opacity input {
  width: 100%;
  min-width: 0;
}
.opacity .pct {
  text-align: right;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 3px;
  padding: 3px;
  margin: 0 -3px;
  overflow: auto;
  min-height: 0;
  flex: 1;
  align-content: start;
}
.swatch {
  padding: 0;
  aspect-ratio: 1;
  border: 0;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
}
.swatch:hover:not(.sel) {
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.18),
    0 0 0 2px var(--line-strong);
}
.swatch.sel {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  z-index: 1;
}
</style>
