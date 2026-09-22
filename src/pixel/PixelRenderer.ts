import type { PixelData } from '@/core/pixel/PixelData';
import type { NinePatch } from '@/core/pixel/types';

export interface RenderOptions {
  /** integer pixels-per-cell */
  zoom: number;
  showGrid: boolean;
  patch: NinePatch | null;
  selection: { x: number; y: number; w: number; h: number } | null;
  /** brush-footprint box under the pointer, already brush-size-aligned */
  cursor: { x: number; y: number; w: number; h: number } | null;
}

const GRID_LINE = 'rgba(128, 128, 128, 0.35)';
const PATCH_LINE = '#3ba7ff';
const SELECTION_LINE = '#f2b134';
const CURSOR_LINE = 'rgba(255, 255, 255, 0.9)';
const CHECKER_A = '#3a3d44';
const CHECKER_B = '#2c2e33';

/**
 * Canvas-based pixel-art renderer: blits a PixelData buffer at integer zoom
 * with nearest-neighbour scaling, plus a checker backdrop for transparency,
 * an optional cell grid, nine-patch guides and a selection outline.
 */
export class PixelRenderer {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private source: PixelData | null = null;
  /** the PixelData instance the offscreen canvas currently reflects — see render() */
  private blitted: PixelData | null = null;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.off = document.createElement('canvas');
    const offCtx = this.off.getContext('2d');
    if (!offCtx) throw new Error('2D canvas context unavailable');
    this.offCtx = offCtx;
  }

  setSource(data: PixelData): void {
    this.source = data;
    if (this.off.width !== data.width || this.off.height !== data.height) {
      this.off.width = data.width;
      this.off.height = data.height;
    }
  }

  /** Client-rect size in CSS pixels this canvas should occupy for the given zoom. */
  cssSize(): { w: number; h: number } {
    if (!this.source) return { w: 0, h: 0 };
    return { w: this.source.width, h: this.source.height };
  }

  render(opts: RenderOptions): void {
    const data = this.source;
    if (!data) return;
    const zoom = Math.max(1, Math.round(opts.zoom));
    this.dpr = window.devicePixelRatio || 1;

    const cssW = data.width * zoom;
    const cssH = data.height * zoom;
    const pxW = Math.round(cssW * this.dpr);
    const pxH = Math.round(cssH * this.dpr);
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    // reblit whenever the pixels changed OR the source instance itself changed
    // (switching widget/state) — a fresh PixelData can be dirty=false already
    // (e.g. loaded from JSON, never touched) while still being new to *this*
    // offscreen canvas, which otherwise still holds the previous source's pixels
    if (data.dirty || data !== this.blitted || this.off.width !== data.width) {
      this.off.width = data.width;
      this.off.height = data.height;
      this.blit(data);
      data.dirty = false;
      this.blitted = data;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this.paintChecker(ctx, data.width, data.height, zoom);
    ctx.drawImage(this.off, 0, 0, data.width, data.height, 0, 0, cssW, cssH);

    if (opts.showGrid && zoom >= 4) this.paintGrid(ctx, data.width, data.height, zoom);
    if (opts.patch) this.paintPatchGuides(ctx, data.width, data.height, zoom, opts.patch);
    if (opts.selection) this.paintSelection(ctx, opts.selection, zoom, SELECTION_LINE, [3, 2]);
    if (opts.cursor) this.paintSelection(ctx, opts.cursor, zoom, CURSOR_LINE, []);
    ctx.restore();
  }

  private paintChecker(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number): void {
    const cell = Math.max(4, Math.min(zoom, 8));
    const cols = Math.ceil((w * zoom) / cell);
    const rows = Math.ceil((h * zoom) / cell);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? CHECKER_A : CHECKER_B;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  private paintGrid(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number): void {
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x++) {
      ctx.moveTo(x * zoom + 0.5, 0);
      ctx.lineTo(x * zoom + 0.5, h * zoom);
    }
    for (let y = 0; y <= h; y++) {
      ctx.moveTo(0, y * zoom + 0.5);
      ctx.lineTo(w * zoom, y * zoom + 0.5);
    }
    ctx.stroke();
  }

  private paintPatchGuides(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number, patch: NinePatch): void {
    ctx.strokeStyle = PATCH_LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    if (patch.left > 0) {
      ctx.moveTo(patch.left * zoom + 0.5, 0);
      ctx.lineTo(patch.left * zoom + 0.5, h * zoom);
    }
    if (patch.right > 0) {
      const x = (w - patch.right) * zoom + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h * zoom);
    }
    if (patch.top > 0) {
      ctx.moveTo(0, patch.top * zoom + 0.5);
      ctx.lineTo(w * zoom, patch.top * zoom + 0.5);
    }
    if (patch.bottom > 0) {
      const y = (h - patch.bottom) * zoom + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w * zoom, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private paintSelection(
    ctx: CanvasRenderingContext2D,
    sel: { x: number; y: number; w: number; h: number },
    zoom: number,
    color: string,
    dash: number[],
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.strokeRect(sel.x * zoom + 0.5, sel.y * zoom + 0.5, sel.w * zoom - 1, sel.h * zoom - 1);
    ctx.setLineDash([]);
  }

  /** Client coordinate -> pixel cell, or null when outside the canvas. */
  toCell(clientX: number, clientY: number, zoom: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    if (cx < 0 || cy < 0 || cx >= rect.width || cy >= rect.height) return null;
    const x = Math.floor(cx / Math.max(1, Math.round(zoom)));
    const y = Math.floor(cy / Math.max(1, Math.round(zoom)));
    if (!this.source || x < 0 || y < 0 || x >= this.source.width || y >= this.source.height) return null;
    return { x, y };
  }

  /** Small PNG data URL for thumbnails / recent-project list. */
  captureThumbnail(scale = 2): string {
    if (!this.source) return '';
    const out = document.createElement('canvas');
    out.width = this.source.width * scale;
    out.height = this.source.height * scale;
    const octx = out.getContext('2d');
    if (!octx) return '';
    octx.imageSmoothingEnabled = false;
    // ensure the offscreen buffer reflects the latest pixels
    this.blit(this.source);
    octx.drawImage(this.off, 0, 0, this.source.width, this.source.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  /**
   * Copy a PixelData's pixels into the offscreen canvas. Goes through
   * createImageData().data.set() rather than `new ImageData(buffer, ...)` —
   * the latter wants a plain ArrayBuffer-backed view, and this project's
   * WebWorker + DOM lib combination types typed-array buffers as the wider
   * ArrayBufferLike (see CLAUDE.md's note on strict typed-array generics).
   */
  private blit(data: PixelData): void {
    const imgData = this.offCtx.createImageData(data.width, data.height);
    imgData.data.set(data.asImageBuffer());
    this.offCtx.putImageData(imgData, 0, 0);
  }

  dispose(): void {
    this.source = null;
  }
}
