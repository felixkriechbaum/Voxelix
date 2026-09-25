import type { PixelData, PixelRect } from '@/core/pixel/PixelData';

/**
 * Copy a PixelData's pixels onto a 2D context sized to match it. Goes through
 * createImageData().data.set() rather than `new ImageData(buffer, ...)` — the
 * latter wants a plain ArrayBuffer-backed view, and this project's WebWorker +
 * DOM lib combination types typed-array buffers as the wider ArrayBufferLike
 * (see CLAUDE.md's note on strict typed-array generics).
 */
export function blitPixelData(ctx: CanvasRenderingContext2D, data: PixelData): void {
  const imgData = ctx.createImageData(data.width, data.height);
  imgData.data.set(data.asImageBuffer());
  ctx.putImageData(imgData, 0, 0);
}

/** Copy just a sub-rect — how the canvas keeps up with a brush stroke on a large texture. */
export function blitPixelRect(ctx: CanvasRenderingContext2D, data: PixelData, r: PixelRect): void {
  if (r.w <= 0 || r.h <= 0) return;
  const imgData = ctx.createImageData(r.w, r.h);
  imgData.data.set(data.rectImageBuffer(r));
  ctx.putImageData(imgData, r.x, r.y);
}
