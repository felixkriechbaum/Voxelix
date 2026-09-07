<script setup lang="ts">
import { computed, ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import {
  saveBinaryFile,
  pickDirectory,
  writeFileToDirectory,
  downloadBlob,
  hasDirectoryPicker,
} from '@/core/io/fileSystem';
import { exportObjectToGlb, exportProjectToGlbs } from '@/core/export/exportGlb';
import { resolveEffectiveData } from '@/core/project/resolve';
import { useProjectSave } from '@/editor/save';
import type { ToolId } from '@/tools/types';
import type { BuildPlane } from '@/viewport/Picker';

const store = useEditorStore();
const { runner } = useSession();
const emit = defineEmits<{ (e: 'add-shape'): void; (e: 'settings'): void }>();
const { saving, saveProject } = useProjectSave();

const busy = ref('');

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

const brushes = [
  { f: 1, size: 16, label: 'Full voxel' },
  { f: 2, size: 10, label: 'Half voxel' },
  { f: 3, size: 6, label: 'Third of a voxel' },
];
function pickBrush(f: number) {
  store.voxelFraction = f;
  // any brush choice subdivides the object so the three sizes are distinct
  if (store.activeObjectId) store.ensureDetail(store.activeObjectId);
}
const currentBrushF = computed(() => Math.min(store.activeDetail, store.voxelFraction));

async function exportActive() {
  const obj = store.activeObject();
  if (!obj || !store.project) return;
  busy.value = 'export';
  store.exportStatus = `Exporting ${obj.name}…`;
  try {
    await new Promise((r) => setTimeout(r)); // let the overlay paint first
    const data = resolveEffectiveData(obj, store.project);
    const file = await exportObjectToGlb(obj, data, store.project.palette, store.project.exportSettings);
    if (!file) {
      alert('Object is empty — nothing to export.');
      return;
    }
    await saveBinaryFile(file.name, file.blob);
  } finally {
    busy.value = '';
    store.exportStatus = null;
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
  store.exportStatus = 'Preparing export…';
  try {
    const files = await exportProjectToGlbs(store.project, ({ done, total, name }) => {
      store.exportStatus = name
        ? `Meshing ${name} (${done + 1}/${total})…`
        : `Finishing (${done}/${total})…`;
    });
    if (files.length === 0) {
      alert('No objects with voxels to export.');
      return;
    }
    if (dir) {
      for (const f of files) {
        store.exportStatus = `Writing ${f.name}…`;
        await writeFileToDirectory(dir, f.name, f.blob);
      }
    } else {
      for (const f of files) {
        store.exportStatus = `Downloading ${f.name}…`;
        downloadBlob(f.name, f.blob);
        await new Promise((r) => setTimeout(r, 350));
      }
    }
  } finally {
    busy.value = '';
    store.exportStatus = null;
  }
}
</script>

<template>
  <div class="panel bar">
    <strong class="name" :title="`Project: ${store.projectName}`">{{ store.projectName }}</strong>
    <span class="divider" />

    <button
      v-for="t in tools"
      :key="t.id"
      :class="{ active: store.toolId === t.id }"
      :title="`${t.label} tool — press ${t.key}`"
      @click="store.toolId = t.id"
    >
      {{ t.label }}
    </button>

    <template v-if="store.toolId === 'box'">
      <span class="divider" />
      <button
        :class="{ active: store.boxMode === 'fill' }"
        title="Fill the box with the current colour"
        @click="store.boxMode = 'fill'"
      >
        Fill
      </button>
      <button
        :class="{ active: store.boxMode === 'erase' }"
        title="Clear every voxel inside the box"
        @click="store.boxMode = 'erase'"
      >
        Erase
      </button>
    </template>

    <template v-if="['place', 'erase', 'box'].includes(store.toolId)">
      <span class="divider" />
      <label class="lbl">Brush</label>
      <button
        v-for="b in brushes"
        :key="b.f"
        class="brush"
        :class="{ active: currentBrushF === b.f }"
        :title="`${b.label} — the object is subdivided the first time you pick a smaller size`"
        @click="pickBrush(b.f)"
      >
        <span class="sq" :style="{ width: b.size + 'px', height: b.size + 'px' }" />
      </button>
    </template>

    <span class="divider" />
    <button
      :class="{ active: store.rmbErase }"
      title="When on, a right-click erases the voxel under the cursor instead of opening the menu"
      @click="store.rmbErase = !store.rmbErase"
    >
      RMB erase
    </button>

    <span class="divider" />
    <label class="lbl" title="Where new voxels land when you click empty space">Plane</label>
    <select
      :value="store.buildPlane"
      title="Build plane: ground (XZ), front (XY) or side (YZ)"
      @change="store.buildPlane = ($event.target as HTMLSelectElement).value as BuildPlane"
    >
      <option v-for="p in planes" :key="p" :value="p">{{ p.toUpperCase() }}</option>
    </select>
    <input
      class="num"
      type="number"
      title="Height of the build plane, in voxels"
      :value="store.buildOffset"
      min="0"
      @input="store.buildOffset = Math.max(0, Number(($event.target as HTMLInputElement).value) || 0)"
    />

    <span class="divider" />
    <button title="Add a primitive: box, sphere, cylinder or pyramid" @click="emit('add-shape')">
      + Shape
    </button>
    <button :disabled="!runner" title="Undo — Ctrl+Z" @click="runner?.undo()">Undo</button>
    <button :disabled="!runner" title="Redo — Ctrl+Shift+Z" @click="runner?.redo()">Redo</button>

    <span class="spacer" />
    <span v-if="store.exportStatus" class="status">{{ store.exportStatus }}</span>
    <span
      v-else-if="autosave.text"
      class="status"
      :class="{ bad: autosave.bad }"
      :title="autosave.bad ? 'Could not write to browser storage' : 'Autosaved to this browser'"
    >
      {{ autosave.text }}
    </span>

    <button :disabled="saving" title="Save the project file — Ctrl+S" @click="saveProject">
      {{ saving ? 'Saving…' : 'Save' }}
    </button>
    <button
      class="icon"
      title="Settings — theme and export scale"
      aria-label="Settings"
      @click="emit('settings')"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3.2" />
        <path
          d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
        />
      </svg>
    </button>
    <button :disabled="!!busy" title="Export the active object as .glb" @click="exportActive">
      Export GLB
    </button>
    <button
      class="primary"
      :disabled="!!busy || store.objects.length === 0"
      :title="hasDirectoryPicker ? 'Export every object to a chosen folder' : 'Download one .glb per object'"
      @click="exportAll"
    >
      Export all
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
  font-weight: 600;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lbl {
  color: var(--ink-dim);
}
.brush {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--ink-dim);
}
.brush.active {
  color: var(--accent-ink);
}
.brush .sq {
  display: block;
  background: currentColor;
  border-radius: 1px;
}
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  padding: 0;
  color: var(--ink-dim);
}
.icon:hover:not(:disabled) {
  color: var(--ink);
}
.num {
  width: 52px;
}
.divider {
  width: 1px;
  align-self: stretch;
  background: var(--line);
  margin: 0 3px;
}
.status {
  font-size: 11px;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status.bad {
  color: var(--warn);
}
</style>
