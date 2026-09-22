import { rleU32ToBase64, base64ToRleU32 } from '@/core/io/serialize';
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

/**
 * One canvas's worth of packed RGBA8 pixels, row-major. Flat and dense —
 * unlike VoxelData there is no sparse chunking, since widget canvases are a
 * few thousand pixels at most.
 */
export class PixelData {
  readonly width: number;
  readonly height: number;
  private px: Uint32Array;
  /** set on every write, cleared by whoever repaints (the renderer) */
  dirty = true;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.px = new Uint32Array(this.width * this.height);
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
      this.dirty = true;
    }
  }

  /** History replay target: apply one edit's before/after value. */
  applyEdit(e: PixelEdit, value: number): void {
    this.setRaw(e.i, value);
  }

  fill(rgba: number): void {
    this.px.fill(rgba >>> 0);
    this.dirty = true;
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
      for (let x = x0; x < x1; x++) this.px[rowBase + x] = v;
    }
    this.dirty = true;
  }

  clone(): PixelData {
    const copy = new PixelData(this.width, this.height);
    copy.px.set(this.px);
    return copy;
  }

  /** Tightest box around non-transparent pixels. Null when the canvas is empty. */
  bounds(): PixelRect | null {
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
    if (minX > maxX) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /** New canvas at (w, h); out-of-range pixels are dropped, new area is transparent. */
  resize(w: number, h: number, anchor: 'topleft' | 'center' = 'topleft'): PixelData {
    const next = new PixelData(w, h);
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
    const out = new Uint8ClampedArray(this.px.length * 4);
    for (let i = 0; i < this.px.length; i++) {
      const v = this.px[i];
      const o = i * 4;
      out[o] = v & 0xff;
      out[o + 1] = (v >>> 8) & 0xff;
      out[o + 2] = (v >>> 16) & 0xff;
      out[o + 3] = (v >>> 24) & 0xff;
    }
    return out;
  }

  toJSON(): PixelLayerJson {
    return { pixels: rleU32ToBase64(this.px) };
  }

  static fromJSON(json: PixelLayerJson, w: number, h: number): PixelData {
    const data = new PixelData(w, h);
    data.px = base64ToRleU32(json.pixels, data.px.length);
    return data;
  }
}
