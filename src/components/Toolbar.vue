<script setup lang="ts">
import { ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import { serializeProject } from '@/core/io/projectFile';
import { saveTextFile, saveBinaryFile } from '@/core/io/fileSystem';
import { exportObjectToGlb } from '@/core/export/exportGlb';
import { resolveEffectiveData } from '@/core/project/resolve';
import type { ToolId } from '@/tools/types';
import type { BuildPlane } from '@/viewport/Picker';

const store = useEditorStore();
const { runner } = useSession();
const emit = defineEmits<{ (e: 'add-shape'): void }>();

const busy = ref('');

const tools: Array<{ id: ToolId; label: string; key: string }> = [
  { id: 'place', label: 'Place', key: '1' },
  { id: 'erase', label: 'Erase', key: '2' },
  { id: 'box', label: 'Box', key: '3' },
  { id: 'paint', label: 'Paint', key: '4' },
  { id: 'eyedropper', label: 'Pick', key: '5' },
];
const planes: BuildPlane[] = ['xz', 'xy', 'yz'];

async function save() {
  if (!store.project) return;
  busy.value = 'save';
  try {
    const handle = await saveTextFile(
      `${store.project.name}.voxproj`,
      serializeProject(store.project),
      store.fileHandle,
    );
    if (handle) store.fileHandle = handle;
  } finally {
    busy.value = '';
  }
}

async function exportActive() {
  const obj = store.activeObject();
  if (!obj || !store.project) return;
  busy.value = 'export';
  try {
    const data = resolveEffectiveData(obj, store.project);
    const file = await exportObjectToGlb(obj, data, store.project.palette, store.project.exportSettings);
    if (!file) {
      alert('Object is empty — nothing to export.');
      return;
    }
    await saveBinaryFile(file.name, file.blob);
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <div class="panel bar">
    <strong class="name">{{ store.projectName }}</strong>
    <span class="divider" />

    <button
      v-for="t in tools"
      :key="t.id"
      :class="{ active: store.toolId === t.id }"
      :title="`${t.label} (${t.key})`"
      @click="store.toolId = t.id"
    >
      {{ t.label }}
    </button>

    <template v-if="store.toolId === 'box'">
      <span class="divider" />
      <button :class="{ active: store.boxMode === 'fill' }" @click="store.boxMode = 'fill'">Fill</button>
      <button :class="{ active: store.boxMode === 'erase' }" @click="store.boxMode = 'erase'">Erase</button>
    </template>

    <span class="divider" />
    <label class="lbl">Plane</label>
    <select :value="store.buildPlane" @change="store.buildPlane = ($event.target as HTMLSelectElement).value as BuildPlane">
      <option v-for="p in planes" :key="p" :value="p">{{ p.toUpperCase() }}</option>
    </select>
    <input
      class="num"
      type="number"
      :value="store.buildOffset"
      min="0"
      @input="store.buildOffset = Math.max(0, Number(($event.target as HTMLInputElement).value) || 0)"
    />

    <span class="divider" />
    <button @click="emit('add-shape')">+ Shape</button>
    <button :disabled="!runner" @click="runner?.undo()">Undo</button>
    <button :disabled="!runner" @click="runner?.redo()">Redo</button>

    <span class="spacer" />
    <button :disabled="busy === 'save'" @click="save">Save</button>
    <button class="primary" :disabled="busy === 'export'" @click="exportActive">Export GLB</button>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  padding: 7px 9px;
}
.name {
  font-size: 13px;
}
.lbl {
  color: var(--text-dim);
}
.num {
  width: 54px;
}
.divider {
  width: 1px;
  align-self: stretch;
  background: var(--border);
  margin: 0 3px;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #0b1220;
  font-weight: 600;
}
</style>
