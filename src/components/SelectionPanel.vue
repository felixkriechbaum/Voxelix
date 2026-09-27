<script setup lang="ts">
import { computed } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import { selectionCells, selectionDims } from '@/core/ops/selection';
import {
  deleteSelection,
  duplicateSelection,
  moveSelection,
  recolourSelection,
  revertSelectionToBase,
} from '@/editor/selectionOps';

const store = useEditorStore();
const { runner } = useSession();

const dims = computed(() => (store.selection ? selectionDims(store.selection) : null));
const smartCount = computed(() => store.selection?.cells?.length ?? null);
const canGiveBack = computed(() => {
  void store.activeVersion;
  void store.structureVersion;
  const obj = store.activeObject();
  return obj?.kind === 'extend' && !!obj.baseId && !!store.project?.getById(obj.baseId);
});

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
/** only normal objects have parts — an overlay is a single diff */
const canSplit = computed(() => {
  void store.activeVersion;
  void store.structureVersion;
  return store.activeObject()?.kind === 'normal';
});
function toNewPart() {
  if (runner.value && store.selection) store.selectionToNewPart(
      selectionCells(runner.value.data, store.selection).map((c): [number, number, number] => [c.x, c.y, c.z]),
    );
}
function toBase() {
  if (runner.value && store.selection) revertSelectionToBase(runner.value, store.selection);
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
      <button title="Move −X (←)" @click="nudge([-1, 0, 0])">−<span class="ax" style="color: var(--axis-x)">X</span></button>
      <button title="Move +X (→)" @click="nudge([1, 0, 0])">+<span class="ax" style="color: var(--axis-x)">X</span></button>
      <button title="Move +Y (Shift ↑)" @click="nudge([0, 1, 0])">+<span class="ax" style="color: var(--axis-y)">Y</span></button>
      <button title="Move −Y (Shift ↓)" @click="nudge([0, -1, 0])">−<span class="ax" style="color: var(--axis-y)">Y</span></button>
      <button title="Move −Z (↑)" @click="nudge([0, 0, -1])">−<span class="ax" style="color: var(--axis-z)">Z</span></button>
      <button title="Move +Z (↓)" @click="nudge([0, 0, 1])">+<span class="ax" style="color: var(--axis-z)">Z</span></button>
    </div>

    <div class="acts">
      <button :title="`Recolour to palette #${store.currentColor}`" @click="recolour">Recolour</button>
      <button title="Stamp a copy alongside" @click="duplicate">Duplicate</button>
      <button class="danger" title="Delete voxels (Del)" @click="remove">Delete</button>
      <button title="Clear selection (Esc)" @click="store.clearSelection()">Deselect</button>
      <button
        v-if="canSplit"
        class="wide"
        title="Move these voxels into a part of their own — then give just that part a modifier"
        @click="toNewPart"
      >
        Move to new part
      </button>
      <button
        v-if="canGiveBack"
        class="wide"
        title="Drop this overlay's changes inside the selection so those cells inherit from the base again — everything outside stays as it is"
        @click="toBase"
      >
        Give back to base
      </button>
    </div>
  </div>
</template>

<style scoped>
.sel {
  padding: 8px;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 176px;
}
.hd {
  font: 600 13px/1.3 var(--font-display);
  color: var(--ink);
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
.ax {
  font-weight: 600;
}
.acts .wide {
  grid-column: 1 / -1;
}
.sel .danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
