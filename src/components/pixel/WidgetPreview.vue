<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, watch, type ComponentPublicInstance } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { blitPixelData } from '@/pixel/blit';
import { paintNinePatch } from '@/pixel/NinePatchPainter';
import { minDrawSize } from '@/core/pixel/ninepatch';
import {
  previewExpanded,
  previewVariants,
  previewWidth,
  previewResizing,
  addPreviewVariant,
  removePreviewVariant,
  setPreviewWidth,
} from '@/editor/pixel/previewPrefs';
import Icon from '@/components/Icon.vue';
import { faChevronRight, faChevronLeft, faPlus, faXmark } from '@fortawesome/pro-solid-svg-icons';

const store = usePixelStore();

let dragStartX = 0;
let dragStartWidth = 0;

function onHandleDown(e: PointerEvent) {
  dragStartX = e.clientX;
  dragStartWidth = previewWidth.value;
  previewResizing.value = true;
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', onHandleMove);
  window.addEventListener('pointerup', onHandleUp);
}
function onHandleMove(e: PointerEvent) {
  // the panel sits on the right, so dragging its left edge leftward (cursor
  // moves left of the start point) should grow it, not shrink it
  setPreviewWidth(dragStartWidth + (dragStartX - e.clientX));
}
function onHandleUp() {
  previewResizing.value = false;
  document.body.style.userSelect = '';
  window.removeEventListener('pointermove', onHandleMove);
  window.removeEventListener('pointerup', onHandleUp);
}
onBeforeUnmount(onHandleUp);

let srcCanvas: HTMLCanvasElement | null = null;
const canvases = new Map<string, HTMLCanvasElement>();

function setSrcCanvas(el: Element | ComponentPublicInstance | null) {
  srcCanvas = el instanceof HTMLCanvasElement ? el : null;
}
function setVariantCanvas(id: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLCanvasElement) canvases.set(id, el);
  else canvases.delete(id);
}

function redraw() {
  const w = store.activeWidget();
  if (!w || !srcCanvas) return;
  const data = w.stateData(store.activeStateId);
  if (srcCanvas.width !== data.width || srcCanvas.height !== data.height) {
    srcCanvas.width = data.width;
    srcCanvas.height = data.height;
  }
  const sctx = srcCanvas.getContext('2d');
  if (!sctx) return;
  blitPixelData(sctx, data);

  const srcSize = { w: data.width, h: data.height };
  for (const v of previewVariants.value) {
    const canvas = canvases.get(v.id);
    if (!canvas) continue;
    const zoom = Math.max(1, Math.round(v.zoom));
    const pxW = Math.max(1, Math.round(v.w)) * zoom;
    const pxH = Math.max(1, Math.round(v.h)) * zoom;
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.clearRect(0, 0, pxW, pxH);
    paintNinePatch(ctx, srcCanvas, srcSize, w.patch, { x: 0, y: 0, w: v.w, h: v.h }, zoom);
  }
}

function warnFor(v: { w: number; h: number }) {
  // called from the template, so this read makes the render effect depend on
  // structureVersion — needed because widget.patch below is a plain mutable
  // field on the markRaw'd project graph, not reactive on its own (same
  // gotcha as NinePatchPanel.vue's `widget` computed)
  void store.structureVersion;
  const widget = store.activeWidget();
  if (!widget) return false;
  const min = minDrawSize(widget.patch);
  return v.w < min.w || v.h < min.h;
}

function addVariant() {
  const w = store.activeWidget();
  addPreviewVariant(w ? { w: w.width, h: w.height } : undefined);
}

watch(
  () => [store.structureVersion, store.activeVersion, store.editVersion, previewVariants.value],
  () => nextTick(redraw),
  { deep: true },
);
onMounted(() => nextTick(redraw));
</script>

<template>
  <aside class="preview-pane panel" :class="{ collapsed: !previewExpanded }">
    <div v-if="previewExpanded" class="handle" title="Drag to resize" @pointerdown="onHandleDown" />
    <button
      class="toggle"
      :title="previewExpanded ? 'Collapse preview' : 'Expand preview'"
      @click="previewExpanded = !previewExpanded"
    >
      <Icon :icon="previewExpanded ? faChevronRight : faChevronLeft" :size="12" />
    </button>

    <div v-if="previewExpanded" class="body">
      <h3>Preview</h3>
      <canvas :ref="setSrcCanvas" class="hidden-src" />

      <div v-for="v in previewVariants" :key="v.id" class="variant">
        <div class="row head">
          <input v-model="v.label" class="label-input" />
          <button class="del" title="Remove" @click="removePreviewVariant(v.id)">
            <Icon :icon="faXmark" :size="11" />
          </button>
        </div>
        <div class="row dims">
          <label>W<input v-model.number="v.w" type="number" min="1" /></label>
          <label>H<input v-model.number="v.h" type="number" min="1" /></label>
          <label>Zoom<input v-model.number="v.zoom" type="number" min="1" max="16" /></label>
        </div>
        <span v-if="warnFor(v)" class="warn" title="Smaller than the patch's fixed borders — Godot will scale the whole patch down instead of respecting it">
          ⚠ smaller than the patch borders
        </span>
        <div class="frame">
          <canvas :ref="(el) => setVariantCanvas(v.id, el)" />
        </div>
      </div>

      <button class="add" @click="addVariant">
        <Icon :icon="faPlus" :size="11" /> Add variant
      </button>
    </div>
  </aside>
</template>

<style scoped>
.preview-pane {
  position: relative;
  height: 100%;
  overflow: hidden;
  display: flex;
  border-radius: 0;
  border-width: 0 0 0 1px;
}
.preview-pane.collapsed {
  align-items: flex-start;
}
.handle {
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: col-resize;
  z-index: 1;
  touch-action: none;
}
.handle:hover,
.handle:active {
  background: var(--accent-soft);
}
.toggle {
  flex: none;
  height: 32px;
  width: 24px;
  padding: 0;
  margin: 8px 5px;
  border-radius: var(--radius-sm);
}
.body {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 10px 10px 10px 0;
}
.hidden-src {
  display: none;
}
.variant {
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.head {
  gap: 6px;
  margin-bottom: 4px;
}
.label-input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 3px 6px;
}
.del {
  width: 22px;
  height: 22px;
  padding: 0;
  flex: none;
}
.dims {
  gap: 6px;
  margin-bottom: 4px;
}
.dims label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  color: var(--text-dim);
}
.dims input {
  min-width: 0;
  padding: 3px 4px;
  font-size: 12px;
}
.warn {
  display: block;
  font-size: 11px;
  color: var(--warn);
  margin-bottom: 4px;
}
.frame {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 6px;
  background: var(--surface-0);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  overflow: auto;
}
.frame canvas {
  image-rendering: pixelated;
}
.add {
  width: 100%;
  font-size: 12px;
}
</style>
