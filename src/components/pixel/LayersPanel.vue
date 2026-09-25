<script setup lang="ts">
import { computed, markRaw, nextTick, ref } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { usePixelSession } from '@/editor/pixel/session';
import { importImageFromDisk } from '@/editor/pixel/importFlow';
import { BLEND_MODES } from '@/core/pixel/layers';
import type { BlendMode } from '@/core/pixel/types';
import LayerThumb from './LayerThumb.vue';
import ContextMenu, { type MenuItem } from '@/components/ContextMenu.vue';
import Icon from '@/components/Icon.vue';
import {
  faPlus,
  faClone,
  faTrash,
  faArrowUp,
  faArrowDown,
  faEye,
  faEyeSlash,
  faMask,
  faLock,
  faArrowTurnDown,
  faEllipsisVertical,
  faFileImage,
} from '@fortawesome/pro-solid-svg-icons';

const store = usePixelStore();
const { runner } = usePixelSession();

const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);
const renamingId = ref<string | null>(null);
const renameText = ref('');
const renameInput = ref<HTMLInputElement | null>(null);

/** top of the stack first, the way every layers panel lists them */
const layers = computed(() => {
  void store.layersVersion;
  void store.activeVersion;
  const stack = runner.value?.activeStack;
  if (!stack) return [];
  return stack.layers
    .map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      blend: l.blend,
      alphaLock: l.alphaLock,
      clip: l.clip,
      data: markRaw(l.data),
      mask: l.mask ? markRaw(l.mask) : null,
      maskEnabled: l.maskEnabled,
      active: l.id === stack.activeId,
    }))
    .reverse();
});
const active = computed(() => layers.value.find((l) => l.active) ?? null);
const activeIndexFromTop = computed(() => layers.value.findIndex((l) => l.active));
const tick = computed(() => store.editVersion + store.layersVersion);

function select(id: string, e: MouseEvent) {
  if (e.ctrlKey || e.metaKey) {
    runner.value?.setActiveLayer(id, false);
    runner.value?.selectLayerAlpha();
    return;
  }
  runner.value?.setActiveLayer(id, false);
}

/** Click = paint into the mask, Alt+click = show the mask on the canvas, Shift+click = switch it off / on. */
function selectMask(id: string, e: MouseEvent) {
  const l = layers.value.find((x) => x.id === id);
  if (!l?.mask) return;
  if (e.shiftKey) {
    runner.value?.setLayerProps(id, { maskEnabled: !l.maskEnabled });
    return;
  }
  runner.value?.setActiveLayer(id, true);
  if (e.altKey) store.viewMask = !store.viewMask;
}

function toggleVisible(id: string, visible: boolean) {
  runner.value?.setLayerProps(id, { visible: !visible });
}

function startRename(id: string, name: string) {
  renamingId.value = id;
  renameText.value = name;
  void nextTick(() => renameInput.value?.select());
}
function setRenameInput(el: unknown) {
  renameInput.value = el instanceof HTMLInputElement ? el : null;
}
function commitRename() {
  if (renamingId.value) runner.value?.setLayerProps(renamingId.value, { name: renameText.value });
  renamingId.value = null;
}

function onOpacityInput(e: Event, commit: boolean) {
  const id = active.value?.id;
  if (!id) return;
  runner.value?.setLayerProps(id, { opacity: Number((e.target as HTMLInputElement).value) / 100 }, commit);
}
function onBlend(e: Event) {
  const id = active.value?.id;
  if (id) runner.value?.setLayerProps(id, { blend: (e.target as HTMLSelectElement).value as BlendMode });
}

