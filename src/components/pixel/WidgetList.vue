<script setup lang="ts">
import { computed, nextTick, ref, type ComponentPublicInstance } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { usePixelSession } from '@/editor/pixel/session';
import { toast } from '@/editor/toasts';
import { WIDGET_TYPES, specFor } from '@/core/pixel/widgets';
import type { StateId, WidgetType } from '@/core/pixel/types';
import Icon from '@/components/Icon.vue';
import { faPlus, faTrash, faCopy } from '@fortawesome/pro-solid-svg-icons';

const store = usePixelStore();
const { runner } = usePixelSession();
const renamingId = ref<string | null>(null);
const renameText = ref('');
const renameInput = ref<HTMLInputElement | null>(null);
const addType = ref<WidgetType>('button');
const copySource = ref<StateId | ''>('');

const active = computed(() => store.activeWidget());
// defensive: states are fixed at widget creation today, but depend on
// structureVersion too so this keeps working if a later milestone adds
// per-state creation after the fact (see reactivity note in NinePatchPanel.vue)
const activeStates = computed<StateId[]>(() => {
  void store.structureVersion;
  return active.value ? [...active.value.states.keys()] : [];
});
const otherStates = computed(() => activeStates.value.filter((s) => s !== store.activeStateId));
/** which states have any painted (non-transparent) pixels — dims the empty ones in the tab row */
const stateHasContent = computed(() => {
  void store.structureVersion;
  void store.editVersion;
  const map: Partial<Record<StateId, boolean>> = {};
  if (active.value) for (const [id, data] of active.value.states) map[id] = data.bounds() !== null;
  return map;
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
function copyFrom() {
  const src = copySource.value && otherStates.value.includes(copySource.value) ? copySource.value : otherStates.value[0];
  if (!src) return;
  const ok = runner.value?.copyStateFrom(src);
  if (ok) toast(`Copied ${src} into ${store.activeStateId}`, 'success');
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
          class="icon-btn"
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
      <button class="icon-btn" title="Add widget" @click="addWidget">
        <Icon :icon="faPlus" :size="12" />
      </button>
    </div>

    <template v-if="active && activeStates.length > 1">
      <div class="row states-row">
        <button
          v-for="s in activeStates"
          :key="s"
          class="state"
          :class="{ active: store.activeStateId === s, empty: !stateHasContent[s] }"
          :title="stateHasContent[s] ? undefined : 'No pixels painted yet'"
          @click="store.setActiveState(s)"
        >{{ s }}</button>
      </div>
      <div class="row copy-row" title="Replace this state's pixels with another state's — a starting point to tweak from">
        <select v-model="copySource">
          <option value="" disabled>Copy from…</option>
          <option v-for="s in otherStates" :key="s" :value="s">{{ s }}</option>
        </select>
        <button class="icon-btn" :disabled="otherStates.length === 0" @click="copyFrom">
          <Icon :icon="faCopy" :size="12" />
        </button>
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
/* the plain `button` rule in style.css doesn't centre its content (no
   display:flex) — fine for a single line of text, which browsers centre by
   default, but an <Icon> svg inside sits off-centre without it */
.icon-btn {
  width: 26px;
  padding: 0;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
.state.empty:not(.active) {
  color: var(--text-dim);
  opacity: 0.6;
}
.copy-row {
  gap: 6px;
  margin-top: 6px;
}
.copy-row select {
  flex: 1;
  font-size: 12px;
  text-transform: capitalize;
}
</style>
