<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { usePixelSession } from '@/editor/pixel/session';
import { toast } from '@/editor/toasts';
import { specFor, stateLabel, stateSpec, widgetTypesByCategory } from '@/core/pixel/widgets';
import type { StateId, WidgetType } from '@/core/pixel/types';
import Icon from '@/components/Icon.vue';
import { faPlus, faTrash, faCopy, faExpand } from '@fortawesome/pro-solid-svg-icons';

const store = usePixelStore();
const { runner } = usePixelSession();
const renamingId = ref<string | null>(null);
const renameText = ref('');
const renameInput = ref<HTMLInputElement | null>(null);
const addType = ref<WidgetType>('button');
const copySource = ref<StateId | ''>('');

const typeGroups = widgetTypesByCategory();

const active = computed(() => {
  void store.activeVersion;
  return store.activeWidget();
});
/** the widget's parts (box / fill / grabber / …), in spec order, with whether any state has pixels */
const activeElements = computed(() => {
  void store.structureVersion;
  void store.editVersion;
  const w = active.value;
  if (!w) return [];
  const spec = specFor(w.type);
  return [...w.elements.values()].map((el) => {
    const es = spec.elements.find((e) => e.id === el.id);
    return {
      id: el.id,
      label: es?.label ?? el.id,
      kind: es?.kind ?? 'texture',
      hint: es?.hint,
      size: `${el.width}×${el.height}`,
      painted: [...el.states.values()].some((d) => d.bounds() !== null),
    };
  });
});
const activeElementInfo = computed(() => activeElements.value.find((e) => e.id === store.activeElementId) ?? null);
// depend on structureVersion too (see reactivity note in NinePatchPanel.vue)
const activeStates = computed<StateId[]>(() => {
  void store.structureVersion;
  void store.activeVersion;
  const el = store.activeElement();
  return el ? [...el.states.keys()] : [];
});
const otherStates = computed(() => activeStates.value.filter((s) => s !== store.activeStateId));
/** which states have any painted (non-transparent) pixels — dims the empty ones in the tab row */
const stateHasContent = computed(() => {
  void store.structureVersion;
  void store.editVersion;
  void store.activeVersion;
  const map: Partial<Record<StateId, boolean>> = {};
  const el = store.activeElement();
  if (el) for (const [id, data] of el.states) map[id] = data.bounds() !== null;
  return map;
});

/** Tooltip for a state tab: what an unpainted state shows instead, and what an overlay state is. */
function stateTitle(s: StateId): string {
  const w = active.value;
  const ss = w ? stateSpec(w.type, store.activeElementId, s) : null;
  if (ss?.overlay) return `${stateLabel(s)} — drawn on top of the current state${stateHasContent.value[s] ? '' : ' (empty: exports as StyleBoxEmpty)'}`;
  if (stateHasContent.value[s]) return stateLabel(s);
  return ss?.from ? `Nothing painted — uses ${stateLabel(ss.from)}` : 'Nothing painted yet';
}

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
  if (ok) toast(`Copied ${stateLabel(src)} into ${stateLabel(store.activeStateId)}`, 'success');
}

const resizeW = ref(32);
const resizeH = ref(16);
const resizeAnchor = ref<'topleft' | 'center'>('center');
watch(
  () => [store.activeWidgetId, store.activeElementId, store.structureVersion],
  () => {
    const w = store.activeElement();
    if (w) {
      resizeW.value = w.width;
      resizeH.value = w.height;
    }
  },
  { immediate: true },
);
function applyResize() {
  const w = store.activeElement();
  if (!w) return;
  if (resizeW.value === w.width && resizeH.value === w.height) return;
  store.resizeActiveElement(resizeW.value, resizeH.value, resizeAnchor.value);
  toast(`Resized to ${resizeW.value}×${resizeH.value} — undo history for this part was cleared`, 'info');
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
              type="text"
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
        <optgroup v-for="g in typeGroups" :key="g.category" :label="g.category">
          <option v-for="t in g.types" :key="t" :value="t">{{ specFor(t).label }}</option>
        </optgroup>
      </select>
      <button class="icon-btn" title="Add widget" @click="addWidget">
        <Icon :icon="faPlus" :size="12" />
      </button>
    </div>

    <template v-if="active && activeElements.length > 1">
      <div class="section-label">Parts</div>
      <div class="row elements-row">
        <button
          v-for="e in activeElements"
          :key="e.id"
          class="element"
          :class="{ active: store.activeElementId === e.id, empty: !e.painted }"
          :title="`${e.label} — ${e.kind === 'style' ? 'StyleBox' : e.kind === 'icon' ? 'icon' : 'texture'}, ${e.size}${e.painted ? '' : ' (nothing painted yet)'}`"
          @click="store.setActiveElement(e.id)"
        >
          {{ e.label }}<span class="kind">{{ e.kind === 'style' ? 'box' : e.kind }}</span>
        </button>
      </div>
    </template>
    <p v-if="activeElementInfo?.hint" class="hint">{{ activeElementInfo.hint }}</p>

    <div v-if="active" class="row resize-row" title="Resize this part's canvas (all its states) — clears its undo history">
      <label>W<input v-model.number="resizeW" type="number" min="1" /></label>
      <label>H<input v-model.number="resizeH" type="number" min="1" /></label>
      <select v-model="resizeAnchor">
        <option value="topleft">Top-left</option>
        <option value="center">Centre</option>
      </select>
      <button class="icon-btn" title="Apply resize" @click="applyResize">
        <Icon :icon="faExpand" :size="12" />
      </button>
    </div>

    <template v-if="active && activeStates.length > 1">
      <div class="row states-row">
        <button
          v-for="s in activeStates"
          :key="s"
          class="state"
          :class="{ active: store.activeStateId === s, empty: !stateHasContent[s] }"
          :title="stateTitle(s)"
          @click="store.setActiveState(s)"
        >{{ stateLabel(s) }}</button>
      </div>
      <div class="row copy-row" title="Replace this state's pixels with another state's — a starting point to tweak from">
        <select v-model="copySource">
          <option value="" disabled>Copy from…</option>
          <option v-for="s in otherStates" :key="s" :value="s">{{ stateLabel(s) }}</option>
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
.section-label {
  margin: 8px 0 4px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--text-dim);
}
.elements-row {
  flex-wrap: wrap;
  gap: 4px;
}
.element {
  padding: 3px 7px;
  font-size: 12px;
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}
.element .kind {
  font-size: 10px;
  color: var(--text-dim);
}
.element.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
}
.element.active .kind {
  color: inherit;
  opacity: 0.75;
}
.element.empty:not(.active) {
  color: var(--text-dim);
  opacity: 0.6;
}
.hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-dim);
}
.resize-row {
  gap: 4px;
  margin-top: 8px;
}
.resize-row label {
  width: 34px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  color: var(--text-dim);
}
.resize-row input {
  min-width: 0;
  padding: 3px 4px;
  font-size: 12px;
}
.resize-row select {
  flex: 1;
  min-width: 0;
  font-size: 12px;
}
.add-row {
  gap: 6px;
  margin-bottom: 4px;
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
