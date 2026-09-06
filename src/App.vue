<script setup lang="ts">
import { computed } from 'vue';
import { useEditorStore } from '@/stores/editor';
import StartScreen from '@/components/StartScreen.vue';
import EditorView from '@/components/EditorView.vue';
import PwaPrompt from '@/components/PwaPrompt.vue';

const store = useEditorStore();
const hasProject = computed(() => !!store.project);
</script>

<template>
  <StartScreen v-if="!hasProject" />
  <EditorView v-else />
  <PwaPrompt />
</template>
