<script setup lang="ts">
import { computed } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import { selectionDims } from '@/core/ops/selection';
import {
  deleteSelection,
  duplicateSelection,
  moveSelection,
  recolourSelection,
} from '@/editor/selectionOps';

const store = useEditorStore();
const { runner } = useSession();

const dims = computed(() => (store.selection ? selectionDims(store.selection) : null));
const smartCount = computed(() => store.selection?.cells?.length ?? null);

function nudge(d: [number, number, number]) {
  if (runner.value && store.selection) moveSelection(runner.value, store.selection, d);
}
function recolour() {
  if (runner.value && store.selection) recolourSelection(runner.value, store.selection, store.currentColor);
}
function duplicate() {
  if (runner.value && store.selection) duplicateSelection(runner.value, store.selection);
}
function remove() {
  if (runner.value && store.selection) deleteSelection(runner.value, store.selection);
}
</script>

<template>
  <div class="sel panel">
    <div class="hd">
      {{ smartCount != null ? 'Region' : 'Selection' }}
      <span v-if="smartCount != null" class="dim">{{ smartCount }} voxels</span>
      <span v-else-if="dims" class="dim">{{ dims[0] }}×{{ dims[1] }}×{{ dims[2] }}</span>
    </div>

    <div class="nudge">
      <button title="Move −X (←)" @click="nudge([-1, 0, 0])">−X</button>
      <button title="Move +X (→)" @click="nudge([1, 0, 0])">+X</button>
      <button title="Move +Y (Shift ↑)" @click="nudge([0, 1, 0])">+Y</button>
      <button title="Move −Y (Shift ↓)" @click="nudge([0, -1, 0])">−Y</button>
      <button title="Move −Z (↑)" @click="nudge([0, 0, -1])">−Z</button>
      <button title="Move +Z (↓)" @click="nudge([0, 0, 1])">+Z</button>
    </div>

    <div class="acts">
      <button :title="`Recolour to palette #${store.currentColor}`" @click="recolour">Recolour</button>
      <button title="Stamp a copy alongside" @click="duplicate">Duplicate</button>
      <button class="danger" title="Delete voxels (Del)" @click="remove">Delete</button>
      <button title="Clear selection (Esc)" @click="store.clearSelection()">Deselect</button>
    </div>
  </div>
</template>

<style scoped>
.sel {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 150px;
}
.hd {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-dim);
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.dim {
  font-weight: 400;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.nudge {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
}
.acts {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
}
.sel button {
  padding: 4px 6px;
  font-size: 11px;
}
.sel .danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
