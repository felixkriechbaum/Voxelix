import type { PixelRect } from './PixelData';

export type BrushShape = 'square' | 'round';

export const MAX_BRUSH = 64;

/**
 * Bounding box of the brush footprint for the cursor cell. Centred on the
 * cursor (for even sizes the extra row/column goes right/down), so a 1–2px
 * brush behaves exactly as the old top-left-anchored one while a 32px brush
 * paints around the pointer instead of hanging off its corner. Shared by the
 * draw tools and the cursor preview so the preview always matches what a
 * click would actually paint.
 */
export function brushBox(cx: number, cy: number, brushSize: number): PixelRect {
  const b = Math.max(1, Math.round(brushSize));
  const o = Math.floor((b - 1) / 2);
  return { x: cx - o, y: cy - o, w: b, h: b };
}

const maskCache = new Map<string, Uint8Array>();

/** Row-major b×b footprint (1 = painted). Round brushes pull in by a quarter cell so a 3px round brush is a plus, not a square. */
export function brushMask(brushSize: number, shape: BrushShape): Uint8Array {
  const b = Math.max(1, Math.round(brushSize));
  const key = `${shape}:${b}`;
  let m = maskCache.get(key);
  if (m) return m;
  m = new Uint8Array(b * b);
  if (shape === 'square' || b <= 2) {
    m.fill(1);
  } else {
    const c = (b - 1) / 2;
    const r = b / 2 - 0.25;
    for (let y = 0; y < b; y++) {
      for (let x = 0; x < b; x++) if ((x - c) ** 2 + (y - c) ** 2 <= r * r) m[x + y * b] = 1;
    }
  }
  maskCache.set(key, m);
  return m;
}

/** Every cell the brush covers at (cx, cy). Never a single cell when a larger brush is selected. */
export function brushCells(cx: number, cy: number, brushSize: number, shape: BrushShape): Array<[number, number]> {
  const box = brushBox(cx, cy, brushSize);
  const m = brushMask(box.w, shape);
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) if (m[x + y * box.w]) cells.push([box.x + x, box.y + y]);
  return cells;
}
