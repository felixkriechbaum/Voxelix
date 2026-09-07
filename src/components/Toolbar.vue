<script setup lang="ts">
import { computed, ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import { serializeProject } from '@/core/io/projectFile';
import {
  saveTextFile,
  saveBinaryFile,
  pickDirectory,
  writeFileToDirectory,
  downloadBlob,
  hasDirectoryPicker,
} from '@/core/io/fileSystem';
import { exportObjectToGlb, exportProjectToGlbs } from '@/core/export/exportGlb';
import { resolveEffectiveData } from '@/core/project/resolve';
import type { ToolId } from '@/tools/types';
import type { BuildPlane } from '@/viewport/Picker';

const store = useEditorStore();
const { runner } = useSession();
const emit = defineEmits<{ (e: 'add-shape'): void; (e: 'export-settings'): void }>();

const busy = ref('');
const batchLabel = ref('');

const autosave = computed(() => {
  if (store.autosaveError) return { text: 'Autosave failed', bad: true };
  if (store.autosaveBusy) return { text: 'Saving…', bad: false };
  if (store.autosaveAt) return { text: 'Saved locally', bad: false };
  return { text: '', bad: false };
});

const tools: Array<{ id: ToolId; label: string; key: string }> = [
  { id: 'place', label: 'Place', key: 'W or 1' },
  { id: 'erase', label: 'Erase', key: 'E or 2' },
  { id: 'box', label: 'Box', key: 'R or 3' },
  { id: 'paint', label: 'Paint', key: 'T or 4' },
  { id: 'eyedropper', label: 'Pick', key: 'Q or 5' },
  { id: 'select', label: 'Select', key: 'V or 6' },
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

async function exportAll() {
  if (!store.project) return;

  let dir: FileSystemDirectoryHandle | null = null;
  if (hasDirectoryPicker) {
    dir = await pickDirectory();
    if (!dir) return; // picker cancelled
  }

  busy.value = 'export-all';
  batchLabel.value = 'Preparing…';
  try {
    const files = await exportProjectToGlbs(store.project, ({ done, total, name }) => {
      batchLabel.value = name ? `${done}/${total} · ${name}` : `${done}/${total}`;
    });
    if (files.length === 0) {
      alert('No objects with voxels to export.');
      return;
    }
    if (dir) {
      for (const f of files) await writeFileToDirectory(dir, f.name, f.blob);
    } else {
      for (const f of files) {
        downloadBlob(f.name, f.blob);
        await new Promise((r) => setTimeout(r, 350));
      }
    }
  } finally {
    busy.value = '';
    batchLabel.value = '';
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
    <button
      :class="{ active: store.rmbErase }"
      title="Right-click erases the voxel under the cursor instead of opening the context menu"
      @click="store.rmbErase = !store.rmbErase"
    >
      RMB erase
    </button>

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
    <span v-if="busy === 'export-all'" class="batch">{{ batchLabel }}</span>
    <span v-else-if="autosave.text" class="batch" :class="{ bad: autosave.bad }" :title="autosave.bad ? 'Could not write to browser storage' : 'Autosaved to this browser (IndexedDB)'">{{ autosave.text }}</span>
    <button :disabled="!!busy" @click="save">Save</button>
    <button
      :disabled="!!busy"
      :title="`Export scale: ${store.exportSettings.refVoxels} vox = ${store.exportSettings.refMeters} m`"
      @click="emit('export-settings')"
    >
      Units…
    </button>
    <button :disabled="!!busy" @click="exportActive">Export GLB</button>
    <button
      class="primary"
      :disabled="!!busy || store.objects.length === 0"
      :title="hasDirectoryPicker ? 'Export every object to a folder' : 'Download a .glb for every object'"
      @click="exportAll"
    >
      Export all{{ hasDirectoryPicker ? '…' : '' }}
    </button>
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
.batch {
  font-size: 11px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.batch.bad {
  color: var(--danger);
}
</style>
