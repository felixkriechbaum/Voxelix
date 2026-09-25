<script setup lang="ts">
import { computed, ref } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { usePixelSession } from '@/editor/pixel/session';
import { importImageFromDisk } from '@/editor/pixel/importFlow';
import { exportWidgetFiles, exportProjectFiles, exportPixelProjectFile } from '@/pixel/exportWidget';
import { hasDirectoryPicker, pickDirectory, writeFileToDirectory, downloadBlob } from '@/core/io/fileSystem';
import { resPrefix, setResPrefix } from '@/editor/pixel/exportPrefs';
import { ZOOM_LEVELS } from '@/pixel/PixelRenderer';
import { MAX_BRUSH } from '@/core/pixel/brush';
import { MAX_CORNER_RADIUS } from '@/core/pixel/types';
import { toast } from '@/editor/toasts';
import Icon from '@/components/Icon.vue';
import ContextMenu, { type MenuItem } from '@/components/ContextMenu.vue';
import type { AdjustKind } from './AdjustDialog.vue';
import {
  faPencil,
  faEraser,
  faFill,
  faEyeDropper,
  faVectorSquare,
  faSlash,
  faCircle,
  faSquareDashed,
  faCircleDashed,
  faLasso,
  faWandMagicSparkles,
  faArrowsUpDownLeftRight,
  faSquareHalfStroke,
  faRotateLeft,
  faRotateRight,
  faFolderOpen,
  faBorderAll,
  faFileExport,
  faBoxesStacked,
  faCopy,
  faScissors,
  faPaste,
  faExpand,
  faCaretDown,
} from '@fortawesome/pro-solid-svg-icons';
import type { PixelToolId } from '@/tools/pixel/types';

const emit = defineEmits<{ 'close-project': []; 'open-adjust': [kind: AdjustKind]; fit: [] }>();

const store = usePixelStore();
const { runner } = usePixelSession();
const busy = ref('');
const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);

type ToolDef = { id: PixelToolId; icon: typeof faPencil; label: string };
const toolGroups: ToolDef[][] = [
  [
    { id: 'move', icon: faArrowsUpDownLeftRight, label: 'Move (V) — drags the selection, or the whole layer. Shift = one axis' },
    { id: 'select', icon: faSquareDashed, label: 'Rectangle select (M) — Shift adds, Alt subtracts' },
    { id: 'select-ellipse', icon: faCircleDashed, label: 'Ellipse select — Shift adds, Alt subtracts' },
    { id: 'lasso', icon: faLasso, label: 'Lasso (L) — Shift adds, Alt subtracts' },
    { id: 'wand', icon: faWandMagicSparkles, label: 'Magic wand (W) — Shift adds, Alt subtracts' },
  ],
  [
    { id: 'pencil', icon: faPencil, label: 'Pencil (B)' },
    { id: 'eraser', icon: faEraser, label: 'Eraser (E)' },
    { id: 'bucket', icon: faFill, label: 'Bucket fill (F)' },
    { id: 'gradient', icon: faSquareHalfStroke, label: 'Gradient (G) — primary → secondary; right-drag reverses, Shift snaps to 45°' },
    { id: 'picker', icon: faEyeDropper, label: 'Colour picker (I)' },
  ],
  [
    { id: 'line', icon: faSlash, label: 'Line' },
    { id: 'rect', icon: faVectorSquare, label: 'Rectangle (U, Shift = square)' },
    { id: 'circle', icon: faCircle, label: 'Ellipse (Shift = circle)' },
  ],
];

const brushPresets = [1, 2, 3, 4, 8, 16];
const showsBrush = computed(() => ['pencil', 'eraser', 'line'].includes(store.toolId));
const showsTolerance = computed(() => ['bucket', 'wand'].includes(store.toolId));
const showsGradient = computed(() => store.toolId === 'gradient');

// runner.canUndo/canRedo read a plain class getter outside Vue's reactivity —
// force these computeds to depend on the version counters the runner bumps
// on every commit/undo/redo, same as the voxel Toolbar's canUndo/canRedo.
const canUndo = computed(() => {
  void store.editVersion;
  void store.activeVersion;
  void store.layersVersion;
  return runner.value?.canUndo ?? false;
});
const canRedo = computed(() => {
  void store.editVersion;
  void store.activeVersion;
  void store.layersVersion;
  return runner.value?.canRedo ?? false;
});
const hasSelection = computed(() => {
  void store.selectionVersion;
  return !!runner.value?.selection;
});
const canPaste = computed(() => {
  void store.selectionVersion;
  void store.editVersion;
  void store.activeVersion;
  return runner.value?.canPaste ?? false;
});

