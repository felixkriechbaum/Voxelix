<script setup lang="ts">
import { nextTick, onMounted, ref, type ComponentPublicInstance } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { usePixelStore } from '@/stores/pixel';
import { deserializeProject } from '@/core/io/projectFile';
import { deserializePixelProject } from '@/core/pixel/pixelProjectFile';
import { openTextFile } from '@/core/io/fileSystem';
import { Project } from '@/core/project/Project';
import { PixelProject } from '@/core/pixel/PixelProject';
import { PROJECT_FILE_EXT } from '@/core/project/types';
import { PIXEL_FILE_EXT } from '@/core/pixel/types';
import { specFor, widgetTypesByCategory } from '@/core/pixel/widgets';
import type { WidgetType } from '@/core/pixel/types';
import {
  deleteProjectRecord,
  getProjectRecord,
  isProjectStoreAvailable,
  listProjectMeta,
  touchProjectRecord,
  deletePixelProjectRecord,
  getPixelProjectRecord,
  listPixelProjectMeta,
  touchPixelProjectRecord,
  type ProjectMeta,
  type PixelProjectMeta,
} from '@/core/io/projectStore';

const store = useEditorStore();
const pixelStore = usePixelStore();

const tab = ref<'voxel' | 'pixel'>('voxel');
const iconUrl = `${import.meta.env.BASE_URL}icon.png`;

// ---- voxel tab ------------------------------------------------------------
const name = ref('Placeables');
const error = ref('');
const recent = ref<ProjectMeta[]>([]);
const pendingDeleteId = ref<string | null>(null);
const deleteConfirm = ref<HTMLDivElement | null>(null);

// ---- pixel tab --------------------------------------------------------
const pixelName = ref('UI Kit');
const pixelWidgetType = ref<WidgetType>('button');
const pixelError = ref('');
const pixelRecent = ref<PixelProjectMeta[]>([]);
const pixelPendingDeleteId = ref<string | null>(null);
const pixelDeleteConfirm = ref<HTMLDivElement | null>(null);

onMounted(() => {
  void refreshRecent();
  void refreshPixelRecent();
  try {
    if (localStorage.getItem('voxelix.lastWorkspace') === 'pixel') tab.value = 'pixel';
  } catch {
    /* private mode */
  }
});

function setDeleteConfirm(el: Element | ComponentPublicInstance | null) {
  deleteConfirm.value = el instanceof HTMLDivElement ? el : null;
}
function setPixelDeleteConfirm(el: Element | ComponentPublicInstance | null) {
  pixelDeleteConfirm.value = el instanceof HTMLDivElement ? el : null;
}

async function requestRemove(id: string) {
  pendingDeleteId.value = id;
  await nextTick();
  deleteConfirm.value?.querySelector<HTMLButtonElement>('button')?.focus();
}
async function requestPixelRemove(id: string) {
  pixelPendingDeleteId.value = id;
  await nextTick();
  pixelDeleteConfirm.value?.querySelector<HTMLButtonElement>('button')?.focus();
}

