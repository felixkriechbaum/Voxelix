<script setup lang="ts">
import { computed, reactive } from 'vue';
import { useEditorStore } from '@/stores/editor';

const store = useEditorStore();
const emit = defineEmits<{ (e: 'close'): void }>();

const s = store.exportSettings;
const form = reactive({
  refVoxels: s.refVoxels,
  refMeters: s.refMeters,
  upAxis: s.upAxis,
});

const perVoxel = computed(() => {
  const v = form.refMeters / form.refVoxels;
  return Number.isFinite(v) && v > 0 ? v : 0;
});

function apply() {
  store.updateExportSettings({
    refVoxels: Math.max(1, Math.round(form.refVoxels || 1)),
    refMeters: Math.max(0.0001, Number(form.refMeters) || 1),
    upAxis: form.upAxis,
  });
  emit('close');
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="panel dialog">
      <h3>Export settings</h3>

      <label>Scale reference</label>
      <div class="row scale">
        <input v-model.number="form.refVoxels" type="number" min="1" step="1" />
        <span>voxels&nbsp;=</span>
        <input v-model.number="form.refMeters" type="number" min="0.001" step="0.1" />
        <span>metres</span>
      </div>
      <p class="note">
        1 voxel = {{ perVoxel.toFixed(4) }} m · a 16-voxel edge = {{ (perVoxel * 16).toFixed(2) }} m
      </p>

      <label>Up axis</label>
      <div class="row">
        <label class="check"><input v-model="form.upAxis" type="radio" value="y" /> Y-up (glTF)</label>
        <label class="check"><input v-model="form.upAxis" type="radio" value="z" /> Z-up (Blender)</label>
      </div>

      <div class="row end">
        <button @click="emit('close')">Cancel</button>
        <button class="primary" @click="apply">Save</button>
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
  width: 340px;
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
  margin: 0;
  color: inherit;
}
.row.scale {
  align-items: center;
  gap: 6px;
}
.row.scale input {
  width: 64px;
}
.note {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-dim);
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
