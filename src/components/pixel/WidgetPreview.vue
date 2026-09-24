<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, watch, type ComponentPublicInstance } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { specFor } from '@/core/pixel/widgets';
import {
  beginPreviewPass,
  disabledSlotLabel,
  listRowRects,
  paintWidgetPreview,
  scrollValueAt,
  sliderValueAt,
  tabRects,
  type PreviewInput,
} from '@/pixel/widgetPreview';
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
  type PreviewVariant,
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

/**
 * Each variant shows a live, interactive copy ('live'), for a CheckBox with
 * painted radio icons a second interactive one ('radio'), and optionally a
 * static disabled / read-only copy.
 */
type SlotId = 'live' | 'radio' | 'disabled';
interface Slot {
  id: SlotId;
  interactive: boolean;
}

/** keyed by `${variantId}:${slot}` */
const canvases = new Map<string, HTMLCanvasElement>();
function setVariantCanvas(key: string, el: Element | ComponentPublicInstance | null) {
  if (el instanceof HTMLCanvasElement) canvases.set(key, el);
  else canvases.delete(key);
}

type Interaction = Omit<PreviewInput, 'disabled' | 'radio'>;
function freshInteraction(): Interaction {
  return { hover: false, pressed: false, focused: false, checked: false, value: 0.6, selected: 0, pointer: null };
}
/** per-slot pointer/focus/value state. Not reactive: the canvases are
 *  repainted imperatively and the labels/warnings they produce land in
 *  `results` below, which is. */
const interactions = new Map<string, Interaction>();
function interaction(key: string): Interaction {
  let i = interactions.get(key);
  if (!i) {
    i = freshInteraction();
    interactions.set(key, i);
  }
  return i;
}

/** what each slot's last paint showed — its state label, and (live slot) warnings */
const results = reactive(new Map<string, { label: string; warnings: string[] }>());

const activeType = computed(() => {
  void store.activeVersion;
  void store.structureVersion;
  return store.activeWidget()?.type ?? null;
});

const slots = computed<Slot[]>(() => {
  void store.editVersion;
  const w = activeType.value ? store.activeWidget() : null;
  if (!w) return [];
  const list: Slot[] = [{ id: 'live', interactive: true }];
  if (w.type === 'checkbox' && w.element('radio')?.states.get('radio_unchecked')?.bounds() != null) {
    list.push({ id: 'radio', interactive: true });
  }
  if (previewShowDisabled.value && disabledSlotLabel(w)) list.push({ id: 'disabled', interactive: false });
  return list;
});

const disabledLabel = computed(() => {
  void store.editVersion;
  const w = activeType.value ? store.activeWidget() : null;
  return w ? disabledSlotLabel(w) : null;
});

/** One-line how-to for the live box, per preview layout. */
const interactionHint = computed(() => {
  if (!activeType.value) return '';
  switch (specFor(activeType.value).preview) {
    case 'toggle':
      return 'Click to toggle, hover / tab for the other states';
    case 'hslider':
    case 'vslider':
    case 'hscroll':
    case 'vscroll':
    case 'progress':
    case 'textureprogress':
      return 'Drag to change the value';
    case 'tabs':
    case 'list':
      return 'Hover and click entries; tab in for focus';
    default:
      return 'Hover, press or tab to this box to preview that state';
  }
});

function pointerIn(e: PointerEvent | MouseEvent, key: string, v: PreviewVariant) {
  const canvas = canvases.get(key);
  if (!canvas) return null;
  const r = canvas.getBoundingClientRect();
  const zoom = Math.max(1, Math.round(v.zoom));
  return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
}

/** Range widgets: the pointer position sets the value (a drag, like the real control). */
function applyValue(key: string, v: PreviewVariant) {
  const w = store.activeWidget();
  const i = interaction(key);
  if (!w || !i.pointer) return;
  const size = { w: Math.round(v.w), h: Math.round(v.h) };
  switch (specFor(w.type).preview) {
    case 'hslider':
    case 'vslider':
      i.value = sliderValueAt(w, size, i.pointer);
      break;
    case 'hscroll':
    case 'vscroll':
      i.value = scrollValueAt(w, size, i.pointer);
      break;
    case 'progress':
    case 'textureprogress':
      i.value = Math.min(1, Math.max(0, i.pointer.x / Math.max(1, size.w)));
      break;
  }
}