async function refreshRecent() {
  if (!isProjectStoreAvailable()) return;
  try {
    recent.value = await listProjectMeta();
  } catch {
    /* private mode / storage disabled — no recents, no error */
  }
}
async function refreshPixelRecent() {
  if (!isProjectStoreAvailable()) return;
  try {
    pixelRecent.value = await listPixelProjectMeta();
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
  pendingDeleteId.value = null;
  recent.value = recent.value.filter((r) => r.id !== id);
  try {
    await deleteProjectRecord(id);
  } catch {
    await refreshRecent();
  }
}

// ---- pixel actions ------------------------------------------------------
function createPixel() {
  pixelStore.newProject(pixelName.value.trim() || 'Untitled UI', pixelWidgetType.value);
}

async function openPixel() {
  pixelError.value = '';
  const file = await openTextFile([PIXEL_FILE_EXT, '.json']);
  if (!file) return;
  try {
    const project = deserializePixelProject(file.text);
    pixelStore.setProject(project);
  } catch (e) {
    pixelError.value = (e as Error).message;
  }
}

async function openPixelRecent(id: string) {
  pixelError.value = '';
  try {
    const record = await getPixelProjectRecord(id);
    if (!record) {
      await refreshPixelRecent();
      return;
    }
    pixelStore.setProject(PixelProject.fromJSON(record.json));
    void touchPixelProjectRecord(id);
  } catch (e) {
    pixelError.value = `Could not open project: ${(e as Error).message}`;
  }
}

async function removePixelRecent(id: string) {
  pixelPendingDeleteId.value = null;
  pixelRecent.value = pixelRecent.value.filter((r) => r.id !== id);
  try {
    await deletePixelProjectRecord(id);
  } catch {
    await refreshPixelRecent();
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
        <img :src="iconUrl" alt="" width="40" height="40" />
        <h1>Voxelix</h1>
      </div>

      <div class="tabs row" role="tablist">
        <button
          role="tab"
          :aria-selected="tab === 'voxel'"
          :class="{ active: tab === 'voxel' }"
          @click="tab = 'voxel'"
        >Voxel</button>
        <button
          role="tab"
          :aria-selected="tab === 'pixel'"
          :class="{ active: tab === 'pixel' }"
          @click="tab = 'pixel'"
        >Pixel UI</button>
      </div>

      <template v-if="tab === 'voxel'">
        <p class="sub">Fast voxel modelling with per-object <code>.glb</code> export.</p>

        <label for="project-name">Project name</label>
        <input id="project-name" v-model="name" type="text" autocomplete="off" @keydown.enter="create" />

        <div class="row" style="margin-top: 14px">
          <button class="primary" title="Start a fresh project" @click="create">New project</button>
          <button :title="`Open an existing ${PROJECT_FILE_EXT} file`" @click="open">
            Open file
          </button>
        </div>
        <p v-if="error" class="err" role="alert">{{ error }}</p>

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
              <div
                v-if="pendingDeleteId === r.id"
                :ref="setDeleteConfirm"
                class="confirm-delete"
                role="group"
                :aria-label="`Delete ${r.name} locally?`"
              >
                <button @click="pendingDeleteId = null">Cancel</button>
                <button class="danger" @click="removeRecent(r.id)">Delete</button>
              </div>
              <button
                v-else
                class="del"
                title="Delete this local project"
                :aria-label="`Delete ${r.name} locally`"
                @click="requestRemove(r.id)"
              >×</button>
            </li>
          </ul>
        </template>
      </template>

      <template v-else>
        <p class="sub">Pixel-art UI widgets with nine-patch preview and Godot export.</p>

        <label for="pixel-name">Project name</label>
        <input id="pixel-name" v-model="pixelName" type="text" autocomplete="off" @keydown.enter="createPixel" />

        <label for="pixel-type" style="margin-top: 8px">Widget</label>
        <select id="pixel-type" v-model="pixelWidgetType">
          <optgroup v-for="g in widgetTypesByCategory()" :key="g.category" :label="g.category">
            <option v-for="t in g.types" :key="t" :value="t">{{ specFor(t).label }}</option>
          </optgroup>
        </select>

        <div class="row" style="margin-top: 14px">
          <button class="primary" title="Start a fresh pixel UI project" @click="createPixel">New project</button>
          <button :title="`Open an existing ${PIXEL_FILE_EXT} file`" @click="openPixel">
            Open file
          </button>
        </div>
        <p v-if="pixelError" class="err" role="alert">{{ pixelError }}</p>

        <template v-if="pixelRecent.length">
          <label class="recent-label">Recent</label>
          <ul class="recent">
            <li v-for="r in pixelRecent" :key="r.id">
              <button class="entry" @click="openPixelRecent(r.id)">
                <img v-if="r.thumbnail" class="thumb" :src="r.thumbnail" alt="" />
                <span v-else class="thumb ph" aria-hidden="true" />
                <span class="info">
                  <span class="rname">{{ r.name }}</span>
                  <span class="meta">
                    {{ r.widgetCount }} {{ r.widgetCount === 1 ? 'widget' : 'widgets' }} ·
                    {{ ago(r.updatedAt) }}
                  </span>
                </span>
              </button>
              <div
                v-if="pixelPendingDeleteId === r.id"
                :ref="setPixelDeleteConfirm"
                class="confirm-delete"
                role="group"
                :aria-label="`Delete ${r.name} locally?`"
              >
                <button @click="pixelPendingDeleteId = null">Cancel</button>
                <button class="danger" @click="removePixelRecent(r.id)">Delete</button>
              </div>
              <button
                v-else
                class="del"
                title="Delete this local project"
                :aria-label="`Delete ${r.name} locally`"
                @click="requestPixelRemove(r.id)"
              >×</button>
            </li>
          </ul>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.start {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 12px;
  overflow: auto;
}
.card {
  width: min(380px, 100%);
  max-height: calc(100vh - 24px);
  overflow: auto;
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
.tabs {
  gap: 0;
  margin: 14px 0 16px;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  flex: 1;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  padding: 8px 0;
}
.tabs button.active {
  border-bottom-color: var(--accent);
  color: var(--ink);
  font-weight: 600;
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
select {
  width: 100%;
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
.confirm-delete {
  display: flex;
  align-items: stretch;
  gap: 4px;
}
.confirm-delete button {
  padding: 4px 7px;
  font-size: 11px;
}
</style>
