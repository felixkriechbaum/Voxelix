<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { usePixelStore } from '@/stores/pixel';
import { Project } from '@/core/project/Project';
import { PixelProject } from '@/core/pixel/PixelProject';
import { getProjectRecord, getPixelProjectRecord } from '@/core/io/projectStore';
import StartScreen from '@/components/StartScreen.vue';
import EditorView from '@/components/EditorView.vue';
import PixelEditorView from '@/components/pixel/PixelEditorView.vue';
import PwaPrompt from '@/components/PwaPrompt.vue';

const store = useEditorStore();
const pixelStore = usePixelStore();
/** whichever workspace currently has a project open; both close to null on 'close' */
const workspace = computed<'voxel' | 'pixel' | null>(() => {
  if (store.project) return 'voxel';
  if (pixelStore.project) return 'pixel';
  return null;
});
const booting = ref(true);

onMounted(async () => {
  // reopen the last-used workspace's project so a reload doesn't dump you here
  let lastWorkspace: string | null = null;
  try {
    lastWorkspace = localStorage.getItem('voxelix.lastWorkspace');
  } catch {
    /* private mode */
  }

  if (lastWorkspace === 'pixel') {
    await reopenPixel();
  } else {
    await reopenVoxel();
  }
  booting.value = false;
});

async function reopenVoxel() {
  let id: string | null = null;
  try {
    id = localStorage.getItem('voxelix.lastProject');
  } catch {
    /* private mode */
  }
  if (!id) return;
  try {
    const rec = await getProjectRecord(id);
    if (rec) store.setProject(Project.fromJSON(rec.json));
  } catch {
    /* record gone or storage disabled — fall through to the start screen */
  }
}

async function reopenPixel() {
  let id: string | null = null;
  try {
    id = localStorage.getItem('voxelix.lastPixelProject');
  } catch {
    /* private mode */
  }
  if (!id) return;
  try {
    const rec = await getPixelProjectRecord(id);
    if (rec) pixelStore.setProject(PixelProject.fromJSON(rec.json));
  } catch {
    /* record gone or storage disabled — fall through to the start screen */
  }
}
</script>

<template>
  <div v-if="booting" class="boot" />
  <StartScreen v-else-if="!workspace" />
  <EditorView v-else-if="workspace === 'voxel'" />
  <PixelEditorView v-else />
  <PwaPrompt />
</template>

<style scoped>
.boot {
  height: 100%;
  background: var(--surface-0);
}
</style>
