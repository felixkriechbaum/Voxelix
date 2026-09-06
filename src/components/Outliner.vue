<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { MAX_SIZE } from '@/core/voxel/constants';
import ContextMenu, { type MenuItem } from './ContextMenu.vue';

const store = useEditorStore();
const renamingId = ref<string | null>(null);
const renameText = ref('');
const renameInput = ref<HTMLInputElement | null>(null);
const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);

const active = computed(() => store.activeObject());
const size = ref<[number, number, number]>([16, 16, 16]);

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
  const s = size.value.map((n) => Math.max(1, Math.min(MAX_SIZE, Math.round(n)))) as [
    number,
    number,
    number,
  ];
  store.resizeActive(s);
}

function openMenu(e: MouseEvent, id: string, name: string) {
  store.setActive(id);
  menu.value = {
    x: e.clientX,
    y: e.clientY,
    items: [
      { label: 'Rename', action: () => startRename(id, name) },
      { label: 'Duplicate', action: () => store.duplicateObject(id) },
      { label: 'Extend', action: () => store.extendObject(id) },
      { separator: true },
      { label: 'Delete', danger: true, action: () => store.removeObject(id) },
    ],
  };
}

function syncSize() {
  const a = active.value;
  if (a) size.value = [a.data.sizeX, a.data.sizeY, a.data.sizeZ];
}
syncSize();
watch(() => store.activeVersion, syncSize);
</script>

<template>
  <div class="panel outliner">
    <div class="row">
      <h3>Objects</h3>
      <span class="spacer" />
      <button title="Add object" @click="addObject">+</button>
    </div>

    <ul class="list">
      <li
        v-for="o in store.objects"
        :key="o.id"
        :class="{ sel: o.id === store.activeObjectId }"
        @click="store.setActive(o.id)"
        @dblclick="startRename(o.id, o.name)"
        @contextmenu.prevent="openMenu($event, o.id, o.name)"
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
      <button :disabled="!store.activeObjectId" @click="store.duplicateObject(store.activeObjectId!)">
        Duplicate
      </button>
      <button :disabled="!store.activeObjectId" @click="store.extendObject(store.activeObjectId!)">
        Extend
      </button>
      <button
        :disabled="!store.activeObjectId"
        class="danger"
        @click="store.removeObject(store.activeObjectId!)"
      >
        Delete
      </button>
    </div>

    <template v-if="active">
      <h3 style="margin-top: 12px">
        Size (max {{ MAX_SIZE }})
        <span v-if="active.kind === 'extend'" class="hint">— overlay grid</span>
      </h3>
      <div class="row">
        <input v-model.number="size[0]" type="number" min="1" :max="MAX_SIZE" />
        <input v-model.number="size[1]" type="number" min="1" :max="MAX_SIZE" />
        <input v-model.number="size[2]" type="number" min="1" :max="MAX_SIZE" />
        <button @click="applyResize">Set</button>
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
  background: var(--bg-elev);
}
.list li.sel {
  background: var(--accent-dim);
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
