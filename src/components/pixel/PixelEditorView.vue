<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PixelToolbar from './PixelToolbar.vue';
import WidgetList from './WidgetList.vue';
import LayersPanel from './LayersPanel.vue';
import AdjustDialog, { type AdjustKind } from './AdjustDialog.vue';
import ColorPanel from './ColorPanel.vue';
import NinePatchPanel from './NinePatchPanel.vue';
import WidgetPreview from './WidgetPreview.vue';
import PixelCanvas from './PixelCanvas.vue';
import Icon from '@/components/Icon.vue';
import { faChevronLeft, faChevronRight } from '@fortawesome/pro-solid-svg-icons';
import { usePixelStore } from '@/stores/pixel';
import { usePixelAutosave } from '@/editor/pixel/autosave';
import { usePixelSession } from '@/editor/pixel/session';
import { previewExpanded, previewWidth, previewResizing } from '@/editor/pixel/previewPrefs';
import { sideExpanded, sideWidth, sideResizing, setSideWidth } from '@/editor/pixel/sidePrefs';
import { nextZoom } from '@/pixel/PixelRenderer';
import { MAX_BRUSH } from '@/core/pixel/brush';
import type { PixelToolId } from '@/tools/pixel/types';

const NUDGE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const previewColWidth = computed(() => (previewExpanded.value ? `${previewWidth.value}px` : '42px'));
const sideColWidth = computed(() => (sideExpanded.value ? `${sideWidth.value}px` : '42px'));
const anyResizing = computed(() => previewResizing.value || sideResizing.value);

const store = usePixelStore();
const { runner } = usePixelSession();
const { flushAutosave } = usePixelAutosave();
const canvasRef = ref<InstanceType<typeof PixelCanvas> | null>(null);
/** open adjustment / scale dialog, if any */
const adjustKind = ref<AdjustKind | null>(null);
// switching widget / part / state ends any live preview (the runner reverts it) — close the dialog with it
watch(
  () => [store.activeWidgetId, store.activeElementId, store.activeStateId],
  () => (adjustKind.value = null),
);

let sideDragStartX = 0;
let sideDragStartWidth = 0;
function onSideHandleDown(e: PointerEvent) {
  sideDragStartX = e.clientX;
  sideDragStartWidth = sideWidth.value;
  sideResizing.value = true;
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', onSideHandleMove);
  window.addEventListener('pointerup', onSideHandleUp);
}
function onSideHandleMove(e: PointerEvent) {
  // the side panel sits on the left, so dragging its right edge rightward grows it
  setSideWidth(sideDragStartWidth + (e.clientX - sideDragStartX));
}
function onSideHandleUp() {
  sideResizing.value = false;
  document.body.style.userSelect = '';
  window.removeEventListener('pointermove', onSideHandleMove);
  window.removeEventListener('pointerup', onSideHandleUp);
}
onBeforeUnmount(onSideHandleUp);

async function closeProject() {
  await flushAutosave();
  store.closeProject();
}

/** Right-click is the secondary-colour gesture here, same reasoning as the voxel editor. */
function onContextMenu(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
}