function openMenu(e: MouseEvent) {
  const l = active.value;
  const r = runner.value;
  if (!l || !r) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const hasSel = !!r.selection;
  menu.value = {
    x: rect.left,
    y: rect.bottom + 4,
    items: [
      { label: 'New layer (Ctrl+Shift+N)', action: () => r.addLayer() },
      { label: 'Duplicate layer (Ctrl+J)', action: () => r.duplicateLayer(l.id) },
      { label: 'Import image as layer…', action: () => importImageFromDisk() },
      { separator: true },
      { label: 'Merge down (Ctrl+E)', disabled: activeIndexFromTop.value >= layers.value.length - 1, action: () => r.mergeDown(l.id) },
      { label: 'Flatten image', disabled: layers.value.length <= 1, action: () => r.flatten() },
      { separator: true },
      l.mask
        ? { label: 'Delete mask', action: () => r.removeMask(l.id) }
        : { label: hasSel ? 'Add mask from selection' : 'Add mask', action: () => r.addMask(l.id) },
      { label: l.maskEnabled ? 'Disable mask' : 'Enable mask', disabled: !l.mask, action: () => r.setLayerProps(l.id, { maskEnabled: !l.maskEnabled }) },
      { label: 'Apply mask', disabled: !l.mask, action: () => r.applyMask(l.id) },
      { label: store.viewMask ? 'Show image' : 'Show mask on canvas', disabled: !l.mask, action: () => (store.viewMask = !store.viewMask) },
      { label: 'Select from mask', disabled: !l.mask, action: () => r.selectFromMask() },
      { separator: true },
      { label: 'Select layer pixels', action: () => r.selectLayerAlpha() },
      { label: 'Delete layer', danger: true, disabled: layers.value.length <= 1, action: () => r.removeLayer(l.id) },
    ],
  };
}
</script>

<template>
  <div class="panel layers-panel">
    <div class="row head">
      <h3>Layers</h3>
      <span class="spacer" />
      <button class="icon-btn" title="New layer (Ctrl+Shift+N)" @click="runner?.addLayer()">
        <Icon :icon="faPlus" :size="12" />
      </button>
      <button class="icon-btn" :disabled="!active" title="Duplicate layer (Ctrl+J)" @click="active && runner?.duplicateLayer(active.id)">
        <Icon :icon="faClone" :size="12" />
      </button>
      <button class="icon-btn" title="Import an image as a new layer (or drop / paste one onto the canvas)" @click="importImageFromDisk()">
        <Icon :icon="faFileImage" :size="12" />
      </button>
      <button
        class="icon-btn"
        :disabled="!active || !!active.mask"
        :title="runner?.selection ? 'Add a layer mask from the selection' : 'Add a layer mask'"
        @click="active && runner?.addMask(active.id)"
      >
        <Icon :icon="faMask" :size="12" />
      </button>
      <button class="icon-btn" title="More layer actions" @click="openMenu">
        <Icon :icon="faEllipsisVertical" :size="12" />
      </button>
    </div>

    <template v-if="active">
      <div class="row props">
        <select :value="active.blend" title="Blend mode" @change="onBlend">
          <option v-for="m in BLEND_MODES" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
        <input
          type="range"
          min="0"
          max="100"
          :value="Math.round(active.opacity * 100)"
          title="Opacity"
          @input="onOpacityInput($event, false)"
          @change="onOpacityInput($event, true)"
        />
        <span class="pct">{{ Math.round(active.opacity * 100) }}%</span>
      </div>
      <div class="row props">
        <button
          class="toggle"
          :class="{ on: active.alphaLock }"
          title="Lock transparent pixels — painting only recolours what's already there"
          @click="runner?.setLayerProps(active.id, { alphaLock: !active.alphaLock })"
        >
          <Icon :icon="faLock" :size="11" /> Alpha
        </button>
        <button
          class="toggle"
          :class="{ on: active.clip }"
          title="Clip to the layer below — only shows where that layer has pixels"
          @click="runner?.setLayerProps(active.id, { clip: !active.clip })"
        >
          <Icon :icon="faArrowTurnDown" :size="11" /> Clip
        </button>
        <span class="spacer" />
        <button class="icon-btn" :disabled="activeIndexFromTop <= 0" title="Move layer up" @click="runner?.moveLayer(active.id, 1)">
          <Icon :icon="faArrowUp" :size="11" />
        </button>
        <button
          class="icon-btn"
          :disabled="activeIndexFromTop >= layers.length - 1"
          title="Move layer down"
          @click="runner?.moveLayer(active.id, -1)"
        >
          <Icon :icon="faArrowDown" :size="11" />
        </button>
        <button class="icon-btn" :disabled="layers.length <= 1" title="Delete layer" @click="runner?.removeLayer(active.id)">
          <Icon :icon="faTrash" :size="11" />
        </button>
      </div>
    </template>

    <ul class="list">
      <li
        v-for="l in layers"
        :key="l.id"
        class="layer"
        :class="{ active: l.active, hidden: !l.visible, clipped: l.clip }"
      >
        <button class="eye" :title="l.visible ? 'Hide layer' : 'Show layer'" @click="toggleVisible(l.id, l.visible)">
          <Icon :icon="l.visible ? faEye : faEyeSlash" :size="12" />
        </button>
        <span v-if="l.clip" class="clip-mark" title="Clipped to the layer below">↳</span>
        <button
          class="thumb-btn"
          :class="{ target: l.active && !(store.editMask && l.mask) }"
          title="Paint on this layer (Ctrl+click: select its pixels)"
          @click="select(l.id, $event)"
        >
          <LayerThumb :data="l.data" :tick="tick" />
        </button>
        <button
          v-if="l.mask"
          class="thumb-btn mask"
          :class="{ target: l.active && store.editMask, off: !l.maskEnabled }"
          title="Paint on the mask — black hides, white shows (Alt+click: view mask, Shift+click: disable)"
          @click="selectMask(l.id, $event)"
        >
          <LayerThumb :data="l.mask" :tick="tick" />
        </button>
        <div class="meta" @click="select(l.id, $event)" @dblclick="startRename(l.id, l.name)">
          <input
            v-if="renamingId === l.id"
            :ref="setRenameInput"
            v-model="renameText"
            class="rename"
            @click.stop
            @blur="commitRename"
            @keydown.enter="commitRename"
            @keydown.escape="renamingId = null"
          />
          <template v-else>
            <span class="name">{{ l.name }}</span>
            <span class="sub">
              <template v-if="l.blend !== 'normal'">{{ BLEND_MODES.find((m) => m.id === l.blend)?.label }} · </template>{{ Math.round(l.opacity * 100) }}%<template v-if="l.alphaLock"> · α</template>
            </span>
          </template>
        </div>
      </li>
    </ul>
    <p v-if="store.editMask && active?.mask" class="hint">Painting on the mask — black hides, white reveals, grays fade.</p>

    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menu.items" @close="menu = null" />
  </div>
