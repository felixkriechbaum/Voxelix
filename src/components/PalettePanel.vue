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
</script>

<template>
  <div class="panel palette">
    <div class="row">
      <h3>Palette</h3>
      <span class="spacer" />
      <span class="idx">#{{ store.currentColor }}</span>
    </div>

    <div class="grid">
      <button
        v-for="(hex, i) in palette"
        :key="i"
        class="swatch"
        :class="{ sel: i === store.currentColor }"
        :style="{ background: hex }"
        @click="store.setColor(i)"
      />
    </div>

    <div class="row edit">
      <input type="color" :value="currentHex" @input="onColorInput" />
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
  grid-template-columns: repeat(16, 1fr);
  gap: 2px;
  margin: 6px 0;
}
.swatch {
  padding: 0;
  aspect-ratio: 1;
  border: 1px solid rgba(0, 0, 0, 0.35);
  border-radius: 2px;
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