const zoomLabel = (z: number) => (z < 1 ? `${Math.round(z * 100)}%` : `${z}×`);
const zoomOptions = computed(() => (ZOOM_LEVELS.includes(store.zoom) ? ZOOM_LEVELS : [...ZOOM_LEVELS, store.zoom].sort((a, b) => a - b)));

function setCornerRadius(e: Event) {
  const n = Math.round(Number((e.target as HTMLInputElement).value));
  if (Number.isFinite(n)) store.cornerRadius = Math.max(0, Math.min(MAX_CORNER_RADIUS, n));
}

function setBrush(e: Event) {
  const n = Math.round(Number((e.target as HTMLInputElement).value));
  if (Number.isFinite(n)) store.brushSize = Math.max(1, Math.min(MAX_BRUSH, n));
}

function openMenu(e: MouseEvent, items: MenuItem[]) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  menu.value = { x: rect.left, y: rect.bottom + 4, items };
}

function selectMenu(e: MouseEvent) {
  const r = runner.value;
  if (!r) return;
  const hasMask = !!r.activeLayer()?.mask;
  openMenu(e, [
    { label: 'Select all (Ctrl+A)', action: () => r.selectAll() },
    { label: 'Deselect (Ctrl+D)', disabled: !r.selection, action: () => r.setSelection(null) },
    { label: 'Invert selection (Ctrl+Shift+I)', disabled: !r.selection, action: () => r.invertSelection() },
    { separator: true },
    { label: 'Select layer pixels', action: () => r.selectLayerAlpha() },
    { label: 'Select from layer mask', disabled: !hasMask, action: () => r.selectFromMask() },
    { separator: true },
    { label: 'Fill with primary (Alt+Backspace)', action: () => r.fillSelection('primary') },
    { label: 'Fill with secondary (Ctrl+Backspace)', action: () => r.fillSelection('secondary') },
    { label: 'Erase (Delete)', disabled: !r.selection, action: () => r.eraseSelection() },
    { separator: true },
    { label: 'Copy merged (Ctrl+Shift+C)', action: () => r.copySelection(true) },
    { label: 'Paste as new layer (Ctrl+Shift+V)', disabled: !r.canPaste, action: () => r.pasteSelection(true) },
  ]);
}

function imageMenu(e: MouseEvent) {
  const r = runner.value;
  if (!r) return;
  openMenu(e, [
    { label: 'Flip horizontal', action: () => r.transform({ kind: 'flipH' }) },
    { label: 'Flip vertical', action: () => r.transform({ kind: 'flipV' }) },
    { label: 'Rotate 90° clockwise', action: () => r.transform({ kind: 'rotCW' }) },
    { label: 'Rotate 90° counter-clockwise', action: () => r.transform({ kind: 'rotCCW' }) },
    { label: 'Rotate 180°', action: () => r.transform({ kind: 'rot180' }) },
    { label: 'Scale…', action: () => emit('open-adjust', 'scale') },
    { separator: true },
    { label: 'Hue / Saturation… (Ctrl+U)', action: () => emit('open-adjust', 'hsl') },
    { label: 'Brightness / Contrast…', action: () => emit('open-adjust', 'brightnessContrast') },
    { label: 'Replace colour…', action: () => emit('open-adjust', 'replace') },
    { label: 'Posterize…', action: () => emit('open-adjust', 'posterize') },
    { label: 'Invert (Ctrl+I)', action: () => r.adjust({ kind: 'invert' }, 'Invert') },
    { label: 'Desaturate (Ctrl+Shift+U)', action: () => r.adjust({ kind: 'desaturate' }, 'Desaturate') },
    { separator: true },
    { label: 'Import image as layer…', action: () => importImageFromDisk() },
  ]);
}

async function exportActive() {
  const w = store.activeWidget();
  const project = store.project;
  if (!w || !project) return;
  // pick the folder first, before any other work — showDirectoryPicker()
  // needs a fresh user-activation from the click; an intervening await (or,
  // as this used to do, a blocking window.prompt()) can burn through it and
  // make the picker throw, which pickDirectory() then treats the same as a
  // cancel: silently. Asking first keeps the activation as fresh as possible.
  let dir: FileSystemDirectoryHandle | null = null;
  if (hasDirectoryPicker) {
    dir = await pickDirectory();
    if (!dir) return; // picker cancelled (or, previously, silently failed)
  }
  busy.value = 'export';
  store.exportStatus = `Exporting ${w.name}…`;
  try {
    await new Promise((r) => setTimeout(r)); // let the overlay paint first
    const { files: widgetFiles } = await exportWidgetFiles(w, resPrefix.value);
    const files = [exportPixelProjectFile(project), ...widgetFiles];
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
    toast(`Exported ${files.length} file${files.length === 1 ? '' : 's'} for "${w.name}"`, 'success');
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, 'error');
  } finally {
    busy.value = '';
    store.exportStatus = null;
  }
}

