import { sliceNinePatch } from '@/core/pixel/ninepatch';
import type { NinePatch } from '@/core/pixel/types';

/** Draws a source image into a destination box, corners fixed and edges/middle stretched. */
export function paintNinePatch(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  srcSize: { w: number; h: number },
  patch: NinePatch,
  dest: { x: number; y: number; w: number; h: number },
  scale: number,
): void {
  const quads = sliceNinePatch(srcSize, patch, { w: dest.w, h: dest.h });
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  for (const q of quads) {
    ctx.drawImage(
      src,
      q.sx,
      q.sy,
      q.sw,
      q.sh,
      (dest.x + q.dx) * scale,
      (dest.y + q.dy) * scale,
      q.dw * scale,
      q.dh * scale,
    );
  }
  ctx.imageSmoothingEnabled = prevSmoothing;
}
