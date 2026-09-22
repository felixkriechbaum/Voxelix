<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { blitPixelData } from '@/pixel/blit';
import { paintNinePatch } from '@/pixel/NinePatchPainter';
import { minDrawSize } from '@/core/pixel/ninepatch';

const store = usePixelStore();
const zoom = ref(2);
const zoomLevels = [1, 2, 3, 4];

const srcCanvas = ref<HTMLCanvasElement | null>(null);
const narrowCanvas = ref<HTMLCanvasElement | null>(null);
const wideCanvas = ref<HTMLCanvasElement | null>(null);
const tallCanvas = ref<HTMLCanvasElement | null>(null);

// three representative target sizes: the smallest sane box, a long-label
// button, and a tall one — a one-pixel margin mistake is invisible at the
// widget's own size but jumps out the moment any of these stretch it
const targets = computed(() => {
  void store.structureVersion;
  void store.activeVersion;
  const w = store.activeWidget();
  if (!w) return null;
  const min = minDrawSize(w.patch);
  return {
    min,
    narrow: { w: Math.max(min.w, Math.round(w.width * 0.6)), h: w.height },
    wide: { w: w.width * 2, h: w.height },
    tall: { w: w.width, h: w.height * 2 },
  };
});

function redraw() {
  const w = store.activeWidget();
  const src = srcCanvas.value;
  const t = targets.value;
  if (!w || !src || !t) return;
  const data = w.stateData(store.activeStateId);
  if (src.width !== data.width || src.height !== data.height) {
    src.width = data.width;
    src.height = data.height;
  }
  const sctx = src.getContext('2d');
  if (!sctx) return;
  blitPixelData(sctx, data);

  const srcSize = { w: data.width, h: data.height };
  paintInto(narrowCanvas.value, srcSize, w.patch, t.narrow);
  paintInto(wideCanvas.value, srcSize, w.patch, t.wide);
  paintInto(tallCanvas.value, srcSize, w.patch, t.tall);
}

function paintInto(
  canvas: HTMLCanvasElement | null,
  srcSize: { w: number; h: number },
  patch: { left: number; top: number; right: number; bottom: number },
  target: { w: number; h: number },
) {
  if (!canvas || !srcCanvas.value) return;
  const w = target.w * zoom.value;
  const h = target.h * zoom.value;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  paintNinePatch(ctx, srcCanvas.value, srcSize, patch, { x: 0, y: 0, w: target.w, h: target.h }, zoom.value);
}

watch(
  () => [store.structureVersion, store.activeVersion, store.editVersion, zoom.value],
  () => nextTick(redraw),
  { immediate: false },
);
onMounted(() => nextTick(redraw));
</script>

<template>
  <div class="panel preview-panel">
    <div class="row">
      <h3>Preview</h3>
      <span class="spacer" />
      <select v-model.number="zoom">
        <option v-for="z in zoomLevels" :key="z" :value="z">{{ z }}×</option>
      </select>
    </div>

    <canvas ref="srcCanvas" class="hidden-src" />

    <template v-if="targets">
      <div class="slot">
        <span class="label">
          Narrow
          <span v-if="targets.narrow.w < targets.min.w || targets.narrow.h < targets.min.h" class="warn" title="Smaller than the patch's fixed borders — Godot will scale the whole patch down instead">⚠</span>
        </span>
        <div class="frame"><canvas ref="narrowCanvas" /></div>
      </div>
      <div class="slot">
        <span class="label">Wide</span>
        <div class="frame"><canvas ref="wideCanvas" /></div>
      </div>
      <div class="slot">
        <span class="label">Tall</span>
        <div class="frame"><canvas ref="tallCanvas" /></div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.preview-panel {
  padding: 10px;
}
select {
  font-size: 12px;
}
.hidden-src {
  display: none;
}
.slot {
  margin-top: 8px;
}
.label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 3px;
}
.warn {
  color: var(--warn);
  cursor: help;
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
</style>
