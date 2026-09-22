<script setup lang="ts">
import { computed, nextTick, ref, type ComponentPublicInstance } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { WIDGET_TYPES, specFor } from '@/core/pixel/widgets';
import type { StateId, WidgetType } from '@/core/pixel/types';
import Icon from '@/components/Icon.vue';
import { faPlus, faTrash } from '@fortawesome/pro-solid-svg-icons';

const store = usePixelStore();
const renamingId = ref<string | null>(null);
const renameText = ref('');
const renameInput = ref<HTMLInputElement | null>(null);
const addType = ref<WidgetType>('button');

const active = computed(() => store.activeWidget());
// defensive: states are fixed at widget creation today, but depend on
// structureVersion too so this keeps working if a later milestone adds
// per-state creation after the fact (see reactivity note in NinePatchPanel.vue)
const activeStates = computed<StateId[]>(() => {
  void store.structureVersion;
  return active.value ? [...active.value.states.keys()] : [];
});

function startRename(id: string, current: string) {
  renamingId.value = id;
  renameText.value = current;
  nextTick(() => renameInput.value?.select());
}
function setRenameInput(el: Element | ComponentPublicInstance | null) {
  renameInput.value = el instanceof HTMLInputElement ? el : null;
}
function commitRename() {
  if (renamingId.value) store.renameWidget(renamingId.value, renameText.value);
  renamingId.value = null;
}
function addWidget() {
  store.addWidget(addType.value);
}
function removeWidget(id: string, name: string) {
  if (store.widgets.length <= 1) return;
  if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
  store.removeWidget(id);
}
</script>

<template>
  <div class="panel widget-list">
    <div class="row">
      <h3>Widgets</h3>
    </div>

    <ul class="list">
      <li v-for="w in store.widgets" :key="w.id">
        <button
          class="entry"
          :class="{ sel: w.id === store.activeWidgetId }"
          @click="store.setActiveWidget(w.id)"
          @dblclick="startRename(w.id, w.name)"
        >
          <template v-if="renamingId === w.id">
            <input
              :ref="setRenameInput"
              v-model="renameText"
              class="rename"
              @click.stop
              @blur="commitRename"
              @keydown.enter="commitRename"
              @keydown.escape="renamingId = null"
            />
          </template>
          <template v-else>
            <span class="name">{{ w.name }}</span>
            <span class="type">{{ specFor(w.type).label }}</span>
          </template>
        </button>
        <button
          class="del"
          :disabled="store.widgets.length <= 1"
          title="Delete widget"
          @click="removeWidget(w.id, w.name)"
        >
          <Icon :icon="faTrash" :size="12" />
        </button>
      </li>
    </ul>

    <div class="row add-row">
      <select v-model="addType">
        <option v-for="t in WIDGET_TYPES" :key="t" :value="t">{{ specFor(t).label }}</option>
      </select>
      <button title="Add widget" @click="addWidget">
        <Icon :icon="faPlus" :size="12" />
      </button>
    </div>

    <template v-if="active && activeStates.length > 1">
      <div class="row states-row">
        <button
          v-for="s in activeStates"
          :key="s"
          class="state"
          :class="{ active: store.activeStateId === s }"
          @click="store.setActiveState(s)"
        >{{ s }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.widget-list {
  padding: 10px;
}
.list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  max-height: 220px;
  overflow: auto;
}
.list li {
  display: flex;
  gap: 4px;
  margin-bottom: 3px;
}
.entry {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  text-align: left;
  padding: 5px 7px;
  background: var(--bg-elev);
}
.entry.sel {
  border-color: var(--accent);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.type {
  color: var(--text-dim);
  font-size: 11px;
  flex: none;
  margin-left: auto;
}
.rename {
  width: 100%;
}
.del {
  width: 26px;
  padding: 0;
  flex: none;
}
.add-row {
  gap: 6px;
}
.add-row select {
  flex: 1;
}
.states-row {
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.state {
  padding: 3px 8px;
  font-size: 12px;
  text-transform: capitalize;
}
.state.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
}
</style>
