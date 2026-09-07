<script setup lang="ts">
import { ref } from 'vue';
import Toolbar from './Toolbar.vue';
import Outliner from './Outliner.vue';
import PalettePanel from './PalettePanel.vue';
import ViewportCanvas from './ViewportCanvas.vue';
import ShapeDialog from './ShapeDialog.vue';
import ExportSettingsDialog from './ExportSettingsDialog.vue';
import { useEditorStore } from '@/stores/editor';
import { useAutosave } from '@/editor/autosave';

const store = useEditorStore();
const showShape = ref(false);
const showExportSettings = ref(false);

useAutosave();
</script>

<template>
  <div class="editor">
    <Toolbar
      class="toolbar"
      @add-shape="showShape = true"
      @export-settings="showExportSettings = true"
    />
    <aside class="side">
      <Outliner />
      <PalettePanel />
    </aside>
    <main class="stage">
      <ViewportCanvas />
    </main>
    <ShapeDialog v-if="showShape" @close="showShape = false" />
    <ExportSettingsDialog v-if="showExportSettings" @close="showExportSettings = false" />

    <div v-if="store.exportStatus" class="export-overlay">
      <div class="panel export-card">
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
  grid-template-columns: 260px 1fr;
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
  min-height: 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
}
.export-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
}
.export-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 22px;
  font-size: 13px;
}
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
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
