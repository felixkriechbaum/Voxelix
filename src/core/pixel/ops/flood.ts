import type { PixelData } from '@/core/pixel/PixelData';

/**
 * Whether two packed RGBA values are within `tolerance` (0..255) on every
 * channel. Fully transparent pixels all count as the same colour, whatever
 * RGB they happen to carry.
 */
export function colorsMatch(a: number, b: number, tolerance: number): boolean {
  if (a === b) return true;
  const aa = a >>> 24;
  const ba = b >>> 24;
  if (aa === 0 && ba === 0) return true;
  if (tolerance <= 0) return false;
  return (
    Math.abs(aa - ba) <= tolerance &&
    Math.abs((a & 0xff) - (b & 0xff)) <= tolerance &&
    Math.abs(((a >>> 8) & 0xff) - ((b >>> 8) & 0xff)) <= tolerance &&
    Math.abs(((a >>> 16) & 0xff) - ((b >>> 16) & 0xff)) <= tolerance
  );
}

/**
 * Pixel indices matching the seed pixel's colour (within `tolerance`).
 * `contiguous` = only the 4-connected region around the seed; off = every
 * matching pixel on the canvas. Index-based with a typed work queue — a
 * 1024² fill touches a million cells, far too many for tuple arrays.
 */
export function floodIndices(data: PixelData, sx: number, sy: number, contiguous: boolean, tolerance = 0): Int32Array {
  const { width: w, height: h } = data;
  const px = data.pixels;
  const seedIdx = data.index(sx, sy);
  if (seedIdx < 0) return new Int32Array(0);
  const seed = px[seedIdx];
  const out: number[] = [];

  if (!contiguous) {
    for (let i = 0; i < px.length; i++) if (colorsMatch(px[i], seed, tolerance)) out.push(i);
    return Int32Array.from(out);
  }

  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  stack[top++] = seedIdx;
  visited[seedIdx] = 1;
  while (top > 0) {
    const i = stack[--top];
    if (!colorsMatch(px[i], seed, tolerance)) continue;
    out.push(i);
    const x = i % w;
    if (x > 0 && !visited[i - 1]) {
      visited[i - 1] = 1;
      stack[top++] = i - 1;
    }
    if (x < w - 1 && !visited[i + 1]) {
      visited[i + 1] = 1;
      stack[top++] = i + 1;
    }
    if (i >= w && !visited[i - w]) {
      visited[i - w] = 1;
      stack[top++] = i - w;
    }
    if (i + w < w * h && !visited[i + w]) {
      visited[i + w] = 1;
      stack[top++] = i + w;
    }
  }
  return Int32Array.from(out);
}
