<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PixelRenderer, nextZoom } from '@/pixel/PixelRenderer';
import { PixelRunner } from '@/editor/pixel/PixelRunner';
import { setPixelSession } from '@/editor/pixel/session';
import { importImageBlob } from '@/editor/pixel/importFlow';
import { layerNameFor } from '@/pixel/importImage';
import { usePixelStore } from '@/stores/pixel';
import { setPatchField } from '@/core/pixel/ninepatch';
import { elementSpec } from '@/core/pixel/widgets';
import type { NinePatch } from '@/core/pixel/types';

const store = usePixelStore();
const stage = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const dropping = ref(false);
let renderer: PixelRenderer | null = null;
let runner: PixelRunner | null = null;
let raf = 0;
let resizeObs: ResizeObserver | null = null;

/** Which nine-patch guide (if any) is currently being dragged — takes over pointer input from the paint tool. */
let draggingGuide: keyof NinePatch | null = null;
/** A paint stroke is in progress — while true, guide hit-testing is skipped so a
 *  drag that happens to cross a patch line doesn't get cut short. */
let paintActive = false;
/** Space held (or middle button down): pointer drags pan the view instead of painting. */
const spaceHeld = ref(false);
let panning: { x: number; y: number } | null = null;

const BRUSH_TOOLS = new Set(['pencil', 'eraser', 'line']);

function frame() {
  if (renderer && runner) {
    const el = store.activeElement();
    const cursor = runner.getCursor();
    const brushTool = BRUSH_TOOLS.has(store.toolId);
    renderer.render(runner.displaySource(), {
      zoom: store.zoom,
      showGrid: store.showGrid,
      patch: el && hasPatch(el.patch) && activeKind() !== 'icon' && !store.viewMask ? el.patch : null,
      selection: runner.selection,
      cursor: cursor && !panning ? { ...cursor, size: brushTool ? store.brushSize : 1, shape: brushTool ? store.brushShape : 'square' } : null,
      onion: store.viewMask ? null : onionSource(),
      overlay: runner.overlay,
      maskMode: runner.editingMask,
    });
  }
  raf = requestAnimationFrame(frame);
}

function activeKind() {
  const w = store.activeWidget();
  return w ? (elementSpec(w.type, store.activeElementId)?.kind ?? 'texture') : 'texture';
}

/**
 * Onion-skin what this state falls back to (hover -> normal, checked_disabled
 * -> checked) faintly underneath — variations are usually painted on top of
 * their base, so it's a reference rather than a blank canvas. Overlay states
 * (focus rings) show over the element's base state instead; the base state
 * itself gets none.
 */
function onionSource() {
  const w = store.activeWidget();
  const el = store.activeElement();
  if (!w || !el) return null;
  const es = elementSpec(w.type, el.id);
  const ss = es?.states.find((s) => s.id === store.activeStateId);
  const baseId = ss?.from ?? (ss?.overlay ? es?.states[0]?.id : undefined);
  if (!baseId || baseId === store.activeStateId) return null;
  return w.resolveState(el.id, baseId)?.data ?? el.states.get(baseId)?.composite() ?? null;
}

function hasPatch(p: NinePatch): boolean {
  return p.left > 0 || p.top > 0 || p.right > 0 || p.bottom > 0;
}

/** Zoom so the whole image fits and centre it. */
function fitView() {
  const el = store.activeElement();
  if (!renderer || !el) return;
  store.zoom = renderer.fitZoom(el.width, el.height);
  renderer.center();
}
defineExpose({ fitView });

const activeSize = computed(() => {
  void store.structureVersion;
  void store.activeVersion;
  const el = store.activeElement();
  return el ? `${el.width}x${el.height}` : '';
});

watch(
  () => store.toolId,
  (id) => runner?.setTool(id),
);
watch(
  () => [store.activeWidgetId, store.activeElementId, store.activeStateId],
  () => runner?.syncActive(),
);
// a different part / widget, or a resize, gets a fresh fit — a 1024² texture
// at the 12× a button wants would open as one enormous zoomed-in corner
watch(
  () => [store.activeWidgetId, store.activeElementId, activeSize.value],
  () => fitView(),
);

function guideCursor(edge: keyof NinePatch | null): string {
  if (edge === 'left' || edge === 'right') return 'ew-resize';
  if (edge === 'top' || edge === 'bottom') return 'ns-resize';
  return '';
}

function guideAt(e: PointerEvent): keyof NinePatch | null {
  const el = store.activeElement();
  if (!el || !renderer || activeKind() === 'icon' || store.viewMask || !hasPatch(el.patch)) return null;
  return renderer.hitGuide(e.clientX, e.clientY, el.patch);
}

function onDown(e: PointerEvent) {
  canvas.value?.setPointerCapture(e.pointerId);
  if (e.button === 1 || spaceHeld.value) {
    e.preventDefault();
    panning = { x: e.clientX, y: e.clientY };
    if (canvas.value) canvas.value.style.cursor = 'grabbing';
    runner?.pointerLeave();
    return;
  }
  const edge = guideAt(e);
  if (edge) {
    draggingGuide = edge;
    dragGuideTo(e);
    return;
  }
  paintActive = true;
  if (canvas.value) canvas.value.style.cursor = '';
  runner?.pointerDown(e);
}

function dragGuideTo(e: PointerEvent) {
  const el = store.activeElement();
  if (!el || !renderer || !draggingGuide) return;
  const cell = renderer.toEdgeClamped(e.clientX, e.clientY);
  // left/top are measured from the near edge; right/bottom from the far edge
  const value =
    draggingGuide === 'left'
      ? cell.x
      : draggingGuide === 'right'
        ? el.width - cell.x
        : draggingGuide === 'top'
          ? cell.y
          : el.height - cell.y;
  store.setPatch(setPatchField(el.patch, draggingGuide, value, { w: el.width, h: el.height }));
}

