<script setup lang="ts">
import { computed } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { usePixelSession } from '@/editor/pixel/session';
import Icon from '@/components/Icon.vue';
import {
  faPencil,
  faEraser,
  faFill,
  faEyeDropper,
  faRotateLeft,
  faRotateRight,
  faFolderOpen,
  faBorderAll,
} from '@fortawesome/pro-solid-svg-icons';
import type { PixelToolId } from '@/tools/pixel/types';

const emit = defineEmits<{ 'close-project': [] }>();

const store = usePixelStore();
const { runner } = usePixelSession();

const tools: Array<{ id: PixelToolId; icon: typeof faPencil; label: string }> = [
  { id: 'pencil', icon: faPencil, label: 'Pencil' },
  { id: 'eraser', icon: faEraser, label: 'Eraser' },
  { id: 'bucket', icon: faFill, label: 'Bucket fill' },
  { id: 'picker', icon: faEyeDropper, label: 'Colour picker' },
];

const brushSizes = [1, 2, 3, 4];
const zoomLevels = [4, 8, 12, 16, 24, 32];

// runner.canUndo/canRedo read a plain class getter outside Vue's reactivity —
// force these computeds to depend on the version counters the runner bumps
// on every commit/undo/redo, same as the voxel Toolbar's canUndo/canRedo.
const canUndo = computed(() => {
  void store.editVersion;
  void store.activeVersion;
  return runner.value?.canUndo ?? false;
});
const canRedo = computed(() => {
  void store.editVersion;
  void store.activeVersion;
  return runner.value?.canRedo ?? false;
});
</script>

<template>
  <div class="toolbar row">
    <button title="Back to start screen" @click="emit('close-project')">
      <Icon :icon="faFolderOpen" />
    </button>
    <span class="sep" />

    <button
      v-for="t in tools"
      :key="t.id"
      class="tool"
      :class="{ active: store.toolId === t.id }"
      :title="t.label"
      @click="store.toolId = t.id"
    >
      <Icon :icon="t.icon" />
    </button>

    <span class="sep" />
    <label class="lbl">Brush</label>
    <div class="row brush-row">
      <button
        v-for="n in brushSizes"
        :key="n"
        class="brush"
        :class="{ active: store.brushSize === n }"
        :title="`${n}×${n} px`"
        @click="store.brushSize = n"
      >{{ n }}</button>
    </div>

    <template v-if="store.toolId === 'bucket'">
      <span class="sep" />
      <button
        class="tool"
        :class="{ active: store.contiguous }"
        title="Only fill the connected region (off = every matching pixel)"
        @click="store.contiguous = !store.contiguous"
      >
        <Icon :icon="faBorderAll" />
      </button>
    </template>

    <span class="spacer" />

    <button :disabled="!canUndo" title="Undo (Ctrl+Z)" @click="runner?.undo()">
      <Icon :icon="faRotateLeft" />
    </button>
    <button :disabled="!canRedo" title="Redo (Ctrl+Y)" @click="runner?.redo()">
      <Icon :icon="faRotateRight" />
    </button>

    <span class="sep" />
    <label class="lbl">Zoom</label>
    <select :value="store.zoom" @change="store.zoom = Number(($event.target as HTMLSelectElement).value)">
      <option v-for="z in zoomLevels" :key="z" :value="z">{{ z }}×</option>
    </select>
    <button
      class="tool"
      :class="{ active: store.showGrid }"
      title="Toggle pixel grid"
      @click="store.showGrid = !store.showGrid"
    >Grid</button>
  </div>
</template>

<style scoped>
.toolbar {
  padding: 6px 10px;
  gap: 6px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-1);
}
/* the plain `button` rule in style.css doesn't centre its content (no
   display:flex) — fine for a single line of text, which browsers centre by
   default, but an <Icon> svg inside sits off-centre without it */
.toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.sep {
  width: 1px;
  align-self: stretch;
  background: var(--line);
  margin: 0 2px;
}
.lbl {
  color: var(--text-dim);
  font-size: 12px;
}
.tool.active,
.brush.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
}
.brush-row {
  gap: 2px;
}
.brush {
  width: 26px;
  padding: 4px 0;
  font-size: 12px;
}
</style>
