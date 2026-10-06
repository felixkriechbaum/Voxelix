<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import { MAX_SIZE } from '@/core/voxel/constants';
import ContextMenu, { type MenuItem } from './ContextMenu.vue';
import ModifierStack from './ModifierStack.vue';
import { toast } from '@/editor/toasts';
import Icon from './Icon.vue';
import {
  faPlus,
  faClone,
  faCodeBranch,
  faTrash,
  faRotateLeft,
  faRotateRight,
  faLayerGroup,
  faXmark,
  faChevronDown,
} from '@fortawesome/pro-solid-svg-icons';
import { partsCollapsed } from '@/editor/panelPrefs';

const store = useEditorStore();
const { runner } = useSession();
const renamingId = ref<string | null>(null);
const renameText = ref('');
const renameInput = ref<HTMLInputElement | null>(null);
const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);
const deleteTargetId = ref<string | null>(null);

const active = computed(() => store.activeObject());

/** The active object's parts + modifiers as plain data (the project itself is markRaw). */
const partsView = computed(() => {
  void store.activeVersion;
  void store.structureVersion;
  void store.editVersion;
  const o = store.activeObject();
  if (!o) return null;
  return {
    extend: o.kind === 'extend',
    activeId: o.activePartId,
    parts: o.parts.map((p) => ({ id: p.id, name: p.name, mods: p.modifiers.length })),
    modifiers: o.activePart.modifiers.map((m) => (m.type === 'move' ? { ...m, offset: [...m.offset] as [number, number, number] } : { ...m })),
    activeName: o.activePart.name,
  };
});

/** What the folded parts section still tells you: the part you're editing and its modifiers. */
const partsSummary = computed(() => {
  const v = partsView.value;
  if (!v) return '';
  const mods = v.modifiers.length;
  const modText = mods ? `${mods} mod${mods > 1 ? 's' : ''}` : 'no mods';
  return v.parts.length > 1 ? `${v.activeName} · ${modText}` : modText;
});

const renamingPartId = ref<string | null>(null);
const partRenameText = ref('');
function startPartRename(id: string, name: string) {
  renamingPartId.value = id;
  partRenameText.value = name;
  nextTick(() => (document.getElementById(`part-rename-${id}`) as HTMLInputElement | null)?.select());
}
function commitPartRename() {
  if (renamingPartId.value) store.renamePart(renamingPartId.value, partRenameText.value);
  renamingPartId.value = null;
}
function onPartKey(e: KeyboardEvent, id: string, name: string) {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    store.setActivePart(id);
  } else if (e.key === 'F2') {
    e.preventDefault();
    startPartRename(id, name);
  }
}

/** edited in voxels (grid cells / detail) */
const size = ref<[number, number, number]>([16, 16, 16]);
const maxVoxels = computed(() => Math.floor(MAX_SIZE / store.activeDetail));
/** saturation/brightness shift, in percent (-100..100) for the sliders */
const colorAdjustPct = ref<[number, number]>([0, 0]);

function startRename(id: string, current: string) {
  renamingId.value = id;
  renameText.value = current;
  nextTick(() => renameInput.value?.select());
}
function setRenameInput(el: Element | ComponentPublicInstance | null) {
  renameInput.value = el instanceof HTMLInputElement ? el : null;
}
function onObjectKey(e: KeyboardEvent, id: string, name: string) {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    store.setActive(id);
  } else if (e.key === 'F2') {
    e.preventDefault();
    startRename(id, name);
  }
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

function resync(id: string) {
  const dropped = store.resyncOverlay(id);
  if (dropped > 0) toast(`Gave ${dropped.toLocaleString()} cells back to the base`, 'success');
  else toast('Overlay was already in sync — nothing to drop', 'info');
}

function baseExists(o: { baseId?: string }): boolean {
  return !!o.baseId && store.objects.some((x) => x.id === o.baseId);
}

