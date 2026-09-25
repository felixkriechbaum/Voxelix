import type { PixelRect } from './PixelData';

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** Modifier convention shared by every selection tool (Photoshop's): Shift adds, Alt subtracts, both intersect. */
export function selectionModeFor(shift: boolean, alt: boolean): SelectionMode {
  if (shift && alt) return 'intersect';
  if (shift) return 'add';
  if (alt) return 'subtract';
  return 'replace';
}

/** Outline edges of a selection, merged into runs — [x0, y, x1] horizontals and [x, y0, y1] verticals, in cell units. */
export interface SelectionOutline {
  h: Int32Array;
  v: Int32Array;
}

/**
 * A per-pixel selection (1 = selected). Immutable by convention — every
 * operation returns a new instance — so undo entries and the renderer can
 * hold on to one safely.
 */
export class PixelSelection {
  readonly width: number;
  readonly height: number;
  readonly mask: Uint8Array;
  private boundsCache: PixelRect | null | undefined;
  private outlineCache: SelectionOutline | undefined;

  constructor(width: number, height: number, mask?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.mask = mask ?? new Uint8Array(width * height);
  }

  static rect(width: number, height: number, r: PixelRect): PixelSelection {
    const s = new PixelSelection(width, height);
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(width, r.x + r.w);
    const y1 = Math.min(height, r.y + r.h);
    for (let y = y0; y < y1; y++) s.mask.fill(1, y * width + x0, y * width + x1);
    return s;
  }

  static all(width: number, height: number): PixelSelection {
    return new PixelSelection(width, height, new Uint8Array(width * height).fill(1));
  }

  static fromIndices(width: number, height: number, idx: ArrayLike<number>): PixelSelection {
    const s = new PixelSelection(width, height);
    for (let k = 0; k < idx.length; k++) s.mask[idx[k]] = 1;
    return s;
  }

  static fromCells(width: number, height: number, cells: Iterable<[number, number]>): PixelSelection {
    const s = new PixelSelection(width, height);
    for (const [x, y] of cells) if (x >= 0 && y >= 0 && x < width && y < height) s.mask[x + y * width] = 1;
    return s;
  }

  /** Pixels whose packed-RGBA value passes `test` (alpha / mask → selection). */
  static fromPixels(width: number, height: number, px: Uint32Array, test: (v: number) => boolean): PixelSelection {
    const s = new PixelSelection(width, height);
    for (let i = 0; i < px.length; i++) if (test(px[i])) s.mask[i] = 1;
    return s;
  }

  has(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.mask[x + y * this.width] === 1;
  }

  isEmpty(): boolean {
    return this.bounds() === null;
  }

  /** Whether the selection is exactly its bounding box. */
  isRect(): boolean {
    const b = this.bounds();
    if (!b) return false;
    return this.count() === b.w * b.h;
  }

  count(): number {
    let n = 0;
    for (let i = 0; i < this.mask.length; i++) n += this.mask[i];
    return n;
  }

  bounds(): PixelRect | null {
    if (this.boundsCache !== undefined) return this.boundsCache;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.height; y++) {
      const row = y * this.width;
      for (let x = 0; x < this.width; x++) {
        if (this.mask[row + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          maxY = y;
        }
      }
    }
    this.boundsCache = maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    return this.boundsCache;
  }

  combine(other: PixelSelection, mode: SelectionMode): PixelSelection {
    if (mode === 'replace') return other;
    const out = new Uint8Array(this.mask.length);
    const a = this.mask;
    const b = other.mask;
    for (let i = 0; i < out.length; i++) {
      if (mode === 'add') out[i] = a[i] | b[i];
      else if (mode === 'subtract') out[i] = a[i] & (b[i] ^ 1);
      else out[i] = a[i] & b[i];
    }
    return new PixelSelection(this.width, this.height, out);
  }

  invert(): PixelSelection {
    const out = new Uint8Array(this.mask.length);
    for (let i = 0; i < out.length; i++) out[i] = this.mask[i] ^ 1;
    return new PixelSelection(this.width, this.height, out);
  }

  /** Shifted by (dx, dy); whatever slides off the canvas is dropped. */
  translate(dx: number, dy: number): PixelSelection {
    const out = new PixelSelection(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      const ny = y + dy;
      if (ny < 0 || ny >= this.height) continue;
      for (let x = 0; x < this.width; x++) {
        if (!this.mask[x + y * this.width]) continue;
        const nx = x + dx;
        if (nx >= 0 && nx < this.width) out.mask[nx + ny * this.width] = 1;
      }
    }
    return out;
  }

  /**
   * Boundary edges between selected and unselected cells, merged into
   * straight runs. Cached — the renderer strokes this every frame for the
   * marching ants, and a magic-wand selection on a noisy texture can have
   * tens of thousands of edges.
   */
  outline(): SelectionOutline {
    if (this.outlineCache) return this.outlineCache;
    const { width: w, height: h, mask } = this;
    const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? mask[x + y * w] : 0);
    const hs: number[] = [];
    const vs: number[] = [];
    // horizontal edges: between row y-1 and row y, for y in 0..h
    for (let y = 0; y <= h; y++) {
      let start = -1;
      for (let x = 0; x <= w; x++) {
        const edge = x < w && at(x, y - 1) !== at(x, y);
        if (edge && start < 0) start = x;
        else if (!edge && start >= 0) {
          hs.push(start, y, x);
          start = -1;
        }
      }
    }
    for (let x = 0; x <= w; x++) {
      let start = -1;
      for (let y = 0; y <= h; y++) {
        const edge = y < h && at(x - 1, y) !== at(x, y);
        if (edge && start < 0) start = y;
        else if (!edge && start >= 0) {
          vs.push(x, start, y);
          start = -1;
        }
      }
    }
    this.outlineCache = { h: Int32Array.from(hs), v: Int32Array.from(vs) };
    return this.outlineCache;
  }
}

/**
 * Cells inside a closed polygon (lasso), even-odd rule, sampled at cell
 * centres. Points are in cell units (a click on cell (x, y) contributes its
 * centre, x + 0.5).
 */
export function polygonSelection(width: number, height: number, pts: Array<{ x: number; y: number }>): PixelSelection {
  const s = new PixelSelection(width, height);
  if (pts.length < 3) {
    for (const p of pts) {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (x >= 0 && y >= 0 && x < width && y < height) s.mask[x + y * width] = 1;
    }
    return s;
  }
  const xs: number[] = [];
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if (a.y > cy !== b.y > cy) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      if (x1 >= x0) s.mask.fill(1, y * width + x0, y * width + x1 + 1);
    }
  }
  return s;
}