function onPointerMove(e: PointerEvent, key: string, v: PreviewVariant) {
  const i = interaction(key);
  i.hover = true;
  i.pointer = pointerIn(e, key, v);
  if (i.pressed) applyValue(key, v);
  nextTick(redraw);
}
function onPointerLeave(key: string) {
  const i = interaction(key);
  i.hover = false;
  i.pointer = null;
  nextTick(redraw);
}
function onPointerDown(e: PointerEvent, key: string, v: PreviewVariant) {
  const i = interaction(key);
  i.pressed = true;
  i.pointer = pointerIn(e, key, v);
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  applyValue(key, v);
  nextTick(redraw);
}
function onPointerUp(e: PointerEvent, key: string, v: PreviewVariant) {
  const i = interaction(key);
  const w = store.activeWidget();
  if (i.pressed && w) {
    const p = pointerIn(e, key, v);
    const layout = specFor(w.type).preview;
    if (layout === 'toggle') i.checked = !i.checked;
    else if (layout === 'tabs' && p) {
      const names = [previewText.value || 'Tab 1', 'Tab 2', 'Tab 3'];
      const hit = tabRects(w, previewTextSize.value, names).findIndex((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
      if (hit >= 0) i.selected = hit;
    } else if (layout === 'list' && p) {
      const rows = listRowRects(w, { w: v.w, h: v.h }, previewTextSize.value, previewText.value);
      const hit = rows.findIndex((r) => p.y >= r.y && p.y < r.y + r.h);
      if (hit >= 0) i.selected = hit;
    }
  }
  i.pressed = false;
  nextTick(redraw);
}
function onFocus(key: string) {
  interaction(key).focused = true;
  nextTick(redraw);
}
function onBlur(key: string) {
  const i = interaction(key);
  i.focused = false;
  i.pressed = false;
  nextTick(redraw);
}

function paintSlot(v: PreviewVariant, slot: SlotId) {
  const w = store.activeWidget();
  const key = `${v.id}:${slot}`;
  const canvas = canvases.get(key);
  if (!w || !canvas) return;
  const zoom = Math.max(1, Math.round(v.zoom));
  const bw = Math.max(1, Math.round(v.w));
  const bh = Math.max(1, Math.round(v.h));
  if (canvas.width !== bw * zoom || canvas.height !== bh * zoom) {
    canvas.width = bw * zoom;
    canvas.height = bh * zoom;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // the disabled copy mirrors the live one's checked/value so the two compare like-for-like
  const source = slot === 'disabled' ? interaction(`${v.id}:live`) : interaction(key);
  const input: PreviewInput = {
    ...source,
    hover: slot === 'disabled' ? false : source.hover,
    pressed: slot === 'disabled' ? false : source.pressed,
    focused: slot === 'disabled' ? false : source.focused,
    pointer: slot === 'disabled' ? null : source.pointer,
    disabled: slot === 'disabled',
    radio: slot === 'radio',
  };
  const res = paintWidgetPreview(ctx, w, { w: bw, h: bh }, zoom, input, {
    text: previewText.value,
    size: previewTextSize.value,
    color: previewTextColor.value,
    showContent: previewShowContent.value,
  });
  const prev = results.get(key);
  if (!prev || prev.label !== res.label || prev.warnings.join('\n') !== res.warnings.join('\n')) results.set(key, res);
}

function redraw() {
  if (!store.activeWidget()) return;
  beginPreviewPass();
  for (const v of previewVariants.value) for (const s of slots.value) paintSlot(v, s.id);
}

function slotLabel(v: PreviewVariant, slot: Slot): string {
  if (slot.id === 'disabled') return disabledLabel.value ?? 'disabled';
  return results.get(`${v.id}:${slot.id}`)?.label ?? '';
}

function warningsFor(v: PreviewVariant): string[] {
  return results.get(`${v.id}:live`)?.warnings ?? [];
}

function addVariant() {
  const el = store.activeWidget()?.elements.values().next().value;
  addPreviewVariant(el ? { w: el.width, h: el.height } : undefined);
}

watch(
  () => [
    store.structureVersion,
    store.activeVersion,
    store.editVersion,
    previewVariants.value,
    slots.value,
    previewText.value,
    previewTextSize.value,
    previewTextColor.value,
    previewShowContent.value,
  ],
  () => nextTick(redraw),
  { deep: true },
);
// a different widget starts from a clean slate (unchecked, default value)
watch(activeType, () => interactions.clear());
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
        <label class="show-disabled" title="Also show a disabled / read-only copy of every variant">
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
          <span v-for="(msg, i) in warningsFor(v)" :key="i" class="warn">⚠ {{ msg }}</span>
          <div class="states-wrap">
            <div v-for="s in slots" :key="s.id" class="state-slot">
              <span class="state-label">{{ slotLabel(v, s) }}</span>
              <div
                v-if="s.interactive"
                class="frame live"
                tabindex="0"
                :title="interactionHint"
                @pointermove="onPointerMove($event, `${v.id}:${s.id}`, v)"
                @pointerleave="onPointerLeave(`${v.id}:${s.id}`)"
                @pointerdown="onPointerDown($event, `${v.id}:${s.id}`, v)"
                @pointerup="onPointerUp($event, `${v.id}:${s.id}`, v)"
                @focus="onFocus(`${v.id}:${s.id}`)"
                @blur="onBlur(`${v.id}:${s.id}`)"
              >
                <canvas :ref="(el) => setVariantCanvas(`${v.id}:${s.id}`, el)" />
              </div>
              <div v-else class="frame">
                <canvas :ref="(el) => setVariantCanvas(`${v.id}:${s.id}`, el)" />
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