const deleteInfo = computed(() => {
  const id = deleteTargetId.value;
  if (!id) return null;
  const target = store.objects.find((o) => o.id === id);
  if (!target) return null;
  const doomed = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const o of store.objects) {
      if (o.baseId && doomed.has(o.baseId) && !doomed.has(o.id)) {
        doomed.add(o.id);
        grew = true;
      }
    }
  }
  return { id, name: target.name, linked: doomed.size - 1 };
});

function requestDelete(id: string) {
  menu.value = null;
  deleteTargetId.value = id;
}
function confirmDelete() {
  if (!deleteTargetId.value) return;
  store.removeObject(deleteTargetId.value);
  deleteTargetId.value = null;
}

/** True if making `candidateId` the base of `overlayId` would form a cycle. */
function wouldCycle(candidateId: string, overlayId: string): boolean {
  const byId = new Map(store.objects.map((o) => [o.id, o]));
  let cur = byId.get(candidateId);
  const seen = new Set<string>();
  while (cur && cur.kind === 'extend' && cur.baseId) {
    if (cur.baseId === overlayId || seen.has(cur.id)) return true;
    seen.add(cur.id);
    cur = byId.get(cur.baseId);
  }
  return false;
}

function openMenu(e: MouseEvent, id: string, name: string, kind: string) {
  store.setActive(id);
  const items: MenuItem[] = [
    { label: 'Rename', action: () => startRename(id, name) },
    { label: 'Duplicate', action: () => store.duplicateObject(id) },
    { label: 'Extend', action: () => store.extendObject(id) },
    { separator: true },
    { label: 'Rotate 90° ⟲', action: () => store.rotateActive(-1) },
    { label: 'Rotate 90° ⟳', action: () => store.rotateActive(1) },
  ];
  if (kind === 'extend') {
    items.push(
      { label: 'Re-sync overlay with base', action: () => resync(id) },
      { label: 'Rotate overlay only ⟲', action: () => store.rotateOverlay(id, -1) },
      { label: 'Rotate overlay only ⟳', action: () => store.rotateOverlay(id, 1) },
      {
        label: 'Reset extend to base',
        danger: true,
        disabled: !baseExists(store.objects.find((o) => o.id === id) ?? {}),
        action: () => runner.value?.resetOverlay(),
      },
    );
  }
  const bases = store.objects.filter((o) => o.id !== id && !wouldCycle(o.id, id));
  if (bases.length) {
    items.push(
      { separator: true },
      {
        label: 'Set base',
        children: bases.map((b) => ({ label: b.name, action: () => store.setExtendBase(id, b.id) })),
      },
    );
  }
  items.push({ separator: true }, { label: 'Delete', danger: true, action: () => requestDelete(id) });
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
  colorAdjustPct.value = [
    Math.round((a.colorAdjust?.saturation ?? 0) * 100),
    Math.round((a.colorAdjust?.brightness ?? 0) * 100),
  ];
}
syncSize();
watch(() => [store.activeVersion, store.structureVersion], syncSize);

function applyColorAdjust() {
  const a = active.value;
  if (!a) return;
  store.setColorAdjust(a.id, {
    saturation: colorAdjustPct.value[0] / 100,
    brightness: colorAdjustPct.value[1] / 100,
  });
}
function resetColorAdjust() {
  colorAdjustPct.value = [0, 0];
  applyColorAdjust();
}
</script>

