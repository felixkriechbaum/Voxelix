<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import PixelToolbar from './PixelToolbar.vue';
import WidgetList from './WidgetList.vue';
import ColorPanel from './ColorPanel.vue';
import NinePatchPanel from './NinePatchPanel.vue';
import WidgetPreview from './WidgetPreview.vue';
import PixelCanvas from './PixelCanvas.vue';
import { usePixelStore } from '@/stores/pixel';
import { usePixelAutosave } from '@/editor/pixel/autosave';
import { usePixelSession } from '@/editor/pixel/session';
import { previewExpanded, previewWidth, previewResizing } from '@/editor/pixel/previewPrefs';

const previewColWidth = computed(() => (previewExpanded.value ? `${previewWidth.value}px` : '42px'));

const store = usePixelStore();
const { runner } = usePixelSession();
const { flushAutosave } = usePixelAutosave();

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

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    runner.value?.undo();
  } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault();
    runner.value?.redo();
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div
    class="editor"
    :style="{
      gridTemplateColumns: `260px 1fr ${previewColWidth}`,
      transition: previewResizing ? 'none' : 'grid-template-columns 0.15s ease',
    }"
    @contextmenu="onContextMenu"
  >
    <PixelToolbar class="toolbar" @close-project="closeProject" />
    <aside class="side">
      <WidgetList />
      <ColorPanel />
      <NinePatchPanel />
    </aside>
    <main class="stage">
      <PixelCanvas />
    </main>
    <WidgetPreview class="preview" />
    <div class="status row">
      <span>{{ store.projectName }}</span>
      <span class="spacer" />
      <span v-if="store.autosaveError" class="err">autosave failed</span>
      <span v-else-if="store.autosaveBusy">saving…</span>
      <span v-else-if="store.autosaveAt">saved</span>
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
  overflow: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--surface-0);
  border-right: 1px solid var(--line);
}
.stage {
  grid-area: stage;
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
</style>
