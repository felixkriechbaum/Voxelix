<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { Project } from '@/core/project/Project';
import { getProjectRecord } from '@/core/io/projectStore';
import StartScreen from '@/components/StartScreen.vue';
import EditorView from '@/components/EditorView.vue';
import PwaPrompt from '@/components/PwaPrompt.vue';

const store = useEditorStore();
const hasProject = computed(() => !!store.project);
const booting = ref(true);

onMounted(async () => {
  // reopen the project from the last session so a reload doesn't dump you here
  let id: string | null = null;
  try {
    id = localStorage.getItem('voxelix.lastProject');
  } catch {
    /* private mode */
  }
  if (id) {
    try {
      const rec = await getProjectRecord(id);
      if (rec) store.setProject(Project.fromJSON(rec.json));
    } catch {
      /* record gone or storage disabled — fall through to the start screen */
    }
  }
  booting.value = false;
});
</script>

<template>
  <div v-if="booting" class="boot" />
  <StartScreen v-else-if="!hasProject" />
  <EditorView v-else />
  <PwaPrompt />
</template>

<style scoped>
.boot {
  height: 100%;
  background: var(--surface-0);
}
</style>