<template>
  <div class="outliner">
  <section class="panel box" aria-labelledby="objects-heading">
    <div class="row head">
      <h3 id="objects-heading">Objects</h3>
      <span class="spacer" />
      <button class="ic" title="Add a new object" aria-label="Add object" @click="addObject">
        <Icon :icon="faPlus" />
      </button>
    </div>

    <ul class="list" aria-label="Project objects">
      <li
        v-for="o in store.objects"
        :key="o.id"
        :class="{ sel: o.id === store.activeObjectId }"
        :role="renamingId === o.id ? undefined : 'button'"
        :aria-pressed="renamingId === o.id ? undefined : o.id === store.activeObjectId"
        :aria-current="o.id === store.activeObjectId ? 'true' : undefined"
        :tabindex="renamingId === o.id ? -1 : 0"
        title="Click to select · double-click to rename · right-click for more"
        @click="store.setActive(o.id)"
        @dblclick="startRename(o.id, o.name)"
        @contextmenu.prevent="openMenu($event, o.id, o.name, o.kind)"
        @keydown="onObjectKey($event, o.id, o.name)"
      >
        <input
          v-if="renamingId === o.id"
          :ref="setRenameInput"
          v-model="renameText"
          type="text"
          @keydown.enter="commitRename"
          @keydown.esc="renamingId = null"
          @blur="commitRename"
          @click.stop
        />
        <template v-else>
          <span class="oname">{{ o.name }}</span>
          <span
            v-if="o.kind === 'extend'"
            class="tag"
            :class="{ broken: !baseExists(o) }"
            :title="
              baseExists(o)
                ? 'linked overlay of its base'
                : 'overlay — its base link is broken; right-click → Set base'
            "
          >{{ baseExists(o) ? 'extends' : 'base missing' }}</span>
        </template>
      </li>
    </ul>

    <div class="row actions">
      <button
        class="ic"
        :disabled="!store.activeObjectId"
        title="Duplicate — make an independent copy of this object"
        aria-label="Duplicate object"
        @click="store.duplicateObject(store.activeObjectId!)"
      >
        <Icon :icon="faClone" />
      </button>
      <button
        class="ic"
        :disabled="!store.activeObjectId"
        title="Extend — add a linked overlay that edits on top without changing the original"
        aria-label="Extend object"
        @click="store.extendObject(store.activeObjectId!)"
      >
        <Icon :icon="faCodeBranch" />
      </button>
      <button
        class="ic"
        :disabled="!store.activeObjectId"
        title="Rotate the whole object 90° counter-clockwise (Y axis) — clears this object's undo history"
        aria-label="Rotate object left"
        @click="store.rotateActive(-1)"
      >
        <Icon :icon="faRotateLeft" />
      </button>
      <button
        class="ic"
        :disabled="!store.activeObjectId"
        title="Rotate the whole object 90° clockwise (Y axis) — clears this object's undo history"
        aria-label="Rotate object right"
        @click="store.rotateActive(1)"
      >
        <Icon :icon="faRotateRight" />
      </button>
      <span class="spacer" />
      <button
        class="ic danger"
        :disabled="!store.activeObjectId"
        title="Delete this object"
        aria-label="Delete object"
        @click="requestDelete(store.activeObjectId!)"
      >
        <Icon :icon="faTrash" />
      </button>
    </div>

    <div v-if="deleteInfo" class="delete-confirm" role="alert">
      <p>
        Delete <strong>{{ deleteInfo.name }}</strong>?
        <span v-if="deleteInfo.linked"> {{ deleteInfo.linked }} linked overlay{{ deleteInfo.linked === 1 ? '' : 's' }} will also be deleted.</span>
      </p>
      <div class="row">
        <button @click="deleteTargetId = null">Cancel</button>
        <button class="danger" @click="confirmDelete">Delete</button>
      </div>
    </div>

  </section>

  <section v-if="active" class="panel box" aria-labelledby="object-heading">
      <h3 id="object-heading" class="obj-title" :title="active.name">{{ active.name }}</h3>

      <template v-if="partsView && !partsView.extend">
        <div class="sub">
          <button
            class="fold"
            :aria-expanded="!partsCollapsed"
            aria-controls="parts-body"
            :title="partsCollapsed ? 'Show the parts and their modifiers' : 'Fold the parts and modifiers away'"
            @click="partsCollapsed = !partsCollapsed"
          >
            <Icon class="fold-chev" :icon="faChevronDown" :size="10" />
            Parts &amp; modifiers
          </button>
          <span v-if="partsCollapsed" class="dim summary" :title="partsSummary">{{ partsSummary }}</span>
          <button
            v-else
            class="mini"
            title="Add an empty part — its own mesh inside this object"
            @click="store.addPart()"
          >
            + Add part
          </button>
        </div>
        <div v-show="!partsCollapsed" id="parts-body">
          <ul class="parts" aria-label="Parts of this object">
            <li
              v-for="p in partsView.parts"
              :key="p.id"
              :class="{ sel: p.id === partsView.activeId }"
              :role="renamingPartId === p.id ? undefined : 'button'"
              :aria-pressed="renamingPartId === p.id ? undefined : p.id === partsView.activeId"
              :tabindex="renamingPartId === p.id ? -1 : 0"
              title="Click to edit this part · double-click to rename"
              @click="store.setActivePart(p.id)"
              @dblclick="startPartRename(p.id, p.name)"
              @keydown="onPartKey($event, p.id, p.name)"
            >
              <Icon :icon="faLayerGroup" :size="11" class="part-ic" />
              <input
                v-if="renamingPartId === p.id"
                :id="`part-rename-${p.id}`"
                v-model="partRenameText"
                type="text"
                @keydown.enter="commitPartRename"
                @keydown.esc="renamingPartId = null"
                @blur="commitPartRename"
                @click.stop
              />
              <template v-else>
                <span class="pname">{{ p.name }}</span>
                <span v-if="p.mods" class="tag" title="This part has modifiers">{{ p.mods }} mod{{ p.mods > 1 ? 's' : '' }}</span>
                <button
                  v-if="partsView.parts.length > 1"
                  class="part-del"
                  :title="`Delete ${p.name}`"
                  :aria-label="`Delete ${p.name}`"
                  @click.stop="store.removePart(p.id)"
                >
                  <Icon :icon="faXmark" :size="11" />
                </button>
              </template>
            </li>
          </ul>

          <ModifierStack :part-id="partsView.activeId" :part-name="partsView.activeName" :modifiers="partsView.modifiers" />
        </div>
      </template>

      <div class="sub">
        <span>Grid size in voxels</span>
        <span class="dim">{{ active.kind === 'extend' ? 'overlay grid, ' : '' }}max {{ maxVoxels }}</span>
      </div>
      <form class="row size" @submit.prevent="applyResize">
        <label class="axis" title="Width (X)">
          <span class="ax" style="color: var(--axis-x)">X</span>
          <input v-model.number="size[0]" type="number" min="1" :max="maxVoxels" aria-label="Width in voxels" />
        </label>
        <label class="axis" title="Height (Y)">
          <span class="ax" style="color: var(--axis-y)">Y</span>
          <input v-model.number="size[1]" type="number" min="1" :max="maxVoxels" aria-label="Height in voxels" />
        </label>
        <label class="axis" title="Depth (Z)">
          <span class="ax" style="color: var(--axis-z)">Z</span>
          <input v-model.number="size[2]" type="number" min="1" :max="maxVoxels" aria-label="Depth in voxels" />
        </label>
        <button type="submit" title="Resize the grid — voxels outside the new bounds are cut">Resize</button>
      </form>

      <div class="sub">
        <span>Colour shift</span>
        <button
          class="reset"
          :disabled="colorAdjustPct[0] === 0 && colorAdjustPct[1] === 0"
          title="Reset saturation and brightness for this object"
          @click="resetColorAdjust"
        >
          Reset
        </button>
      </div>
      <div class="row slider">
        <label for="object-saturation">Saturation</label>
        <input
          id="object-saturation"
          v-model.number="colorAdjustPct[0]"
          type="range"
          min="-100"
          max="100"
          @input="applyColorAdjust"
        />
        <span class="pct">{{ colorAdjustPct[0] }}%</span>
      </div>
      <div class="row slider">
        <label for="object-brightness">Brightness</label>
        <input
          id="object-brightness"
          v-model.number="colorAdjustPct[1]"
          type="range"
          min="-100"
          max="100"
          @input="applyColorAdjust"
        />
        <span class="pct">{{ colorAdjustPct[1] }}%</span>
      </div>
  </section>

    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menu.items" @close="menu = null" />
  </div>
