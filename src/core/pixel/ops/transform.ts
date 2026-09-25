import type { PixelRect } from '@/core/pixel/PixelData';

export type PixelTransform =
  | { kind: 'flipH' }
  | { kind: 'flipV' }
  | { kind: 'rotCW' }
  | { kind: 'rotCCW' }
  | { kind: 'rot180' }
  | { kind: 'scale'; sx: number; sy: number }
  | { kind: 'translate'; dx: number; dy: number };

export interface TransformResult {
  pixels: Uint32Array;
  /** the transformed selection, or null when the whole canvas was transformed */
  selection: Uint8Array | null;
}

/**
 * Transforms the selected pixels (or the whole canvas when `sel` is null)
 * about the centre of their bounding box, nearest-neighbour. The selected
 * source pixels are lifted out (left transparent) and stamped back at their
 * new place; anything landing outside the canvas is dropped. The selection
 * mask travels with the pixels so it keeps outlining them.
 */
export function transformPixels(
  src: Uint32Array,
  width: number,
  height: number,
  sel: Uint8Array | null,
  box: PixelRect,
  t: PixelTransform,
): TransformResult {
  const out = src.slice();
  const newSel = sel ? new Uint8Array(sel.length) : null;
  const picked = (x: number, y: number) => !sel || sel[x + y * width] === 1;

  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) if (picked(x, y)) out[x + y * width] = 0;
  }

  const bw = box.w;
  const bh = box.h;
  let nw = bw;
  let nh = bh;
  if (t.kind === 'rotCW' || t.kind === 'rotCCW') {
    nw = bh;
    nh = bw;
  } else if (t.kind === 'scale') {
    nw = Math.max(1, Math.round(bw * t.sx));
    nh = Math.max(1, Math.round(bh * t.sy));
  }
  let nx = box.x + Math.floor((bw - nw) / 2);
  let ny = box.y + Math.floor((bh - nh) / 2);
  if (t.kind === 'translate') {
    nx = box.x + t.dx;
    ny = box.y + t.dy;
  }

  const inverse = (u: number, v: number): [number, number] => {
    switch (t.kind) {
      case 'flipH':
        return [bw - 1 - u, v];
      case 'flipV':
        return [u, bh - 1 - v];
      case 'rotCW':
        return [v, bh - 1 - u];
      case 'rotCCW':
        return [bw - 1 - v, u];
      case 'rot180':
        return [bw - 1 - u, bh - 1 - v];
      case 'scale':
        return [Math.floor(((u + 0.5) * bw) / nw), Math.floor(((v + 0.5) * bh) / nh)];
      case 'translate':
        return [u, v];
    }
  };

  for (let v = 0; v < nh; v++) {
    const dy = ny + v;
    if (dy < 0 || dy >= height) continue;
    for (let u = 0; u < nw; u++) {
      const dx = nx + u;
      if (dx < 0 || dx >= width) continue;
      const [su, sv] = inverse(u, v);
      const sx = box.x + su;
      const sy = box.y + sv;
      if (!picked(sx, sy)) continue;
      const di = dx + dy * width;
      out[di] = src[sx + sy * width];
      if (newSel) newSel[di] = 1;
    }
  }
  return { pixels: out, selection: newSel };
}