</template>

<style scoped>
.layers-panel {
  padding: 10px;
}
.head {
  gap: 3px;
  margin-bottom: 6px;
}
.icon-btn {
  width: 26px;
  padding: 0;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.props {
  gap: 4px;
  margin-bottom: 6px;
}
.props select {
  flex: none;
  width: 96px;
  font-size: 12px;
}
.props input[type='range'] {
  flex: 1;
  min-width: 0;
}
.pct {
  width: 34px;
  flex: none;
  text-align: right;
  font-size: 11px;
  color: var(--text-dim);
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  font-size: 11px;
}
.toggle.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow: auto;
}
.layer {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  margin-bottom: 2px;
}
.layer.active {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.layer.hidden .meta,
.layer.hidden .thumb-btn {
  opacity: 0.45;
}
.eye {
  width: 22px;
  height: 22px;
  padding: 0;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
}
.clip-mark {
  flex: none;
  font-size: 12px;
  color: var(--text-dim);
}
.thumb-btn {
  padding: 1px;
  flex: none;
  background: none;
  border: 2px solid transparent;
  border-radius: 4px;
  display: inline-flex;
}
.thumb-btn.target {
  border-color: var(--accent);
}
.thumb-btn.mask.off {
  position: relative;
  opacity: 0.5;
}
.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  cursor: default;
  user-select: none;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.sub {
  font-size: 10px;
  color: var(--text-dim);
}
.rename {
  width: 100%;
  font-size: 12px;
}
.hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-dim);
}
</style>
