import { decodePixels, encodePixels } from './encode';
import type { PixelLayerJson } from './types';

/** One pixel write, used by tools to build undo/redo entries. Index is row-major (x + y*width). */
export interface PixelEdit {
  i: number;
  /** packed RGBA before the edit */
  prev: number;
  /** packed RGBA after the edit */
  next: number;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How many change records a PixelData keeps for changedSince() before a consumer has to fall back to a full refresh. */
const CHANGE_LOG = 32;

/**
 * One canvas's worth of packed RGBA8 pixels, row-major. Flat and dense —
 * unlike VoxelData there is no sparse chunking; even a 1024² texture is only
 * 4 MB.
 *
 * Change tracking is revision-based so several consumers (layer compositing,
 * the canvas renderer, the widget preview, thumbnails) can each ask "what
 * changed since I last looked" without stealing each other's dirty flag:
 * writes grow a pending rect, and reading `rev` seals it into a numbered
 * change record. changedSince(rev) returns the union rect of every record
 * after that revision — so a 1-pixel brush dab on a 1024² canvas re-blits a
 * 1-pixel rect, not the whole texture.
 */
export class PixelData {
  readonly width: number;
  readonly height: number;
  private px: Uint32Array;
  private pending: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private log: Array<{ rev: number; x0: number; y0: number; x1: number; y1: number }> = [];
  private _rev = 1;
  private boundsCache: { rev: number; value: PixelRect | null } | null = null;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.px = new Uint32Array(this.width * this.height);
  }

