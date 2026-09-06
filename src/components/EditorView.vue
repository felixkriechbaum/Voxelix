<script setup lang="ts">
import { ref } from 'vue';
import Toolbar from './Toolbar.vue';
import Outliner from './Outliner.vue';
import PalettePanel from './PalettePanel.vue';
import ViewportCanvas from './ViewportCanvas.vue';
import ShapeDialog from './ShapeDialog.vue';
import { useAutosave } from '@/editor/autosave';

const showShape = ref(false);

useAutosave();
</script>

<template>
  <div class="editor">
    <Toolbar class="toolbar" @add-shape="showShape = true" />
    <aside class="side">
      <Outliner />
      <PalettePanel />
    </aside>
    <main class="stage">
      <ViewportCanvas />
    </main>
    <ShapeDialog v-if="showShape" @close="showShape = false" />
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
</style>