const TOOL_KEYS: Record<string, PixelToolId> = {
  b: 'pencil',
  e: 'eraser',
  f: 'bucket',
  i: 'picker',
  v: 'move',
  m: 'select',
  l: 'lasso',
  w: 'wand',
  g: 'gradient',
  u: 'rect',
};

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  // an open adjustment dialog owns the keyboard (it handles Enter / Escape itself)
  if (adjustKind.value || store.exportStatus) return;
  const r = runner.value;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && !e.shiftKey && key === 'z') {
    e.preventDefault();
    r?.undo();
  } else if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) {
    e.preventDefault();
    r?.redo();
  } else if (mod && key === 'c') {
    if (r && (r.selection || e.shiftKey)) {
      e.preventDefault();
      r.copySelection(e.shiftKey);
    }
  } else if (mod && !e.shiftKey && key === 'x') {
    if (r?.selection) {
      e.preventDefault();
      r.cutSelection();
    }
  } else if (mod && e.shiftKey && key === 'v') {
    // plain Ctrl+V is handled by the canvas's paste listener (system clipboard images vs. in-app pixels)
    if (r?.canPaste) {
      e.preventDefault();
      r.pasteSelection(true);
    }
  } else if (mod && !e.shiftKey && key === 'a') {
    e.preventDefault();
    r?.selectAll();
  } else if (mod && !e.shiftKey && key === 'd') {
    e.preventDefault();
    r?.setSelection(null);
  } else if (mod && e.shiftKey && key === 'i') {
    e.preventDefault();
    r?.invertSelection();
  } else if (mod && !e.shiftKey && key === 'i') {
    e.preventDefault();
    r?.adjust({ kind: 'invert' }, 'Invert');
  } else if (mod && e.shiftKey && key === 'u') {
    e.preventDefault();
    r?.adjust({ kind: 'desaturate' }, 'Desaturate');
  } else if (mod && !e.shiftKey && key === 'u') {
    e.preventDefault();
    adjustKind.value = 'hsl';
  } else if (mod && e.shiftKey && key === 'n') {
    e.preventDefault();
    r?.addLayer();
  } else if (mod && !e.shiftKey && key === 'j') {
    e.preventDefault();
    const l = r?.activeLayer();
    if (l) r?.duplicateLayer(l.id);
  } else if (mod && !e.shiftKey && key === 'e') {
    e.preventDefault();
    const l = r?.activeLayer();
    if (l) r?.mergeDown(l.id);
  } else if (mod && (key === '0' || key === '1')) {
    e.preventDefault();
    if (key === '0') canvasRef.value?.fitView();
    else store.zoom = 1;
  } else if (!mod && (e.key === '+' || e.key === '=')) {
    store.zoom = nextZoom(store.zoom, 1);
  } else if (!mod && (e.key === '-' || e.key === '_')) {
    store.zoom = nextZoom(store.zoom, -1);
  } else if (!mod && (e.key === '[' || e.key === ']')) {
    const s = store.brushSize;
    const step = s >= 16 ? 4 : s >= 8 ? 2 : 1;
    store.brushSize = Math.max(1, Math.min(MAX_BRUSH, e.key === ']' ? s + step : s - step));
  } else if (NUDGE_KEYS[e.key] && !mod) {
    e.preventDefault();
    const [dx, dy] = NUDGE_KEYS[e.key];
    const n = e.shiftKey ? 10 : 1;
    r?.moveSelection(dx * n, dy * n);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && (e.altKey || mod)) {
    e.preventDefault();
    r?.fillSelection(e.altKey ? 'primary' : 'secondary');
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (r?.selection) {
      e.preventDefault();
      r.eraseSelection();
    }
  } else if (e.key === 'Escape') {
    if (r?.selection) r.setSelection(null);
  } else if (!mod && !e.altKey && key === 'x') {
    const p = store.primaryColor;
    store.setPrimary(store.secondaryColor);
    store.setSecondary(p);
  } else if (!mod && !e.altKey && !e.shiftKey && TOOL_KEYS[key]) {
    store.toolId = TOOL_KEYS[key];
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div
    class="editor"
    :style="{
      gridTemplateColumns: `${sideColWidth} 1fr ${previewColWidth}`,
      transition: anyResizing ? 'none' : 'grid-template-columns 0.15s ease',
    }"
    :aria-busy="!!store.exportStatus"
    @contextmenu="onContextMenu"
  >
    <PixelToolbar
      class="toolbar"
      :inert="!!store.exportStatus"
      @close-project="closeProject"
      @open-adjust="adjustKind = $event"
      @fit="canvasRef?.fitView()"
    />
    <aside class="side" :class="{ collapsed: !sideExpanded }" :inert="!!store.exportStatus">
      <div v-if="sideExpanded" class="side-body">
        <WidgetList />
        <LayersPanel />
        <ColorPanel />
        <NinePatchPanel />
      </div>
      <button
        class="toggle"
        :title="sideExpanded ? 'Collapse side panel' : 'Expand side panel'"
        @click="sideExpanded = !sideExpanded"
      >
        <Icon :icon="sideExpanded ? faChevronLeft : faChevronRight" :size="12" />
      </button>
      <div v-if="sideExpanded" class="handle" title="Drag to resize" @pointerdown="onSideHandleDown" />
    </aside>
    <main class="stage" :inert="!!store.exportStatus">
      <PixelCanvas ref="canvasRef" />
      <AdjustDialog v-if="adjustKind" :key="adjustKind" :kind="adjustKind" @close="adjustKind = null" />
    </main>
    <WidgetPreview class="preview" :inert="!!store.exportStatus" />
    <div class="status row">
      <span>{{ store.projectName }}</span>
      <span class="spacer" />
      <span v-if="store.autosaveError" class="err">autosave failed</span>
      <span v-else-if="store.autosaveBusy">saving…</span>
      <span v-else-if="store.autosaveAt">saved</span>
    </div>

    <div v-if="store.exportStatus" class="export-overlay" role="dialog" aria-modal="true" aria-label="Export in progress">
      <div class="panel export-card" role="status" aria-live="polite">
        <span class="spinner" />
        <span>{{ store.exportStatus }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor {
  height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    'toolbar toolbar toolbar'
    'side stage preview'
    'status status status';
}
.toolbar {
  grid-area: toolbar;
}
.side {
  grid-area: side;
  position: relative;
  overflow: hidden;
  display: flex;
  background: var(--surface-0);
  border-right: 1px solid var(--line);
}
.side.collapsed {
  align-items: flex-start;
}
.side-body {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.side .toggle {
  flex: none;
  height: 32px;
  width: 24px;
  padding: 0;
  margin: 8px 5px;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.side .handle {
  position: absolute;
  right: -3px;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: col-resize;
  z-index: 1;
  touch-action: none;
}
.side .handle:hover,
.side .handle:active {
  background: var(--accent-soft);
}
.stage {
  grid-area: stage;
  position: relative;
  min-width: 0;
  min-height: 0;
}
.preview {
  grid-area: preview;
  min-width: 0;
  min-height: 0;
}
.status {
  grid-area: status;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-dim);
  border-top: 1px solid var(--line);
  background: var(--surface-1);
}
.err {
  color: var(--warn);
}
.export-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: var(--scrim);
}
.export-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 20px;
  font-size: 13px;
  box-shadow: var(--shadow);
}
.spinner {
  width: 15px;
  height: 15px;
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