  /** Monotonic revision; reading it seals any pending writes into a change record. */
  get rev(): number {
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this._rev++;
      this.log.push({ rev: this._rev, ...p });
      if (this.log.length > CHANGE_LOG) this.log.shift();
    }
    return this._rev;
  }

  /**
   * Union of everything written after `since` (a value previously read from
   * `rev`), or null if nothing changed. Falls back to the whole canvas when
   * the change log no longer reaches back that far.
   */
  changedSince(since: number): PixelRect | null {
    const now = this.rev;
    if (since >= now) return null;
    if (this.log.length === 0 || this.log[0].rev > since + 1) return { x: 0, y: 0, w: this.width, h: this.height };
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of this.log) {
      if (c.rev <= since) continue;
      if (c.x0 < x0) x0 = c.x0;
      if (c.y0 < y0) y0 = c.y0;
      if (c.x1 > x1) x1 = c.x1;
      if (c.y1 > y1) y1 = c.y1;
    }
    if (x0 > x1) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  private touch(x0: number, y0: number, x1: number, y1: number): void {
    const p = this.pending;
    if (!p) {
      this.pending = { x0, y0, x1, y1 };
      return;
    }
    if (x0 < p.x0) p.x0 = x0;
    if (y0 < p.y0) p.y0 = y0;
    if (x1 > p.x1) p.x1 = x1;
    if (y1 > p.y1) p.y1 = y1;
  }

  /** Flags the whole canvas as changed. */
  touchAll(): void {
    this.touch(0, 0, this.width - 1, this.height - 1);
  }

  /** Flags a rect as changed after writing into `pixels` directly (bulk writers only). */
  markChanged(r: PixelRect): void {
    if (r.w <= 0 || r.h <= 0) return;
    this.touch(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1);
  }

  /** Read-only view of the packed pixels. Write through set/setRaw/setAll so change tracking stays right. */
  get pixels(): Uint32Array {
    return this.px;
  }

  /** -1 when out of bounds. */
  index(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return x + y * this.width;
  }

  /** Packed RGBA. 0 (transparent) when out of bounds. */
  get(x: number, y: number): number {
    const i = this.index(x, y);
    return i < 0 ? 0 : this.px[i];
  }

  set(x: number, y: number, rgba: number): void {
    const i = this.index(x, y);
    if (i < 0) return;
    this.setRaw(i, rgba);
  }

  /** Index-based write, for history replay. */
  setRaw(i: number, rgba: number): void {
    if (i < 0 || i >= this.px.length) return;
    const v = rgba >>> 0;
    if (this.px[i] !== v) {
      this.px[i] = v;
      const x = i % this.width;
      const y = (i - x) / this.width;
      this.touch(x, y, x, y);
    }
  }

  /** Replace every pixel at once (same length) — adjustments, transforms, previews. */
  setAll(src: Uint32Array): void {
    if (src.length !== this.px.length) throw new Error('setAll: size mismatch');
    this.px.set(src);
    this.touchAll();
  }

  /** History replay target: apply one edit's before/after value. */
  applyEdit(e: PixelEdit, value: number): void {
    this.setRaw(e.i, value);
  }

  fill(rgba: number): void {
    this.px.fill(rgba >>> 0);
    this.touchAll();
  }

  fillRect(r: PixelRect, rgba: number): void {
    const v = rgba >>> 0;
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(this.width, r.x + r.w);
    const y1 = Math.min(this.height, r.y + r.h);
    if (x1 <= x0 || y1 <= y0) return;
    for (let y = y0; y < y1; y++) {
      const rowBase = y * this.width;
      this.px.fill(v, rowBase + x0, rowBase + x1);
    }
    this.touch(x0, y0, x1 - 1, y1 - 1);
  }

  clone(): PixelData {
    const copy = new PixelData(this.width, this.height);
    copy.px.set(this.px);
    return copy;
  }

  /** Tightest box around non-transparent pixels. Null when the canvas is empty. Cached per revision. */
  bounds(): PixelRect | null {
    const rev = this.rev;
    if (this.boundsCache?.rev === rev) return this.boundsCache.value;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < this.height; y++) {
      const rowBase = y * this.width;
      for (let x = 0; x < this.width; x++) {
        if (this.px[rowBase + x] >>> 24 !== 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    const value = minX > maxX ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    this.boundsCache = { rev, value };
    return value;
  }

  /** New canvas at (w, h); out-of-range pixels are dropped, new area is filled with `fill` (transparent by default). */
  resize(w: number, h: number, anchor: 'topleft' | 'center' = 'topleft', fill = 0): PixelData {
    const next = new PixelData(w, h);
    if (fill) next.px.fill(fill >>> 0);
    const ox = anchor === 'center' ? Math.floor((w - this.width) / 2) : 0;
    const oy = anchor === 'center' ? Math.floor((h - this.height) / 2) : 0;
    for (let y = 0; y < this.height; y++) {
      const ny = y + oy;
      if (ny < 0 || ny >= h) continue;
      const srcRow = y * this.width;
      const dstRow = ny * w;
      for (let x = 0; x < this.width; x++) {
        const nx = x + ox;
        if (nx < 0 || nx >= w) continue;
        next.px[dstRow + nx] = this.px[srcRow + x];
      }
    }
    return next;
  }

  /** Unpacked RGBA bytes (row-major, 4 bytes/pixel) — feeds canvas ImageData directly. */
  asImageBuffer(): Uint8ClampedArray {
    return this.rectImageBuffer({ x: 0, y: 0, w: this.width, h: this.height });
  }

  /** Unpacked RGBA bytes for just a sub-rect — partial re-blits. */
  rectImageBuffer(r: PixelRect): Uint8ClampedArray {
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    let o = 0;
    for (let y = r.y; y < r.y + r.h; y++) {
      const rowBase = y * this.width;
      for (let x = r.x; x < r.x + r.w; x++) {
        const v = this.px[rowBase + x];
        out[o] = v & 0xff;
        out[o + 1] = (v >>> 8) & 0xff;
        out[o + 2] = (v >>> 16) & 0xff;
        out[o + 3] = (v >>> 24) & 0xff;
        o += 4;
      }
    }
    return out;
  }

  toJSON(): PixelLayerJson {
    return encodePixels(this.px);
  }

  static fromJSON(json: PixelLayerJson, w: number, h: number): PixelData {
    const data = new PixelData(w, h);
    data.px = decodePixels(json, data.px.length);
    return data;
  }

  /** Wraps an existing buffer (taken over, not copied). */
  static fromPixels(w: number, h: number, px: Uint32Array): PixelData {
    const data = new PixelData(w, h);
    if (px.length !== data.px.length) throw new Error('fromPixels: size mismatch');
    data.px = px;
    return data;
  }
}
