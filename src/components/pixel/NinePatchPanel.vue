<script setup lang="ts">
import { computed } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { setPatchField } from '@/core/pixel/ninepatch';

const store = usePixelStore();
// The project graph is markRaw'd (no deep reactivity), so binding straight to
// `store.activeWidget().patch` would never re-render after store.setPatch
// mutates it in place — same object reference in, same object reference out.
// Depend on structureVersion explicitly and hand the template a fresh copy.
const widget = computed(() => {
  void store.structureVersion;
  const w = store.activeWidget();
  return w ? { id: w.id, width: w.width, height: w.height, patch: { ...w.patch } } : null;
});

function set(field: 'left' | 'top' | 'right' | 'bottom', e: Event) {
  const w = widget.value;
  if (!w) return;
  const raw = Number((e.target as HTMLInputElement).value) || 0;
  store.setPatch(setPatchField(w.patch, field, raw, { w: w.width, h: w.height }));
}
</script>

<template>
  <div v-if="widget" class="panel patch-panel">
    <div class="row">
      <h3>Nine-patch margins</h3>
    </div>
    <p class="hint">Stretch-safe borders for the preview and the exported StyleBoxTexture, in pixels.</p>
    <div class="grid">
      <label>Left<input type="number" min="0" :value="widget.patch.left" @change="set('left', $event)" /></label>
      <label>Top<input type="number" min="0" :value="widget.patch.top" @change="set('top', $event)" /></label>
      <label>Right<input type="number" min="0" :value="widget.patch.right" @change="set('right', $event)" /></label>
      <label>Bottom<input type="number" min="0" :value="widget.patch.bottom" @change="set('bottom', $event)" /></label>
    </div>
  </div>
</template>

<style scoped>
.patch-panel {
  padding: 10px;
}
.hint {
  margin: 0 0 8px;
  color: var(--text-dim);
  font-size: 12px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
}
.grid label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--text-dim);
}
</style>
