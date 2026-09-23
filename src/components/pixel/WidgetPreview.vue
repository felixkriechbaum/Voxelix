<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, watch, type ComponentPublicInstance } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { blitPixelData } from '@/pixel/blit';
import { paintNinePatch } from '@/pixel/NinePatchPainter';
import { minDrawSize, resolveContentMargins } from '@/core/pixel/ninepatch';
import type { StateId } from '@/core/pixel/types';
import type { PixelWidget } from '@/core/pixel/PixelWidget';
import {
  previewExpanded,
  previewVariants,
  previewWidth,
  previewResizing,
  previewShowDisabled,
  previewText,
  previewTextSize,
  previewTextColor,
  previewShowContent,
  MIN_TEXT_SIZE,
  MAX_TEXT_SIZE,
  setPreviewTextSize,
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
/** keyed by `${variantId}:live` (the interactive one) or `${variantId}:disabled` */
const canvases = new Map<string, HTMLCanvasElement>();

function setSrcCanvas(el: Element | ComponentPublicInstance | null) {
  srcCanvas = el instanceof HTMLCanvasElement ? el : null;
}
function setVariantCanvas(key: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLCanvasElement) canvases.set(key, el);
  else canvases.delete(key);
}

interface Interaction {
  hover: boolean;
  pressed: boolean;
  focused: boolean;
}
/** per-variant pointer/focus state — reactive so the live state-name label
 *  updates in the template; the canvas pixels are repainted imperatively via
 *  redraw() regardless, since that path never goes through Vue's renderer. */
const interactions = reactive(new Map<string, Interaction>());

/** Read-only — safe to call from the template. Never seen yet -> this plain
 *  (non-reactive, never mutated) default, so a brand-new variant just reads
 *  as 'not interacted with' instead of the template writing to reactive
 *  state mid-render. */
const DEFAULT_INTERACTION: Interaction = { hover: false, pressed: false, focused: false };
function getInteraction(variantId: string): Interaction {
  return interactions.get(variantId) ?? DEFAULT_INTERACTION;
}

/** Creates the entry on first use — only called from event handlers / redraw(), never from the template. */
function ensureInteraction(variantId: string): Interaction {
  let i = interactions.get(variantId);
  if (!i) {
    i = { hover: false, pressed: false, focused: false };
    interactions.set(variantId, i);
  }
  return i;
}

/**
 * Which state a real button would be showing right now, given how the mouse/
 * keyboard is interacting with this one preview box — pressed beats hover
 * beats focus beats normal, same priority a real widget resolves them in.
 * Falls back through to 'normal' for any state the widget doesn't have.
 */
function resolveState(w: PixelWidget, interaction: Interaction): StateId {
  const has = (s: StateId) => w.states.has(s);
  if (interaction.pressed && has('pressed')) return 'pressed';
  if (interaction.hover && has('hover')) return 'hover';
  if (interaction.focused && has('focus')) return 'focus';
  return 'normal';
}

function onEnter(id: string) {
  ensureInteraction(id).hover = true;
  nextTick(redraw);
}
function onLeave(id: string) {
  const i = ensureInteraction(id);
  i.hover = false;
  i.pressed = false;
  nextTick(redraw);
}
function onDown(id: string) {
  ensureInteraction(id).pressed = true;
  nextTick(redraw);
}
function onUp(id: string) {
  ensureInteraction(id).pressed = false;
  nextTick(redraw);
}
function onFocus(id: string) {
  ensureInteraction(id).focused = true;
  nextTick(redraw);
}
function onBlur(id: string) {
  ensureInteraction(id).focused = false;
  nextTick(redraw);
}
/** catches a mouseup that happens after the pointer left the canvas (button
 *  released outside it) — otherwise that variant would show 'pressed' forever. */
function onWindowUp() {
  let changed = false;
  for (const i of interactions.values()) {
    if (i.pressed) {
      i.pressed = false;
      changed = true;
    }
  }
  if (changed) nextTick(redraw);
}

function paintOne(w: PixelWidget, srcSize: { w: number; h: number }, canvas: HTMLCanvasElement | undefined, stateId: StateId, v: { w: number; h: number; zoom: number }) {
  if (!canvas || !srcCanvas) return;
  const sctx = srcCanvas.getContext('2d');
  if (!sctx) return;
  const data = w.states.get(stateId) ?? w.states.get('normal');
  if (!data) return;
  if (srcCanvas.width !== data.width || srcCanvas.height !== data.height) {
    srcCanvas.width = data.width;
    srcCanvas.height = data.height;
  }
  blitPixelData(sctx, data);

  const zoom = Math.max(1, Math.round(v.zoom));
  const pxW = Math.max(1, Math.round(v.w)) * zoom;
  const pxH = Math.max(1, Math.round(v.h)) * zoom;
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, pxW, pxH);
  paintNinePatch(ctx, srcCanvas, srcSize, w.patch, { x: 0, y: 0, w: v.w, h: v.h }, zoom);
  paintContent(ctx, w, v, zoom);
}

const CONTENT_OUTLINE = 'rgba(0, 190, 255, 0.9)';
const CONTENT_OUTLINE_OVERFLOW = 'rgba(255, 70, 70, 0.95)';

