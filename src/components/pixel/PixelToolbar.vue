<script setup lang="ts">
import { computed, ref } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { usePixelSession } from '@/editor/pixel/session';
import { exportWidgetFiles, exportProjectFiles, normalizeResPrefix } from '@/pixel/exportWidget';
import { hasDirectoryPicker, pickDirectory, writeFileToDirectory, downloadBlob } from '@/core/io/fileSystem';
import { toast } from '@/editor/toasts';
import Icon from '@/components/Icon.vue';
import {
  faPencil,
  faEraser,
  faFill,
  faEyeDropper,
  faVectorSquare,
  faSlash,
  faCircle,
  faSquareDashed,
  faRotateLeft,
  faRotateRight,
  faFolderOpen,
  faBorderAll,
  faFileExport,
  faBoxesStacked,
} from '@fortawesome/pro-solid-svg-icons';
import type { PixelToolId } from '@/tools/pixel/types';

const emit = defineEmits<{ 'close-project': [] }>();

const store = usePixelStore();
const { runner } = usePixelSession();
const busy = ref('');

const tools: Array<{ id: PixelToolId; icon: typeof faPencil; label: string }> = [
  { id: 'pencil', icon: faPencil, label: 'Pencil' },
  { id: 'eraser', icon: faEraser, label: 'Eraser' },
  { id: 'bucket', icon: faFill, label: 'Bucket fill' },
  { id: 'picker', icon: faEyeDropper, label: 'Colour picker' },
  { id: 'rect', icon: faVectorSquare, label: 'Rectangle' },
  { id: 'line', icon: faSlash, label: 'Line' },
  { id: 'circle', icon: faCircle, label: 'Circle' },
  { id: 'select', icon: faSquareDashed, label: 'Select (Delete to erase, Esc to clear)' },
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

/**
 * The browser's directory picker only tells us which folder the user clicked,
 * not where that sits under their Godot project's res:// root — so the
 * texture paths baked into the exported .tres files need this typed in by
 * hand. Returns null if the user cancels.
 */
function promptResPrefix(): string | null {
  const input = window.prompt(
    "Godot res:// folder these files will live in (used inside the exported .tres files' texture paths):",
    'res://',
  );
  if (input === null) return null;
  return normalizeResPrefix(input);
}

async function exportActive() {
  const w = store.activeWidget();
  if (!w) return;
  const resPrefix = promptResPrefix();
  if (resPrefix === null) return;
  busy.value = 'export';
  store.exportStatus = `Exporting ${w.name}…`;
  try {
    await new Promise((r) => setTimeout(r)); // let the overlay paint first
    const { files } = await exportWidgetFiles(w, resPrefix);
    if (hasDirectoryPicker) {
      const dir = await pickDirectory();
      if (!dir) return; // picker cancelled
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

async function exportAll() {
  if (!store.project) return;
  const resPrefix = promptResPrefix();
  if (resPrefix === null) return;

  let dir: FileSystemDirectoryHandle | null = null;
  try {
    if (hasDirectoryPicker) {
      dir = await pickDirectory();
      if (!dir) return; // picker cancelled
    }

    busy.value = 'export-all';
    store.exportStatus = 'Preparing export…';
    const files = await exportProjectFiles(store.project, resPrefix, ({ done, total, name }) => {
      store.exportStatus = name
        ? `Exporting ${name} (${done + 1}/${total})…`
        : `Finishing (${done}/${total})…`;
    });
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

    <span class="sep" />
    <button
      :disabled="!!busy || !store.activeWidgetId"
      title="Export the active widget as PNGs + a StyleBoxTexture .tres per state"
      @click="exportActive"
    >
      <Icon :icon="faFileExport" />
    </button>
    <button
      class="primary"
      :disabled="!!busy || store.widgets.length === 0"
      :title="hasDirectoryPicker ? 'Export every widget into a chosen folder, plus one combined theme.tres' : 'Download every widget\'s files, plus one combined theme.tres'"
      @click="exportAll"
    >
      <Icon :icon="faBoxesStacked" />
    </button>
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