function onMove(e: PointerEvent) {
  if (panning) {
    renderer?.panBy(e.clientX - panning.x, e.clientY - panning.y);
    panning = { x: e.clientX, y: e.clientY };
    return;
  }
  if (draggingGuide) {
    dragGuideTo(e);
    return;
  }
  // a paint stroke already in progress owns the pointer until release — even
  // if the drag path happens to cross a patch guide line
  if (paintActive) {
    runner?.pointerMove(e);
    return;
  }
  const hover = guideAt(e);
  if (canvas.value) canvas.value.style.cursor = spaceHeld.value ? 'grab' : guideCursor(hover);
  if (hover || spaceHeld.value) {
    runner?.pointerLeave(); // don't leave a brush-footprint cursor box under the guide
    return;
  }
  runner?.pointerMove(e);
}

function onUp(e: PointerEvent) {
  if (panning) {
    panning = null;
    if (canvas.value) canvas.value.style.cursor = spaceHeld.value ? 'grab' : '';
    return;
  }
  if (draggingGuide) {
    draggingGuide = null;
    return;
  }
  paintActive = false;
  runner?.pointerUp(e);
}
function onLeave() {
  if (draggingGuide || panning || paintActive) return;
  runner?.pointerLeave();
}

/** Wheel zooms around the pointer (trackpad pinch arrives as ctrl+wheel); Shift+wheel pans sideways. */
function onWheel(e: WheelEvent) {
  if (!renderer) return;
  e.preventDefault();
  if (e.shiftKey && !e.ctrlKey) {
    renderer.panBy(-(e.deltaY || e.deltaX), 0);
    return;
  }
  if (Math.abs(e.deltaY) < 1) return;
  renderer.setZoomAnchor(e.clientX, e.clientY);
  store.zoom = nextZoom(store.zoom, e.deltaY < 0 ? 1 : -1);
}

function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}
function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Space' && !isTyping(e.target)) {
    e.preventDefault();
    if (!spaceHeld.value) {
      spaceHeld.value = true;
      if (canvas.value && !paintActive) canvas.value.style.cursor = 'grab';
    }
  }
}
function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') {
    spaceHeld.value = false;
    if (canvas.value && !panning) canvas.value.style.cursor = '';
  }
}
/** performance.now() of the last time the window lost focus — see onPaste */
let lastBlurAt = -Infinity;
function onBlur() {
  spaceHeld.value = false;
  lastBlurAt = performance.now();
}

// ---- image drop / paste -> new layer ------------------------------------
function onDragOver(e: DragEvent) {
  if (!e.dataTransfer || ![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  dropping.value = true;
}
function onDrop(e: DragEvent) {
  dropping.value = false;
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (!file) return;
  e.preventDefault();
  void importImageBlob(file, layerNameFor(file));
}
/**
 * Ctrl+V. The in-app clipboard (pixels copied in this editor) can't be put on
 * the system clipboard, so which one is "the latest copy" is guessed: an
 * in-app copy made since the window last lost focus wins; otherwise an image
 * on the system clipboard (copied in another app meanwhile) comes in as a
 * new layer.
 */
function onPaste(e: ClipboardEvent) {
  if (isTyping(e.target) || !runner) return;
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  const file = item?.getAsFile();
  const inAppIsNewer = runner.canPaste && runner.clipboardAt > lastBlurAt;
  e.preventDefault();
  if (file && !inAppIsNewer) void importImageBlob(file, 'Pasted image');
  else if (runner.canPaste) runner.pasteSelection();
}

onMounted(() => {
  if (!canvas.value || !stage.value) return;
  renderer = new PixelRenderer(canvas.value);
  const r = stage.value.getBoundingClientRect();
  renderer.resize(r.width, r.height);
  runner = new PixelRunner(renderer, store);
  setPixelSession(runner);
  resizeObs = new ResizeObserver(([entry]) => renderer?.resize(entry.contentRect.width, entry.contentRect.height));
  resizeObs.observe(stage.value);
  canvas.value.addEventListener('pointerdown', onDown);
  canvas.value.addEventListener('pointermove', onMove);
  canvas.value.addEventListener('pointerup', onUp);
  canvas.value.addEventListener('pointerleave', onLeave);
  canvas.value.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('paste', onPaste, true);
  fitView();
  raf = requestAnimationFrame(frame);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  resizeObs?.disconnect();
  canvas.value?.removeEventListener('pointerdown', onDown);
  canvas.value?.removeEventListener('pointermove', onMove);
  canvas.value?.removeEventListener('pointerup', onUp);
  canvas.value?.removeEventListener('pointerleave', onLeave);
  canvas.value?.removeEventListener('wheel', onWheel);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  window.removeEventListener('paste', onPaste, true);
  renderer?.dispose();
  setPixelSession(null);
});
</script>

<template>
  <div
    ref="stage"
    class="stage"
    :class="{ dropping }"
    @dragover="onDragOver"
    @dragleave="dropping = false"
    @drop="onDrop"
  >
    <canvas ref="canvas" class="pixel-canvas" @contextmenu.prevent @auxclick.prevent />
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--surface-0);
}
.stage.dropping {
  outline: 2px dashed var(--accent);
  outline-offset: -6px;
}
.pixel-canvas {
  position: absolute;
  inset: 0;
  display: block;
  touch-action: none;
}
</style>
