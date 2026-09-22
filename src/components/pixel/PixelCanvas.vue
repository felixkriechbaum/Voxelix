<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PixelRenderer } from '@/pixel/PixelRenderer';
import { PixelRunner } from '@/editor/pixel/PixelRunner';
import { setPixelSession } from '@/editor/pixel/session';
import { usePixelStore } from '@/stores/pixel';
import { brushBox } from '@/core/pixel/brush';

const store = usePixelStore();
const canvas = ref<HTMLCanvasElement | null>(null);
let renderer: PixelRenderer | null = null;
let runner: PixelRunner | null = null;
let raf = 0;

function frame() {
  if (renderer && runner) {
    const widget = store.activeWidget();
    const cursor = runner.getCursor();
    renderer.render({
      zoom: store.zoom,
      showGrid: store.showGrid,
      patch: widget && hasPatch(widget.patch) ? widget.patch : null,
      selection: runner.selection,
      cursor: cursor ? brushBox(cursor.x, cursor.y, store.brushSize) : null,
    });
  }
  raf = requestAnimationFrame(frame);
}

function hasPatch(p: { left: number; top: number; right: number; bottom: number }): boolean {
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

function onDown(e: PointerEvent) {
  canvas.value?.setPointerCapture(e.pointerId);
  runner?.pointerDown(e);
}
function onMove(e: PointerEvent) {
  runner?.pointerMove(e);
}
function onUp(e: PointerEvent) {
  runner?.pointerUp(e);
}
function onLeave() {
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
