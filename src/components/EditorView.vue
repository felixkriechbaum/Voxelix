<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Toolbar from './Toolbar.vue';
import ToolRail from './ToolRail.vue';
import Outliner from './Outliner.vue';
import PalettePanel from './PalettePanel.vue';
import ViewportCanvas from './ViewportCanvas.vue';
import SupportLink from './SupportLink.vue';
import ShapeDialog from './ShapeDialog.vue';
import SettingsDialog from './SettingsDialog.vue';
import Toasts from './Toasts.vue';
import { useEditorStore } from '@/stores/editor';
import { useAutosave } from '@/editor/autosave';
import { useProjectSave } from '@/editor/save';

const store = useEditorStore();
const showShape = ref(false);
const showSettings = ref(false);
const { saveProject } = useProjectSave();

const { flushAutosave } = useAutosave();

// ---- resizable right sidebar -------------------------------------------------
const SIDE_KEY = 'voxelix.voxelSide';
const SIDE_MIN = 240;
const SIDE_MAX = 560;
const SIDE_DEFAULT = 280;
const clampSide = (w: number) => Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(w)));
function loadSide(): number {
  try {
    const w = Number(localStorage.getItem(SIDE_KEY));
    if (w) return clampSide(w);
  } catch {
    /* private mode */
  }
  return SIDE_DEFAULT;
}
const sideWidth = ref(loadSide());
watch(sideWidth, (w) => {
  try {
    localStorage.setItem(SIDE_KEY, String(w));
  } catch {
    /* private mode */
  }
});

const resizing = ref(false);
let dragStartX = 0;
let dragStartWidth = 0;
function onHandleDown(e: PointerEvent) {
  dragStartX = e.clientX;
  dragStartWidth = sideWidth.value;
  resizing.value = true;
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', onHandleMove);
  window.addEventListener('pointerup', onHandleUp);
}
function onHandleMove(e: PointerEvent) {
  // the sidebar sits on the right, so dragging its left edge leftward grows it
  sideWidth.value = clampSide(dragStartWidth - (e.clientX - dragStartX));
}
function onHandleUp() {
  resizing.value = false;
  document.body.style.userSelect = '';
  window.removeEventListener('pointermove', onHandleMove);
  window.removeEventListener('pointerup', onHandleUp);
}
function onHandleKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 64 : 16;
  if (e.key === 'ArrowLeft') sideWidth.value = clampSide(sideWidth.value + step);
  else if (e.key === 'ArrowRight') sideWidth.value = clampSide(sideWidth.value - step);
  else if (e.key === 'Home') sideWidth.value = SIDE_MIN;
  else if (e.key === 'End') sideWidth.value = SIDE_MAX;
  else return;
  e.preventDefault();
}
onBeforeUnmount(onHandleUp);

async function closeProject() {
  await flushAutosave();
  store.closeProject();
}

/**
 * Right-click is a modelling gesture here, and the app's own menus are rendered
 * on top — so the browser menu is suppressed across the whole editor, not just
 * on the canvas. Text fields keep theirs, where copy/paste is worth having.
 */
function onContextMenu(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
}

function onKey(e: KeyboardEvent) {
  if (store.exportStatus) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault(); // don't let the browser offer to save the page
    void saveProject();
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div
    class="editor"
    :class="{ resizing }"
    :style="{ '--side-width': `${sideWidth}px` }"
    :aria-busy="!!store.exportStatus"
    @contextmenu="onContextMenu"
  >
    <Toolbar
      class="toolbar"
      :inert="!!store.exportStatus"
      @settings="showSettings = true"
      @close-project="closeProject"
    />
    <ToolRail class="rail" :inert="!!store.exportStatus" @add-shape="showShape = true" />
    <main class="stage" :inert="!!store.exportStatus">
      <ViewportCanvas />
    </main>
    <div
      class="side-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      :aria-valuenow="sideWidth"
      :aria-valuemin="SIDE_MIN"
      :aria-valuemax="SIDE_MAX"
      tabindex="0"
      title="Drag to resize the sidebar — double-click to reset"
      @pointerdown="onHandleDown"
      @dblclick="sideWidth = SIDE_DEFAULT"
      @keydown="onHandleKey"
    />
    <aside class="side" :inert="!!store.exportStatus">
      <Outliner />
      <PalettePanel />
      <SupportLink />
    </aside>

    <ShapeDialog v-if="showShape" @close="showShape = false" />
    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
    <Toasts />

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
  grid-template-columns: auto minmax(0, 1fr) var(--side-width, 280px);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas:
    'top top top'
    'rail stage side';
  gap: 6px;
  padding: 6px;
}
.toolbar {
  grid-area: top;
}
.rail {
  grid-area: rail;
}
.stage {
  grid-area: stage;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--line);
}
.side-handle {
  /* sits in the grid gap left of the sidebar — its own element, so the
     sidebar's scroll container can't clip it */
  grid-area: side;
  justify-self: start;
  align-self: stretch;
  width: 6px;
  margin-left: -6px;
  z-index: 2;
  cursor: col-resize;
  touch-action: none;
  border-radius: 3px;
}
.side-handle:hover {
  background: var(--accent-soft);
}
.editor.resizing .side-handle,
.side-handle:focus-visible {
  outline: none;
  background: color-mix(in srgb, var(--accent) 55%, transparent);
}
.editor.resizing {
  cursor: col-resize;
}
.side {
  grid-area: side;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 720px) {
  .editor {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(360px, 70vh) auto;
    grid-template-areas: 'top' 'rail' 'stage' 'side';
    overflow: auto;
  }
  .side {
    overflow: visible;
  }
  .side-handle {
    display: none;
  }
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
