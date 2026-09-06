<script setup lang="ts">
import { ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { deserializeProject } from '@/core/io/projectFile';
import { openTextFile } from '@/core/io/fileSystem';
import { PROJECT_FILE_EXT } from '@/core/project/types';

const store = useEditorStore();
const name = ref('Placeables');
const error = ref('');

function create() {
  store.newProject(name.value.trim() || 'Untitled');
}

async function open() {
  error.value = '';
  const file = await openTextFile([PROJECT_FILE_EXT, '.json']);
  if (!file) return;
  try {
    const project = deserializeProject(file.text);
    store.setProject(project, file.handle);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="start">
    <div class="card panel">
      <h1>Voxel Editor</h1>
      <p class="sub">Fast voxel modelling with per-object <code>.glb</code> export.</p>

      <label>Project name</label>
      <input v-model="name" type="text" @keydown.enter="create" />

      <div class="row" style="margin-top: 14px">
        <button class="primary" @click="create">New project</button>
        <button @click="open">Open {{ PROJECT_FILE_EXT }}…</button>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.start {
  height: 100%;
  display: grid;
  place-items: center;
}
.card {
  width: 380px;
  padding: 28px;
}
h1 {
  margin: 0 0 4px;
  font-size: 22px;
}
.sub {
  margin: 0 0 20px;
  color: var(--text-dim);
}
label {
  display: block;
  margin-bottom: 4px;
  color: var(--text-dim);
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #0b1220;
  font-weight: 600;
}
.err {
  color: var(--danger);
  margin-top: 10px;
}
code {
  background: var(--bg-elev);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
