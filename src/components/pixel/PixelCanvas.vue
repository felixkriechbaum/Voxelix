<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PixelRenderer } from '@/pixel/PixelRenderer';
import { PixelRunner } from '@/editor/pixel/PixelRunner';
import { setPixelSession } from '@/editor/pixel/session';
import { usePixelStore } from '@/stores/pixel';
import { brushBox } from '@/core/pixel/brush';
import { setPatchField } from '@/core/pixel/ninepatch';
import type { NinePatch } from '@/core/pixel/types';

const store = usePixelStore();
const canvas = ref<HTMLCanvasElement | null>(null);
let renderer: PixelRenderer | null = null;
let runner: PixelRunner | null = null;
let raf = 0;

/** Which nine-patch guide (if any) is currently being dragged — takes over pointer input from the paint tool. */
let draggingGuide: keyof NinePatch | null = null;
/** A paint stroke is in progress — while true, guide hit-testing is skipped so a
 *  drag that happens to cross a patch line doesn't get cut short. */
let paintActive = false;

function frame() {
  if (renderer && runner) {
    const widget = store.activeWidget();
    const cursor = runner.getCursor();
    // onion-skin the 'normal' state faintly under whatever else you're
    // editing — hover/pressed/disabled/focus are usually built as small
    // variations of it, so it's a reference to paint on top of, not blind
    const onion = widget && store.activeStateId !== 'normal' ? (widget.states.get('normal') ?? null) : null;
    renderer.render({
      zoom: store.zoom,
      showGrid: store.showGrid,
      patch: widget && hasPatch(widget.patch) ? widget.patch : null,
      selection: runner.selection,
      cursor: cursor ? brushBox(cursor.x, cursor.y, store.brushSize) : null,
      onion,
    });
  }
  raf = requestAnimationFrame(frame);
}

function hasPatch(p: NinePatch): boolean {
  return p.left > 0 || p.top > 0 || p.right > 0 || p.bottom > 0;
}

watch(
  () => store.toolId,
  (id) => runner?.setTool(id),
);
watch(
  () => [store.activeWidgetId, store.activeStateId],
  () => runner?.syncActive(),
);

function guideCursor(edge: keyof NinePatch | null): string {
  if (edge === 'left' || edge === 'right') return 'ew-resize';
  if (edge === 'top' || edge === 'bottom') return 'ns-resize';
  return '';
}

function onDown(e: PointerEvent) {
  const widget = store.activeWidget();
  const edge = widget && renderer ? renderer.hitGuide(e.clientX, e.clientY, store.zoom, widget.patch) : null;
  canvas.value?.setPointerCapture(e.pointerId);
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
  const widget = store.activeWidget();
  const cell = renderer?.toCellClamped(e.clientX, e.clientY, store.zoom);
  if (!widget || !cell || !draggingGuide) return;
  // left/top are measured from the near edge; right/bottom from the far edge
  const value =
    draggingGuide === 'left' || draggingGuide === 'right'
      ? draggingGuide === 'left'
        ? cell.x
        : widget.width - cell.x
      : draggingGuide === 'top'
        ? cell.y
        : widget.height - cell.y;
  store.setPatch(setPatchField(widget.patch, draggingGuide, value, { w: widget.width, h: widget.height }));
}

function onMove(e: PointerEvent) {
  if (draggingGuide) {
    dragGuideTo(e);
    return;
  }
  // a paint stroke already in progress owns the pointer until release — even
  // if the drag path happens to cross a patch guide line, it must keep
  // painting rather than get cut short by guide hover handling
  if (paintActive) {
    runner?.pointerMove(e);
    return;
  }
  const widget = store.activeWidget();
  const hover = widget && renderer ? renderer.hitGuide(e.clientX, e.clientY, store.zoom, widget.patch) : null;
  if (canvas.value) canvas.value.style.cursor = guideCursor(hover);
  if (hover) {
    runner?.pointerLeave(); // don't leave a brush-footprint cursor box under the guide
    return;
  }
  runner?.pointerMove(e);
}

function onUp(e: PointerEvent) {
  if (draggingGuide) {
    draggingGuide = null;
    return;
  }
  paintActive = false;
  runner?.pointerUp(e);
}
function onLeave() {
  if (draggingGuide) return;
  paintActive = false;
  runner?.pointerLeave();
}

onMounted(() => {
  if (!canvas.value) return;
  renderer = new PixelRenderer(canvas.value);
  runner = new PixelRunner(renderer, store);
  setPixelSession(runner);
  canvas.value.addEventListener('pointerdown', onDown);
  canvas.value.addEventListener('pointermove', onMove);
  canvas.value.addEventListener('pointerup', onUp);
  canvas.value.addEventListener('pointerleave', onLeave);
  raf = requestAnimationFrame(frame);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  canvas.value?.removeEventListener('pointerdown', onDown);
  canvas.value?.removeEventListener('pointermove', onMove);
  canvas.value?.removeEventListener('pointerup', onUp);
  canvas.value?.removeEventListener('pointerleave', onLeave);
  renderer?.dispose();
  setPixelSession(null);
});
</script>

<template>
  <div class="stage">
    <canvas ref="canvas" class="pixel-canvas" @contextmenu.prevent />
  </div>
</template>

<style scoped>
.stage {
  height: 100%;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    linear-gradient(var(--surface-0), var(--surface-0));
}
.pixel-canvas {
  image-rendering: pixelated;
  touch-action: none;
  box-shadow: var(--shadow);
  border: 1px solid var(--line);
}
</style>
