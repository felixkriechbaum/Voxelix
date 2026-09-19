<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Toolbar from './Toolbar.vue';
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
  <div class="editor" :aria-busy="!!store.exportStatus" @contextmenu="onContextMenu">
    <Toolbar
      class="toolbar"
      :inert="!!store.exportStatus"
      @add-shape="showShape = true"
      @settings="showSettings = true"
      @close-project="closeProject"
    />
    <aside class="side" :inert="!!store.exportStatus">
      <Outliner />
      <PalettePanel />
      <SupportLink />
    </aside>
    <main class="stage" :inert="!!store.exportStatus">
      <ViewportCanvas />
    </main>

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
  grid-template-columns: 264px 1fr;
  grid-template-rows: auto 1fr;
  gap: 8px;
  padding: 8px;
}
.toolbar {
  grid-column: 1 / 3;
}
.side {
  grid-row: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
}
.stage {
  grid-row: 2;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--line);
}

@media (max-width: 720px) {
  .editor {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(180px, 34vh) minmax(320px, 1fr);
    overflow: auto;
    padding: 6px;
    gap: 6px;
  }
  .toolbar {
    grid-column: 1;
  }
  .side {
    grid-row: 2;
  }
  .stage {
    grid-row: 3;
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