async function exportAll() {
  if (!store.project) return;
  const project = store.project;

  // pick the folder first — see the comment in exportActive()
  let dir: FileSystemDirectoryHandle | null = null;
  if (hasDirectoryPicker) {
    dir = await pickDirectory();
    if (!dir) return; // picker cancelled
  }

  try {
    busy.value = 'export-all';
    store.exportStatus = 'Preparing export…';
    const files = await exportProjectFiles(project, resPrefix.value, ({ done, total, name }) => {
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
    toast(`Exported ${files.length} files for ${project.widgets.length} widget${project.widgets.length === 1 ? '' : 's'}`, 'success');
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`, 'error');
  } finally {
    busy.value = '';
    store.exportStatus = null;
  }
}
</script>

<template>
  <div class="toolbar">
    <div class="row line">
      <button title="Back to start screen" @click="emit('close-project')">
        <Icon :icon="faFolderOpen" />
      </button>

      <template v-for="(group, gi) in toolGroups" :key="gi">
        <span class="sep" />
        <button
          v-for="t in group"
          :key="t.id"
          class="tool"
          :class="{ active: store.toolId === t.id }"
          :title="t.label"
          @click="store.toolId = t.id"
        >
          <Icon :icon="t.icon" />
        </button>
      </template>

      <span class="sep" />
      <button class="menu-btn" title="Selection commands" @click="selectMenu">Select <Icon :icon="faCaretDown" :size="10" /></button>
      <button class="menu-btn" title="Transform and adjust the active layer (or the selection)" @click="imageMenu">
        Image <Icon :icon="faCaretDown" :size="10" />
      </button>

      <span class="spacer" />

      <button :disabled="!hasSelection" title="Copy selection (Ctrl+C; Ctrl+Shift+C copies all layers merged)" @click="runner?.copySelection()">
        <Icon :icon="faCopy" />
      </button>
      <button :disabled="!hasSelection" title="Cut selection (Ctrl+X)" @click="runner?.cutSelection()">
        <Icon :icon="faScissors" />
      </button>
      <button :disabled="!canPaste" title="Paste (Ctrl+V; Ctrl+Shift+V pastes as a new layer)" @click="runner?.pasteSelection()">
        <Icon :icon="faPaste" />
      </button>

      <span class="sep" />

      <button :disabled="!canUndo" title="Undo (Ctrl+Z)" @click="runner?.undo()">
        <Icon :icon="faRotateLeft" />
      </button>
      <button :disabled="!canRedo" title="Redo (Ctrl+Y)" @click="runner?.redo()">
        <Icon :icon="faRotateRight" />
      </button>

      <span class="sep" />
      <select
        :value="store.zoom"
        title="Zoom (mouse wheel, + / −). Pan with Space+drag or the middle mouse button."
        @change="store.zoom = Number(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="z in zoomOptions" :key="z" :value="z">{{ zoomLabel(z) }}</option>
      </select>
      <button title="Fit to view (Ctrl+0)" @click="emit('fit')">
        <Icon :icon="faExpand" />
      </button>
      <button
        class="tool"
        :class="{ active: store.showGrid }"
        title="Toggle pixel grid (shown from 4× zoom)"
        @click="store.showGrid = !store.showGrid"
      >Grid</button>

      <span class="sep" />
      <input
        type="text"
        class="res-prefix"
        :value="resPrefix"
        title="Godot res:// folder these files will live in — baked into the exported .tres files' texture paths"
        @change="setResPrefix(($event.target as HTMLInputElement).value)"
      />
      <button
        :disabled="!!busy || !store.activeWidgetId"
        title="Export the active widget as PNGs + StyleBoxTexture files, including the editable .voxui project"
        @click="exportActive"
      >
        <Icon :icon="faFileExport" />
      </button>
      <button
        class="primary"
        :disabled="!!busy || store.widgets.length === 0"
        :title="hasDirectoryPicker ? 'Export every widget into a chosen folder, including the editable .voxui project and a combined theme.tres' : 'Download every widget\'s files, including the editable .voxui project and a combined theme.tres'"
        @click="exportAll"
      >
        <Icon :icon="faBoxesStacked" />
      </button>
    </div>

    <div class="row line options">
      <template v-if="showsBrush">
        <label class="lbl">Brush</label>
        <button
          v-for="n in brushPresets"
          :key="n"
          class="brush"
          :class="{ active: store.brushSize === n }"
          :title="`${n}×${n} px`"
          @click="store.brushSize = n"
        >{{ n }}</button>
        <input
          type="number"
          class="num"
          min="1"
          :max="MAX_BRUSH"
          :value="store.brushSize"
          title="Brush size in pixels ([ and ] to step)"
          @change="setBrush"
        />
        <button
          class="tool small"
          :class="{ active: store.brushShape === 'round' }"
          title="Round brush (off = square)"
          @click="store.brushShape = store.brushShape === 'round' ? 'square' : 'round'"
        >Round</button>
      </template>

      <template v-if="store.toolId === 'rect'">
        <button
          class="tool small"
          :class="{ active: store.cornerRadius > 0 }"
          title="Rounded corners"
          @click="store.cornerRadius = store.cornerRadius > 0 ? 0 : 4"
        >Rounded corners</button>
        <template v-if="store.cornerRadius > 0">
          <input
            v-model.number="store.cornerRadius"
            type="range"
            min="1"
            :max="MAX_CORNER_RADIUS"
            class="range"
            title="Corner radius in pixels"
          />
          <input
            type="number"
            class="num"
            min="1"
            :max="MAX_CORNER_RADIUS"
            :value="store.cornerRadius"
            title="Corner radius in pixels (1–32)"
            @change="setCornerRadius"
          />
          <span class="val">px</span>
        </template>
      </template>

      <template v-if="showsTolerance">
        <label class="lbl">Tolerance</label>
        <input v-model.number="store.tolerance" type="range" min="0" max="128" class="range" title="How different a colour may be and still count as a match" />
        <span class="val">{{ store.tolerance }}</span>
        <button
          class="tool small"
          :class="{ active: store.contiguous }"
          title="Only the connected region (off = every matching pixel on the layer)"
          @click="store.contiguous = !store.contiguous"
        >
          <Icon :icon="faBorderAll" :size="11" /> Contiguous
        </button>
      </template>

      <template v-if="showsGradient">
        <label class="lbl">Gradient</label>
        <select v-model="store.gradientKind">
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
        </select>
        <select v-model="store.gradientStyle">
          <option value="smooth">Smooth</option>
          <option value="dither">Dithered (2 colours)</option>
        </select>
      </template>

      <template v-if="store.toolId === 'move'">
        <span class="hint">Drag to move the selection's pixels — or the whole layer when nothing is selected. Arrow keys nudge (Shift = 10 px).</span>
      </template>
      <template v-if="['select', 'select-ellipse', 'lasso', 'wand'].includes(store.toolId)">
        <span class="hint">Shift = add · Alt = subtract · Shift+Alt = intersect · painting stays inside the selection</span>
      </template>

      <span class="spacer" />
      <span v-if="runner?.editingMask" class="mask-badge" title="Painting on the layer mask">Editing mask</span>
    </div>

    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menu.items" @close="menu = null" />
  </div>
</template>

<style scoped>
.toolbar {
  border-bottom: 1px solid var(--line);
  background: var(--surface-1);
}
.line {
  padding: 5px 10px;
  gap: 5px;
  flex-wrap: wrap;
}
.options {
  min-height: 34px;
  padding-top: 0;
  font-size: 12px;
}
/* the plain `button` rule in style.css doesn't centre its content (no
   display:flex) — fine for a single line of text, which browsers centre by
   default, but an <Icon> svg inside sits off-centre without it */
.toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
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
.tool.small {
  padding: 3px 8px;
  font-size: 12px;
}
.brush {
  width: 26px;
  padding: 3px 0;
  font-size: 12px;
}
.num {
  width: 52px;
  padding: 3px 5px;
  font-size: 12px;
}
.range {
  width: 120px;
}
.val {
  width: 26px;
  color: var(--text-dim);
}
.menu-btn {
  padding: 4px 9px;
  font-size: 12px;
}
.hint {
  color: var(--text-dim);
  font-size: 11px;
}
.mask-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: #e5484d;
  color: #fff;
  font-size: 11px;
}
.res-prefix {
  width: 130px;
  font-size: 12px;
}
</style>
