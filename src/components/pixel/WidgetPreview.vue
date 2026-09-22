<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, watch, type ComponentPublicInstance } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { blitPixelData } from '@/pixel/blit';
import { paintNinePatch } from '@/pixel/NinePatchPainter';
import { minDrawSize } from '@/core/pixel/ninepatch';
import { specFor } from '@/core/pixel/widgets';
import type { StateId } from '@/core/pixel/types';
import type { PixelWidget } from '@/core/pixel/PixelWidget';
import {
  previewExpanded,
  previewVariants,
  previewWidth,
  previewResizing,
  previewShowDisabled,
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
/** keyed by `${variantId}:${stateId}` — every variant renders every state */
const canvases = new Map<string, HTMLCanvasElement>();

function setSrcCanvas(el: Element | ComponentPublicInstance | null) {
  srcCanvas = el instanceof HTMLCanvasElement ? el : null;
}
function setVariantCanvas(key: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLCanvasElement) canvases.set(key, el);
  else canvases.delete(key);
}

/**
 * States to preview, in canonical display order, limited to ones the widget
 * actually has — a functioning-button preview needs normal/hover/pressed/
 * focus together; disabled is the one state that isn't core to "does this
 * look right while it works", so it's opt-out via previewShowDisabled.
 */
function previewStates(w: PixelWidget): StateId[] {
  const order = specFor(w.type).states.length ? specFor(w.type).states : (['normal'] as StateId[]);
  return order.filter((s) => w.states.has(s) && (s !== 'disabled' || previewShowDisabled.value));
}

function redraw() {
  const w = store.activeWidget();
  if (!w || !srcCanvas) return;
  const sctx = srcCanvas.getContext('2d');
  if (!sctx) return;

  const srcSize = { w: w.width, h: w.height };
  for (const stateId of previewStates(w)) {
    const data = w.states.get(stateId);
    if (!data) continue;
    if (srcCanvas.width !== data.width || srcCanvas.height !== data.height) {
      srcCanvas.width = data.width;
      srcCanvas.height = data.height;
    }
    blitPixelData(sctx, data);

    for (const v of previewVariants.value) {
      const canvas = canvases.get(`${v.id}:${stateId}`);
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
  () => [
    store.structureVersion,
    store.activeVersion,
    store.editVersion,
    previewVariants.value,
    previewShowDisabled.value,
  ],
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
      <div class="row head-row">
        <h3>Preview</h3>
        <span class="spacer" />
        <label class="show-disabled" title="Include the 'disabled' state in every variant">
          <input v-model="previewShowDisabled" type="checkbox" /> disabled
        </label>
      </div>
      <canvas :ref="setSrcCanvas" class="hidden-src" />

      <template v-if="store.activeWidget()">
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
          <div class="states-wrap">
            <div v-for="s in previewStates(store.activeWidget()!)" :key="s" class="state-slot">
              <span class="state-label">{{ s }}</span>
              <div class="frame">
                <canvas :ref="(el) => setVariantCanvas(`${v.id}:${s}`, el)" />
              </div>
            </div>
          </div>
        </div>
      </template>

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
  /* the plain `button` rule in style.css doesn't centre its content (no
     display:flex) — fine for a single line of text, which browsers centre
     by default, but an <Icon> svg inside sits off-centre without it */
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
.head-row {
  margin-bottom: 8px;
}
.show-disabled {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
}
.show-disabled input {
  margin: 0;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
.states-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.state-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.state-label {
  font-size: 10px;
  color: var(--text-dim);
  text-transform: capitalize;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
</style>