</template>

<style scoped>
.outliner {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: none;
}
.box {
  padding: 10px 10px 12px;
}
.head h3 {
  margin: 0;
}
.list {
  list-style: none;
  margin: 8px -4px 6px;
  padding: 0;
  max-height: 220px;
  overflow: auto;
}
.list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.list li:hover {
  background: var(--surface-2);
}
.list li.sel {
  background: var(--accent-soft);
  box-shadow: inset 3px 0 0 var(--accent);
}
.list li:focus-visible {
  outline-offset: -2px;
}
.oname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--ink-dim);
}
.tag.broken {
  color: var(--warn);
  border-color: color-mix(in srgb, var(--warn) 50%, var(--line));
}
.actions {
  gap: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}
.delete-confirm {
  margin-top: 8px;
  padding: 8px;
  background: color-mix(in srgb, var(--warn) 10%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--line));
  border-radius: var(--radius-sm);
}
.delete-confirm p {
  margin: 0 0 7px;
  font-size: 12px;
  line-height: 1.4;
}
.delete-confirm .row {
  justify-content: flex-end;
}
.ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  padding: 0;
  color: var(--ink-dim);
  background: transparent;
  border-color: transparent;
}
.ic:hover:not(:disabled) {
  color: var(--ink);
}
.ic.danger:hover:not(:disabled) {
  color: var(--warn);
  border-color: transparent;
  background: color-mix(in srgb, var(--warn) 12%, transparent);
}
.parts {
  list-style: none;
  margin: 0 -4px;
  padding: 0;
  max-height: 180px;
  overflow: auto;
}
.parts li {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.parts li:hover {
  background: var(--surface-2);
}
.parts li.sel {
  background: var(--accent-soft);
  box-shadow: inset 3px 0 0 var(--accent);
}
.part-ic {
  color: var(--ink-faint);
}
.pname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parts input {
  flex: 1;
  min-width: 0;
  padding: 2px 5px;
}
.part-del {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--ink-faint);
  background: transparent;
  border-color: transparent;
}
.part-del:hover:not(:disabled) {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  border-color: transparent;
}
.parts li:not(:hover):not(:focus-within) .part-del {
  opacity: 0;
}
.mini {
  padding: 1px 8px;
  font-size: 11.5px;
}
.obj-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 10px;
}
.sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 12px 0 6px;
  font-size: 12px;
  color: var(--ink-dim);
}
.obj-title + .sub {
  margin-top: 0;
}
.sub .dim {
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}
.sub .fold {
  flex: none;
}
.summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.size {
  gap: 4px;
}
.axis {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  background: var(--surface-0);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.axis:focus-within {
  border-color: var(--accent);
}
.ax {
  padding: 0 0 0 7px;
  font: 600 11px/1 var(--font-display);
}
.axis input {
  border: 0;
  background: transparent;
  min-width: 0;
  padding: 4px 6px 4px 5px;
}
.axis input:focus {
  outline: none;
}
.reset {
  padding: 1px 8px;
  font-size: 11px;
  color: var(--ink-dim);
}
.slider {
  gap: 8px;
  margin-top: 2px;
}
.slider label {
  width: 70px;
  flex: none;
  color: var(--ink-dim);
  font-size: 12px;
}
.slider input[type='range'] {
  flex: 1;
  min-width: 0;
}
.slider .pct {
  width: 3.4em;
  flex: none;
  text-align: right;
  color: var(--ink-dim);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
</style>
