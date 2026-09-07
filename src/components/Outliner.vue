<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import { MAX_SIZE } from '@/core/voxel/constants';
import ContextMenu, { type MenuItem } from './ContextMenu.vue';

const store = useEditorStore();
const { runner } = useSession();
const renamingId = ref<string | null>(null);
const renameText = ref('');
const renameInput = ref<HTMLInputElement | null>(null);
const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);

const active = computed(() => store.activeObject());
/** edited in voxels (grid cells / detail) */
const size = ref<[number, number, number]>([16, 16, 16]);
const maxVoxels = computed(() => Math.floor(MAX_SIZE / store.activeDetail));

function startRename(id: string, current: string) {
  renamingId.value = id;
  renameText.value = current;
  nextTick(() => renameInput.value?.select());
}
function commitRename() {
  if (renamingId.value) store.renameObject(renamingId.value, renameText.value);
  renamingId.value = null;
}
function addObject() {
  store.addObject('Object', [16, 16, 16]);
}
function applyResize() {
  const d = store.activeDetail;
  const s = size.value.map((n) =>
    Math.max(1, Math.min(MAX_SIZE, Math.round(n) * d)),
  ) as [number, number, number];
  store.resizeActive(s);
}

function openMenu(e: MouseEvent, id: string, name: string, kind: string) {
  store.setActive(id);
  const items: MenuItem[] = [
    { label: 'Rename', action: () => startRename(id, name) },
    { label: 'Duplicate', action: () => store.duplicateObject(id) },
    { label: 'Extend', action: () => store.extendObject(id) },
  ];
  if (kind === 'extend') {
    items.push({ label: 'Reset extend to base', danger: true, action: () => runner.value?.resetOverlay() });
  }
  items.push({ separator: true }, { label: 'Delete', danger: true, action: () => store.removeObject(id) });
  menu.value = { x: e.clientX, y: e.clientY, items };
}

function syncSize() {
  const a = active.value;
  if (!a) return;
  const d = store.activeDetail;
  size.value = [a.data.sizeX / d, a.data.sizeY / d, a.data.sizeZ / d].map(Math.round) as [
    number,
    number,
    number,
  ];
}
syncSize();
watch(() => [store.activeVersion, store.structureVersion], syncSize);
</script>

<template>
  <div class="panel outliner">
    <div class="row">
      <h3>Objects</h3>
      <span class="spacer" />
      <button title="Add a new object" aria-label="Add object" @click="addObject">+</button>
    </div>

    <ul class="list">
      <li
        v-for="o in store.objects"
        :key="o.id"
        :class="{ sel: o.id === store.activeObjectId }"
        title="Click to select · double-click to rename · right-click for more"
        @click="store.setActive(o.id)"
        @dblclick="startRename(o.id, o.name)"
        @contextmenu.prevent="openMenu($event, o.id, o.name, o.kind)"
      >
        <input
          v-if="renamingId === o.id"
          ref="renameInput"
          v-model="renameText"
          type="text"
          @keydown.enter="commitRename"
          @keydown.esc="renamingId = null"
          @blur="commitRename"
          @click.stop
        />
        <template v-else>
          <span class="oname">{{ o.name }}</span>
          <span v-if="o.kind === 'extend'" class="tag" title="linked overlay of its base">ext</span>
        </template>
      </li>
    </ul>

    <div class="row actions">
      <button
        :disabled="!store.activeObjectId"
        title="Make an independent copy of this object"
        @click="store.duplicateObject(store.activeObjectId!)"
      >
        Duplicate
      </button>
      <button
        :disabled="!store.activeObjectId"
        title="Add a linked overlay that edits on top of this object without changing it"
        @click="store.extendObject(store.activeObjectId!)"
      >
        Extend
      </button>
      <button
        :disabled="!store.activeObjectId"
        class="danger"
        title="Delete this object"
        @click="store.removeObject(store.activeObjectId!)"
      >
        Delete
      </button>
    </div>

    <template v-if="active">
      <h3 style="margin-top: 12px">
        Size in voxels (max {{ maxVoxels }})
        <span v-if="active.kind === 'extend'" class="hint">— overlay grid</span>
      </h3>
      <div class="row">
        <input v-model.number="size[0]" type="number" min="1" :max="maxVoxels" title="Width (X)" />
        <input v-model.number="size[1]" type="number" min="1" :max="maxVoxels" title="Height (Y)" />
        <input v-model.number="size[2]" type="number" min="1" :max="maxVoxels" title="Depth (Z)" />
        <button title="Resize the grid — voxels outside the new bounds are cut" @click="applyResize">
          Set
        </button>
      </div>
    </template>

    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menu.items" @close="menu = null" />
  </div>
</template>

<style scoped>
.outliner {
  padding: 10px;
}
.list {
  list-style: none;
  margin: 6px 0;
  padding: 0;
  max-height: 220px;
  overflow: auto;
}
.list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 7px;
  border-radius: 5px;
  cursor: pointer;
}
.list li:hover {
  background: var(--surface-2);
}
.list li.sel {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}
.oname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--bg-elev);
  color: var(--text-dim);
}
.hint {
  text-transform: none;
  letter-spacing: 0;
  color: var(--text-dim);
}
.actions {
  margin-top: 4px;
  flex-wrap: wrap;
}
.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}
</style>
