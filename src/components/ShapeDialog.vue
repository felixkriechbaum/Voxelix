<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import { voxelizeShape, type ShapeKind } from '@/core/shapes/primitives';
import { resolveEffectiveData } from '@/core/project/resolve';

const store = useEditorStore();
const { runner } = useSession();
const emit = defineEmits<{ (e: 'close'): void }>();

const kinds: ShapeKind[] = ['box', 'sphere', 'cylinder', 'pyramid'];
const spec = reactive({ kind: 'box' as ShapeKind, w: 16, h: 16, d: 16, hollow: false });
const firstControl = ref<HTMLSelectElement | null>(null);
const dialog = ref<HTMLFormElement | null>(null);
let returnFocus: HTMLElement | null = null;
const maxDims = computed<[number, number, number]>(() => {
  void store.activeVersion;
  void store.structureVersion;
  const obj = store.activeObject();
  if (!obj || !store.project) return [1, 1, 1];
  const data = resolveEffectiveData(obj, store.project);
  const detail = store.activeDetail;
  return [data.sizeX, data.sizeY, data.sizeZ].map((n) => Math.max(1, Math.floor(n / detail))) as [
    number,
    number,
    number,
  ];
});

function close() {
  emit('close');
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (e.key !== 'Tab' || !dialog.value) return;
  const controls = Array.from(
    dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'),
  );
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!dialog.value.contains(document.activeElement)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  returnFocus = document.activeElement as HTMLElement | null;
  spec.w = Math.min(spec.w, maxDims.value[0]);
  spec.h = Math.min(spec.h, maxDims.value[1]);
  spec.d = Math.min(spec.d, maxDims.value[2]);
  window.addEventListener('keydown', onKey);
  void nextTick(() => firstControl.value?.focus());
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  returnFocus?.focus();
});

function add() {
  const obj = store.activeObject();
  if (!obj || !runner.value) return;
  const read = runner.value.data;
  const det = store.activeDetail; // dimensions are entered in voxels
  const w = clamp(spec.w, maxDims.value[0]) * det;
  const h = clamp(spec.h, maxDims.value[1]) * det;
  const d = clamp(spec.d, maxDims.value[2]) * det;
  const cells = voxelizeShape({ kind: spec.kind, w, h, d, hollow: spec.hollow });
  const ox = Math.max(0, Math.floor((read.sizeX - w) / 2));
  const oz = Math.max(0, Math.floor((read.sizeZ - d) / 2));
  const value = store.currentColor + 1;
  runner.value.runExternal(`Add ${spec.kind}`, (write) => {
    for (const [x, y, z] of cells) {
      const px = ox + x;
      const pz = oz + z;
      if (read.inBounds(px, y, pz)) write(px, y, pz, value);
    }
  });
  close();
}

function clamp(n: number, max: number) {
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.round(n))) : 1;
}
</script>

<template>
  <div class="overlay" @click.self="close">
    <form ref="dialog" class="panel dialog" role="dialog" aria-modal="true" aria-labelledby="shape-title" @submit.prevent="add">
      <h3 id="shape-title">Add shape</h3>

      <label for="shape-kind">Shape</label>
      <select id="shape-kind" ref="firstControl" v-model="spec.kind">
        <option v-for="k in kinds" :key="k" :value="k">{{ k }}</option>
      </select>

      <span class="field-label">Dimensions in voxels</span>
      <div class="row dims">
        <label>W <input v-model.number="spec.w" type="number" min="1" :max="maxDims[0]" /></label>
        <label>H <input v-model.number="spec.h" type="number" min="1" :max="maxDims[1]" /></label>
        <label>D <input v-model.number="spec.d" type="number" min="1" :max="maxDims[2]" /></label>
      </div>

      <label class="check">
        <input v-model="spec.hollow" type="checkbox" />
        Hollow shell
      </label>

      <div class="row end">
        <button type="button" @click="close">Cancel</button>
        <button class="primary" type="submit">Add</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  display: grid;
  place-items: center;
  z-index: 30;
}
.dialog {
  width: min(300px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  padding: 18px;
  box-shadow: var(--shadow);
}
label {
  display: block;
  margin: 12px 0 4px;
  color: var(--text-dim);
}
.field-label {
  display: block;
  margin: 12px 0 4px;
  color: var(--text-dim);
}
.dims {
  align-items: flex-end;
}
.dims label {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 11px;
}
.dims input {
  margin-top: 3px;
}
label.check {
  display: flex;
  gap: 6px;
  align-items: center;
}
.row.end {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
