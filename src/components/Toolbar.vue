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
import { toast } from '@/editor/toasts';
import Icon from './Icon.vue';
import {
  faRotateLeft,
  faRotateRight,
  faFloppyDisk,
  faGear,
  faFileExport,
  faBoxesStacked,
  faChevronLeft,
} from '@fortawesome/pro-solid-svg-icons';

const store = useEditorStore();
const { runner } = useSession();
const emit = defineEmits<{
  (e: 'settings'): void;
  (e: 'close-project'): void;
}>();
const { saving, saveProject } = useProjectSave();

const busy = ref('');
const iconUrl = `${import.meta.env.BASE_URL}icon.png`;

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
      toast('Object is empty — nothing to export', 'info');
      return;
    }
    await saveBinaryFile(file.name, file.blob);
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, 'error');
  } finally {
    busy.value = '';
    store.exportStatus = null;
  }
}

async function exportAll() {
  if (!store.project) return;

  let dir: FileSystemDirectoryHandle | null = null;
  try {
    if (hasDirectoryPicker) {
      dir = await pickDirectory();
      if (!dir) return; // picker cancelled
    }

    busy.value = 'export-all';
    store.exportStatus = 'Preparing export…';
    const files = await exportProjectToGlbs(store.project, ({ done, total, name }) => {
      store.exportStatus = name
        ? `Meshing ${name} (${done + 1}/${total})…`
        : `Finishing (${done}/${total})…`;
    });
    if (files.length === 0) {
      toast('No objects with voxels to export', 'info');
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
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, 'error');
  } finally {
    busy.value = '';
    store.exportStatus = null;
  }
}
</script>

<template>
  <header class="bar">
    <button
      class="ic back"
      title="All projects — this one is saved automatically"
      aria-label="Back to all projects"
      @click="emit('close-project')"
    >
      <Icon :icon="faChevronLeft" />
    </button>
    <img class="logo" :src="iconUrl" alt="" width="22" height="22" />
    <h1 class="name" :title="store.projectName">{{ store.projectName }}</h1>
    <span class="statusbox" role="status" aria-live="polite">
      <span v-if="saving || store.autosaveBusy || store.exportStatus" class="spin" />
      <span v-if="store.exportStatus" class="status">{{ store.exportStatus }}</span>
      <span v-else-if="saving" class="status">Saving project…</span>
      <span
        v-else-if="autosave.text"
        class="status"
        :class="{ bad: autosave.bad }"
        :title="autosave.bad ? 'Could not write to browser storage' : 'Autosaved to this browser'"
      >
        {{ autosave.text }}
      </span>
    </span>

    <span class="history">
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
    </span>

    <span class="spacer" />

    <button class="ic" title="Settings — theme and export scale" aria-label="Settings" @click="emit('settings')">
      <Icon :icon="faGear" />
    </button>
    <button
      class="text-btn"
      :disabled="saving"
      title="Save the project as a .voxproj file — Ctrl+S"
      @click="saveProject"
    >
      <Icon :icon="faFloppyDisk" :size="13" />
      <span>Save</span>
    </button>
    <button
      class="text-btn"
      :disabled="!!busy || !store.activeObjectId"
      title="Export the selected object as a .glb file"
      @click="exportActive"
    >
      <Icon :icon="faFileExport" :size="13" />
      <span>Export object</span>
    </button>
    <button
      class="text-btn primary"
      :disabled="!!busy || store.objects.length === 0"
      :title="hasDirectoryPicker ? 'Export every object as its own .glb into a folder you choose' : 'Download one .glb per object'"
      @click="exportAll"
    >
      <Icon :icon="faBoxesStacked" :size="13" />
      <span>Export all</span>
    </button>
  </header>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  min-width: 0;
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.logo {
  width: 22px;
  height: 22px;
  flex: none;
}
.name {
  margin: 0 4px 0 2px;
  font: 600 16px/1 var(--font-display);
  letter-spacing: 0.01em;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history {
  display: inline-flex;
  gap: 2px;
  margin-left: 6px;
  padding-left: 8px;
  border-left: 1px solid var(--line);
}
.ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  color: var(--ink-dim);
  background: transparent;
  border-color: transparent;
}
.ic:hover:not(:disabled) {
  color: var(--ink);
}
.text-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
}
.text-btn.primary {
  font-weight: 600;
}
.statusbox {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.status {
  font-size: 12px;
  color: var(--ink-faint);
  white-space: nowrap;
}
.status.bad {
  color: var(--warn);
}
.spin {
  width: 11px;
  height: 11px;
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

@media (max-width: 900px) {
  .text-btn span {
    display: none;
  }
  .text-btn {
    padding: 0 9px;
  }
  .statusbox {
    display: none;
  }
}
</style>
