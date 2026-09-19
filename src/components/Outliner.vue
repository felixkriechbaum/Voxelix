<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import { MAX_SIZE } from '@/core/voxel/constants';
import ContextMenu, { type MenuItem } from './ContextMenu.vue';
import { toast } from '@/editor/toasts';
import Icon from './Icon.vue';
import {
  faPlus,
  faClone,
  faCodeBranch,
  faTrash,
  faRotateLeft,
  faRotateRight,
} from '@fortawesome/pro-solid-svg-icons';

const store = useEditorStore();
const { runner } = useSession();
const renamingId = ref<string | null>(null);
const renameText = ref('');
const renameInput = ref<HTMLInputElement | null>(null);
const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);
const deleteTargetId = ref<string | null>(null);

const active = computed(() => store.activeObject());
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
    items.push({ separator: true });
    for (const b of bases) {
      items.push({
        label: `Set base → ${b.name}`,
        action: () => store.setExtendBase(id, b.id),
      });
    }
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
  <div class="panel outliner">
    <div class="row">
      <h3>Objects</h3>
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
          >{{ baseExists(o) ? 'ext' : 'ext ⚠' }}</span>
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

    <template v-if="active">
      <h3 style="margin-top: 12px">
        Size in voxels (max {{ maxVoxels }})
        <span v-if="active.kind === 'extend'" class="hint">— overlay grid</span>
      </h3>
      <div class="row">
        <input v-model.number="size[0]" type="number" min="1" :max="maxVoxels" title="Width (X)" aria-label="Width in voxels" />
        <input v-model.number="size[1]" type="number" min="1" :max="maxVoxels" title="Height (Y)" aria-label="Height in voxels" />
        <input v-model.number="size[2]" type="number" min="1" :max="maxVoxels" title="Depth (Z)" aria-label="Depth in voxels" />
        <button title="Resize the grid — voxels outside the new bounds are cut" @click="applyResize">
          Set
        </button>
      </div>

      <h3 style="margin-top: 12px">
        Colour
        <button
          class="reset"
          title="Reset saturation and brightness for this object"
          @click="resetColorAdjust"
        >
          Reset
        </button>
      </h3>
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
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface-2);
  color: var(--ink-dim);
}
.tag.broken {
  color: var(--warn);
}
.hint {
  letter-spacing: 0;
  color: var(--ink-dim);
}
.actions {
  margin-top: 6px;
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
  font-size: 11px;
  line-height: 1.35;
}
.delete-confirm .row {
  justify-content: flex-end;
}
.ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  padding: 0;
  color: var(--ink-dim);
}
.ic:hover:not(:disabled) {
  color: var(--ink);
}
.ic.danger:hover:not(:disabled) {
  color: var(--warn);
  border-color: var(--warn);
}
.outliner h3 .reset {
  float: right;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 400;
  color: var(--ink-dim);
}
.outliner h3 .reset:hover {
  color: var(--ink);
}
.slider {
  gap: 6px;
  margin-top: 4px;
}
.slider label {
  width: 62px;
  flex: none;
  color: var(--ink-dim);
  font-size: 11px;
}
.slider input[type='range'] {
  flex: 1;
  min-width: 0;
}
.slider .pct {
  width: 3.2em;
  flex: none;
  text-align: right;
  color: var(--ink-dim);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}
</style>
