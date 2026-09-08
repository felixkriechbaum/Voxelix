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
import Icon from './Icon.vue';
import {
  faRotateLeft,
  faRotateRight,
  faFloppyDisk,
  faGear,
  faFileExport,
  faBoxesStacked,
  faShapes,
  faFolderOpen,
} from '@fortawesome/pro-solid-svg-icons';
import type { ToolId } from '@/tools/types';
import type { BuildPlane } from '@/viewport/Picker';

const store = useEditorStore();
const { runner } = useSession();
const emit = defineEmits<{ (e: 'add-shape'): void; (e: 'settings'): void }>();
const { saving, saveProject } = useProjectSave();

const busy = ref('');

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
  { id: 'bucket', label: 'Bucket', key: 'G or 5' },
  { id: 'eyedropper', label: 'Pick', key: 'Q or 6' },
  { id: 'select', label: 'Select', key: 'V or 7' },
];
const planes: BuildPlane[] = ['xz', 'xy', 'yz'];

const brushes = [
  { f: 1, size: 16, label: 'Full voxel' },
  { f: 2, size: 10, label: 'Half voxel' },
  { f: 3, size: 6, label: 'Third of a voxel' },
  { f: 6, size: 3, label: 'Single cell (sixth of a voxel)' },
];
function pickBrush(f: number) {
  store.voxelFraction = f;
  // any sub-voxel choice subdivides the object so the smaller sizes are distinct
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
    <button
      class="ic"
      title="Projects — open or start another (this one is saved automatically)"
      aria-label="Back to projects"
      @click="store.closeProject()"
    >
      <Icon :icon="faFolderOpen" />
    </button>
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

    <template v-if="store.toolId === 'bucket'">
      <span class="divider" />
      <label class="lbl">Spread</label>
      <button
        :class="{ active: store.bucketMode === 'volume' }"
        title="Whole connected region of this colour, through the object (3D flood)"
        @click="store.bucketMode = 'volume'"
      >
        Volume
      </button>
      <button
        :class="{ active: store.bucketMode === 'face' }"
        title="Only the clicked face's surface layer — the coplanar patch of this colour"
        @click="store.bucketMode = 'face'"
      >
        Face
      </button>
      <button
        :class="{ active: store.bucketMode === 'outline' }"
        title="Only the border ring of that face patch"
        @click="store.bucketMode = 'outline'"
      >
        Outline
      </button>
      <label class="lbl" title="Hold Shift on click to recolour every matching voxel in scope, ignoring connectivity">Shift = loose</label>
    </template>

    <template v-if="['place', 'erase', 'box', 'paint'].includes(store.toolId)">
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
    <button
      class="ic"
      title="Add a primitive shape — box, sphere, cylinder or pyramid"
      aria-label="Add shape"
      @click="emit('add-shape')"
    >
      <Icon :icon="faShapes" />
    </button>
    <button
      class="ic"
      :disabled="!canUndo"
      title="Undo the last edit on this object — Ctrl+Z"
      aria-label="Undo"
      @click="runner?.undo()"
    >
      <Icon :icon="faRotateLeft" />
    </button>
    <button
      class="ic"
      :disabled="!canRedo"
      title="Redo — Ctrl+Shift+Z"
      aria-label="Redo"
      @click="runner?.redo()"
    >
      <Icon :icon="faRotateRight" />
    </button>

    <span class="spacer" />
    <span class="statusbox">
      <span v-if="saving || store.autosaveBusy || store.exportStatus" class="spin" />
      <span v-if="store.exportStatus" class="status">{{ store.exportStatus }}</span>
      <span
        v-else-if="saving"
        class="status"
      >Saving project…</span>
      <span
        v-else-if="autosave.text"
        class="status"
        :class="{ bad: autosave.bad }"
        :title="autosave.bad ? 'Could not write to browser storage' : 'Autosaved to this browser'"
      >
        {{ autosave.text }}
      </span>
    </span>

    <button
      class="ic"
      :disabled="saving"
      title="Save the project file — Ctrl+S"
      aria-label="Save project"
      @click="saveProject"
    >
      <Icon :icon="faFloppyDisk" />
    </button>
    <button class="ic" title="Settings — theme and export scale" aria-label="Settings" @click="emit('settings')">
      <Icon :icon="faGear" />
    </button>
    <button
      class="ic"
      :disabled="!!busy || !store.activeObjectId"
      title="Export the active object as a .glb file"
      aria-label="Export active object"
      @click="exportActive"
    >
      <Icon :icon="faFileExport" />
    </button>
    <button
      class="ic primary"
      :disabled="!!busy || store.objects.length === 0"
      :title="hasDirectoryPicker ? 'Export every object as .glb into a chosen folder' : 'Download one .glb per object'"
      aria-label="Export all objects"
      @click="exportAll"
    >
      <Icon :icon="faBoxesStacked" />
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
.ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  padding: 0;
  color: var(--ink-dim);
}
.ic:hover:not(:disabled) {
  color: var(--ink);
}
.ic.primary,
.ic.primary:hover:not(:disabled) {
  color: var(--accent-ink);
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
.statusbox {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 10px;
}
.status {
  font: 11px/1.4 system-ui, sans-serif;
  color: var(--ink-faint);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status.bad {
  color: var(--warn);
}
.spin {
  width: 12px;
  height: 12px;
  flex: none;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
