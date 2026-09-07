<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { deserializeProject } from '@/core/io/projectFile';
import { openTextFile } from '@/core/io/fileSystem';
import { Project } from '@/core/project/Project';
import { PROJECT_FILE_EXT } from '@/core/project/types';
import {
  deleteProjectRecord,
  getProjectRecord,
  isProjectStoreAvailable,
  listProjectMeta,
  touchProjectRecord,
  type ProjectMeta,
} from '@/core/io/projectStore';

const store = useEditorStore();
const name = ref('Placeables');
const error = ref('');
const recent = ref<ProjectMeta[]>([]);

onMounted(refreshRecent);

async function refreshRecent() {
  if (!isProjectStoreAvailable()) return;
  try {
    recent.value = await listProjectMeta();
  } catch {
    /* private mode / storage disabled — no recents, no error */
  }
}

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

async function openRecent(id: string) {
  error.value = '';
  try {
    const record = await getProjectRecord(id);
    if (!record) {
      await refreshRecent();
      return;
    }
    store.setProject(Project.fromJSON(record.json));
    void touchProjectRecord(id);
  } catch (e) {
    error.value = `Could not open project: ${(e as Error).message}`;
  }
}

async function removeRecent(id: string) {
  recent.value = recent.value.filter((r) => r.id !== id);
  try {
    await deleteProjectRecord(id);
  } catch {
    await refreshRecent();
  }
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(ts).toLocaleDateString();
}
</script>

<template>
  <div class="start">
    <div class="card panel">
      <div class="brand">
        <img src="/icon.png" alt="" width="40" height="40" />
        <h1>Voxelix</h1>
      </div>
      <p class="sub">Fast voxel modelling with per-object <code>.glb</code> export.</p>

      <label>Project name</label>
      <input v-model="name" type="text" @keydown.enter="create" />

      <div class="row" style="margin-top: 14px">
        <button class="primary" title="Start a fresh project" @click="create">New project</button>
        <button :title="`Open an existing ${PROJECT_FILE_EXT} file`" @click="open">
          Open file
        </button>
      </div>
      <p v-if="error" class="err">{{ error }}</p>

      <template v-if="recent.length">
        <label class="recent-label">Recent</label>
        <ul class="recent">
          <li v-for="r in recent" :key="r.id">
            <button class="entry" @click="openRecent(r.id)">
              <img v-if="r.thumbnail" class="thumb" :src="r.thumbnail" alt="" />
              <span v-else class="thumb ph" aria-hidden="true" />
              <span class="info">
                <span class="rname">{{ r.name }}</span>
                <span class="meta">
                  {{ r.objectCount }} {{ r.objectCount === 1 ? 'object' : 'objects' }} ·
                  {{ ago(r.updatedAt) }}
                </span>
              </span>
            </button>
            <button class="del" title="Remove from list" @click="removeRecent(r.id)">×</button>
          </li>
        </ul>
      </template>
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
  box-shadow: var(--shadow);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
h1 {
  margin: 0;
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
.err {
  color: var(--warn);
  margin-top: 10px;
}
code {
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
}
.recent-label {
  margin-top: 20px;
}
.recent {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 210px;
  overflow: auto;
}
.recent li {
  display: flex;
  align-items: stretch;
  gap: 4px;
  margin-bottom: 4px;
}
.entry {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  text-align: left;
  padding: 6px 8px;
  background: var(--bg-elev);
}
.entry:hover {
  border-color: var(--line-strong);
  background: var(--surface-hi);
}
.thumb {
  width: 46px;
  height: 34px;
  flex: none;
  object-fit: cover;
  border-radius: 3px;
  background: var(--bg);
  border: 1px solid var(--border);
}
.thumb.ph {
  background: var(--surface-2);
}
.info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rname {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.meta {
  font-size: 11px;
  color: var(--text-dim);
}
.del {
  width: 30px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
  color: var(--text-dim);
}
.del:hover {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
