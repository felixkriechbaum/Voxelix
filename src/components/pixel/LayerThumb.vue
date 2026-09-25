<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PixelData } from '@/core/pixel/PixelData';
import { blitPixelData } from '@/pixel/blit';

/** A layer (or mask) preview, redrawn only when its buffer's revision moved. `tick` is any counter that bumps after edits. */
const props = defineProps<{ data: PixelData; tick: number; size?: number }>();

const canvas = ref<HTMLCanvasElement | null>(null);
let drawn: { data: PixelData; rev: number } | null = null;
let pending = 0;
const scratch = document.createElement('canvas');

function draw() {
  pending = 0;
  const c = canvas.value;
  const data = props.data;
  if (!c) return;
  const rev = data.rev;
  if (drawn && drawn.data === data && drawn.rev === rev) return;
  const box = props.size ?? 34;
  const scale = Math.min(box / data.width, box / data.height);
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(data.width * scale));
  const h = Math.max(1, Math.round(data.height * scale));
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const sctx = scratch.getContext('2d');
  const ctx = c.getContext('2d');
  if (!sctx || !ctx) return;
  scratch.width = data.width;
  scratch.height = data.height;
  blitPixelData(sctx, data);
  ctx.clearRect(0, 0, c.width, c.height);
  // pixel-sharp when enlarging a small icon, smoothed when shrinking a big texture
  ctx.imageSmoothingEnabled = scale * dpr < 1;
  ctx.drawImage(scratch, 0, 0, c.width, c.height);
  drawn = { data, rev };
}

function schedule() {
  if (!pending) pending = requestAnimationFrame(draw);
}

watch(() => [props.data, props.tick], schedule);
onMounted(draw);
onBeforeUnmount(() => cancelAnimationFrame(pending));
</script>

<template>
  <span class="thumb" :style="{ width: `${size ?? 34}px`, height: `${size ?? 34}px` }">
    <canvas ref="canvas" />
  </span>
</template>

<style scoped>
.thumb {
  flex: none;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 3px;
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  overflow: hidden;
}
canvas {
  image-rendering: pixelated;
  display: block;
}
</style>