function textFont(sizePx: number): string {
  return `${sizePx}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Sample text width in widget pixels (unzoomed), for the fit check. */
function measureText(text: string, size: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx || !text) return 0;
  measureCtx.font = textFont(size);
  return measureCtx.measureText(text).width;
}

/** Content rect (widget pixels) a Godot control lays its label out in: the
 *  box minus the resolved content margins. May be zero/negative-sized. */
function contentRect(w: PixelWidget, v: { w: number; h: number }) {
  const m = resolveContentMargins(w.patch, w.contentMargins);
  return { x: m.left, y: m.top, w: v.w - m.left - m.right, h: v.h - m.top - m.bottom, margins: m };
}

/**
 * Smallest box that holds the sample text inside the content margins — what
 * Godot's Button would grow its minimum size to. null when the text fits.
 */
function textOverflow(v: { w: number; h: number }): { w: number; h: number } | null {
  void store.structureVersion; // see warnFor — patch/margins aren't reactive
  const w = store.activeWidget();
  const text = previewText.value;
  if (!w || !text) return null;
  const { margins: m } = contentRect(w, v);
  const needW = Math.ceil(measureText(text, previewTextSize.value)) + m.left + m.right;
  const needH = previewTextSize.value + m.top + m.bottom;
  return v.w < needW || v.h < needH ? { w: needW, h: needH } : null;
}

function paintContent(ctx: CanvasRenderingContext2D, w: PixelWidget, v: { w: number; h: number }, zoom: number) {
  const r = contentRect(w, v);
  const text = previewText.value;
  const overflow = textOverflow(v) !== null;

  if (text) {
    // centred on the content rect, like Button's default alignment; drawn
    // unclipped so an overflow is visible rather than silently cut off
    ctx.save();
    ctx.font = textFont(previewTextSize.value * zoom);
    ctx.fillStyle = previewTextColor.value;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, (r.x + r.w / 2) * zoom, (r.y + r.h / 2) * zoom);
    ctx.restore();
  }

  if (previewShowContent.value && r.w > 0 && r.h > 0) {
    ctx.save();
    ctx.strokeStyle = overflow ? CONTENT_OUTLINE_OVERFLOW : CONTENT_OUTLINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    // +0.5 puts the 1px line on pixel centres (crisp), inset so it sits inside the rect
    ctx.strokeRect(r.x * zoom + 0.5, r.y * zoom + 0.5, r.w * zoom - 1, r.h * zoom - 1);
    ctx.restore();
  }
}

function redraw() {
  const w = store.activeWidget();
  if (!w || !srcCanvas) return;
  const srcSize = { w: w.width, h: w.height };

  for (const v of previewVariants.value) {
    paintOne(w, srcSize, canvases.get(`${v.id}:live`), resolveState(w, getInteraction(v.id)), v);
    if (previewShowDisabled.value && w.states.has('disabled')) {
      paintOne(w, srcSize, canvases.get(`${v.id}:disabled`), 'disabled', v);
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
    previewText.value,
    previewTextSize.value,
    previewTextColor.value,
    previewShowContent.value,
  ],
  () => nextTick(redraw),
  { deep: true },
);
onMounted(() => {
  nextTick(redraw);
  window.addEventListener('mouseup', onWindowUp);
});
onBeforeUnmount(() => window.removeEventListener('mouseup', onWindowUp));
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
      <div class="row text-row">
        <input
          v-model="previewText"
          type="text"
          class="text-input"
          placeholder="Sample text"
          title="Drawn into every variant's content area, to check the content margins"
        />
        <input
          type="number"
          class="size-input"
          :min="MIN_TEXT_SIZE"
          :max="MAX_TEXT_SIZE"
          :value="previewTextSize"
          title="Text size in pixels"
          @change="setPreviewTextSize(Number(($event.target as HTMLInputElement).value))"
        />
        <input v-model="previewTextColor" type="color" class="color-input" title="Text colour" />
      </div>
      <label class="show-content" title="Outline the content area (box minus content margins)">
        <input v-model="previewShowContent" type="checkbox" /> show content area
      </label>
      <canvas :ref="setSrcCanvas" class="hidden-src" />

      <template v-if="store.activeWidget()">
        <div v-for="v in previewVariants" :key="v.id" class="variant">
          <div class="row head">
            <input v-model="v.label" type="text" class="label-input" />
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
          <span
            v-if="textOverflow(v)"
            class="warn"
            title="Godot's Button would grow its minimum size to fit the text plus content margins"
          >
            ⚠ text needs {{ textOverflow(v)!.w }}×{{ textOverflow(v)!.h }}
          </span>
          <div class="states-wrap">
            <div class="state-slot">
              <span class="state-label">{{ resolveState(store.activeWidget()!, getInteraction(v.id)) }}</span>
              <div
                class="frame live"
                tabindex="0"
                title="Hover, press or tab to this box to preview that state"
                @mouseenter="onEnter(v.id)"
                @mouseleave="onLeave(v.id)"
                @mousedown="onDown(v.id)"
                @mouseup="onUp(v.id)"
                @focus="onFocus(v.id)"
                @blur="onBlur(v.id)"
              >
                <canvas :ref="(el) => setVariantCanvas(`${v.id}:live`, el)" />
              </div>
            </div>
            <div v-if="previewShowDisabled && store.activeWidget()!.states.has('disabled')" class="state-slot">
              <span class="state-label">disabled</span>
              <div class="frame">
                <canvas :ref="(el) => setVariantCanvas(`${v.id}:disabled`, el)" />
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
.text-row {
  gap: 4px;
  margin-bottom: 4px;
}
.text-input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 3px 6px;
}
.size-input {
  width: 44px;
  flex: none;
  font-size: 12px;
  padding: 3px 4px;
}
.color-input {
  width: 26px;
  height: 24px;
  flex: none;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: none;
  cursor: pointer;
}
.show-content {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
  margin-bottom: 10px;
}
.show-content input {
  margin: 0;
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
.frame.live {
  cursor: pointer;
}
.frame.live:hover {
  border-color: var(--line-strong);
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
