<script setup lang="ts">
import { reactive } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import { voxelizeShape, type ShapeKind } from '@/core/shapes/primitives';

const store = useEditorStore();
const { runner } = useSession();
const emit = defineEmits<{ (e: 'close'): void }>();

const kinds: ShapeKind[] = ['box', 'sphere', 'cylinder', 'pyramid'];
const spec = reactive({ kind: 'box' as ShapeKind, w: 16, h: 16, d: 16, hollow: false });

function add() {
  const obj = store.activeObject();
  if (!obj || !runner.value) return;
  const read = runner.value.data;
  const cells = voxelizeShape({
    kind: spec.kind,
    w: clamp(spec.w),
    h: clamp(spec.h),
    d: clamp(spec.d),
    hollow: spec.hollow,
  });
  const ox = Math.max(0, Math.floor((read.sizeX - spec.w) / 2));
  const oz = Math.max(0, Math.floor((read.sizeZ - spec.d) / 2));
  const value = store.currentColor + 1;
  runner.value.runExternal(`Add ${spec.kind}`, (write) => {
    for (const [x, y, z] of cells) {
      const px = ox + x;
      const pz = oz + z;
      if (read.inBounds(px, y, pz)) write(px, y, pz, value);
    }
  });
  emit('close');
}

function clamp(n: number) {
  return Math.max(1, Math.round(n || 1));
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel dialog">
      <h3>Add shape</h3>

      <label>Shape</label>
      <select v-model="spec.kind">
        <option v-for="k in kinds" :key="k" :value="k">{{ k }}</option>
      </select>

      <label>Dimensions (W × H × D)</label>
      <div class="row">
        <input v-model.number="spec.w" type="number" min="1" />
        <input v-model.number="spec.h" type="number" min="1" />
        <input v-model.number="spec.d" type="number" min="1" />
      </div>

      <label class="check">
        <input v-model="spec.hollow" type="checkbox" />
        Hollow shell
      </label>

      <div class="row end">
        <button @click="emit('close')">Cancel</button>
        <button class="primary" @click="add">Add</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: grid;
  place-items: center;
  z-index: 20;
}
.dialog {
  width: 300px;
  padding: 18px;
}
label {
  display: block;
  margin: 12px 0 4px;
  color: var(--text-dim);
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
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #0b1220;
  font-weight: 600;
}
</style>
