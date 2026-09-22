<script setup lang="ts">
import { computed } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { hexToRgba, rgbaToHex, unpackRgba, packRgba } from '@/core/pixel/pack';
import { openTextFile } from '@/core/io/fileSystem';
import { deserializeProject } from '@/core/io/projectFile';
import { PROJECT_FILE_EXT } from '@/core/project/types';
import { toast } from '@/editor/toasts';
import Icon from '@/components/Icon.vue';
import { faFileImport } from '@fortawesome/pro-solid-svg-icons';

const store = usePixelStore();

// project.palette is a plain property on the markRaw'd project graph, so
// importPalette() replacing it needs structureVersion as an explicit
// dependency here — same reactivity gotcha as NinePatchPanel.vue's `widget`.
const palette = computed(() => {
  void store.structureVersion;
  return store.project?.palette ?? [];
});

/** The one deliberate bridge between the two otherwise-independent workspaces. */
async function importPalette() {
  const file = await openTextFile([PROJECT_FILE_EXT, '.json']);
  if (!file) return;
  try {
    const voxelProject = deserializeProject(file.text);
    store.importPalette(voxelProject.palette);
    toast(`Imported palette from "${voxelProject.name}"`, 'success');
  } catch (e) {
    toast(`Could not read that project: ${(e as Error).message}`, 'error');
  }
}
const primaryHex = computed(() => rgbaToHex(store.primaryColor));
const secondaryHex = computed(() => rgbaToHex(store.secondaryColor));
const primaryAlpha = computed(() => unpackRgba(store.primaryColor)[3]);
const secondaryAlpha = computed(() => unpackRgba(store.secondaryColor)[3]);

function pick(i: number, e: MouseEvent) {
  const hex = palette.value[i];
  if (!hex) return;
  if (e.button === 2) store.setSecondary(hexToRgba(hex, 255));
  else store.setPrimary(hexToRgba(hex, 255));
}

function onPrimaryHex(e: Event) {
  store.setPrimary(hexToRgba((e.target as HTMLInputElement).value, primaryAlpha.value));
}
function onSecondaryHex(e: Event) {
  store.setSecondary(hexToRgba((e.target as HTMLInputElement).value, secondaryAlpha.value));
}
function onPrimaryAlpha(e: Event) {
  const [r, g, b] = unpackRgba(store.primaryColor);
  store.setPrimary(packRgba(r, g, b, Number((e.target as HTMLInputElement).value)));
}
function onSecondaryAlpha(e: Event) {
  const [r, g, b] = unpackRgba(store.secondaryColor);
  store.setSecondary(packRgba(r, g, b, Number((e.target as HTMLInputElement).value)));
}
function swap() {
  const p = store.primaryColor;
  store.setPrimary(store.secondaryColor);
  store.setSecondary(p);
}
</script>

<template>
  <div class="panel color-panel">
    <div class="row">
      <h3>Colour</h3>
      <span class="spacer" />
      <button
        class="icon-btn"
        title="Import the palette from a .voxproj file — keeps pixel and voxel work colour-consistent"
        @click="importPalette"
      >
        <Icon :icon="faFileImport" :size="12" />
      </button>
    </div>

    <div class="current row">
      <div class="swatches" title="Left click paints primary, right click paints secondary">
        <span class="sw sw-secondary" :style="{ background: secondaryHex }" />
        <span class="sw sw-primary" :style="{ background: primaryHex }" />
      </div>
      <button class="swap" title="Swap primary / secondary" @click="swap">⇄</button>
      <span class="spacer" />
    </div>

    <div class="field row">
      <label>Primary</label>
      <input type="color" :value="primaryHex" @input="onPrimaryHex" />
      <input
        type="range"
        min="0"
        max="255"
        :value="primaryAlpha"
        title="Alpha"
        @input="onPrimaryAlpha"
      />
    </div>
    <div class="field row">
      <label>Secondary</label>
      <input type="color" :value="secondaryHex" @input="onSecondaryHex" />
      <input
        type="range"
        min="0"
        max="255"
        :value="secondaryAlpha"
        title="Alpha"
        @input="onSecondaryAlpha"
      />
    </div>

    <div class="grid" role="group" aria-label="Colour swatches" @contextmenu.prevent>
      <button
        v-for="(hex, i) in palette"
        :key="i"
        class="swatch"
        :style="{ background: hex }"
        :title="`Slot ${i} — ${hex} (right click = secondary)`"
        @mousedown="pick(i, $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.color-panel {
  padding: 10px;
}
.current {
  margin: 4px 0 10px;
}
.swatches {
  position: relative;
  width: 40px;
  height: 40px;
  flex: none;
}
.sw {
  position: absolute;
  width: 26px;
  height: 26px;
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  background-image:
    linear-gradient(45deg, #888 25%, transparent 25%),
    linear-gradient(-45deg, #888 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #888 75%),
    linear-gradient(-45deg, transparent 75%, #888 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  background-color: #fff;
}
.sw-secondary {
  right: 0;
  bottom: 0;
}
.sw-primary {
  left: 0;
  top: 0;
}
.swap {
  width: 26px;
  padding: 0;
}
/* the plain `button` rule in style.css doesn't centre its content (no
   display:flex) — fine for a single line of text, which browsers centre by
   default, but an <Icon> svg inside sits off-centre without it */
.icon-btn {
  width: 26px;
  padding: 0;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.field {
  margin-bottom: 6px;
  gap: 8px;
}
.field label {
  width: 60px;
  flex: none;
  color: var(--text-dim);
  font-size: 12px;
}
.field input[type='color'] {
  width: 32px;
  height: 24px;
  padding: 0;
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  flex: none;
}
.field input[type='range'] {
  flex: 1;
  /* a range input's intrinsic width is a flex item's default min-width floor —
     without resetting it, flex:1 can't actually shrink it to fit a narrow panel */
  min-width: 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 2px;
  margin-top: 8px;
  max-height: 160px;
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
</style>
