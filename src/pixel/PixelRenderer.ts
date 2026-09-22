import type { PixelData } from '@/core/pixel/PixelData';
import type { NinePatch } from '@/core/pixel/types';
import { blitPixelData } from './blit';

/** Hit-test tolerance around a guide line, in CSS pixels — generous enough to grab with a mouse. */
const GUIDE_HIT_PX = 5;

export interface RenderOptions {
  /** integer pixels-per-cell */
  zoom: number;
  showGrid: boolean;
  patch: NinePatch | null;
  selection: { x: number; y: number; w: number; h: number } | null;
  /** brush-footprint box under the pointer, already brush-size-aligned */
  cursor: { x: number; y: number; w: number; h: number } | null;
}

// used with a 'difference' composite blend, so this is mixed toward |backdrop
// - source| rather than painted flat — pick a mid alpha so it stays visible
// without a full-strength invert making every line look like a bright outline
const GRID_LINE = 'rgba(255, 255, 255, 0.5)';
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
    ctx.restore();

    // Overlays are drawn in device-pixel space (identity transform, coordinates
    // pre-multiplied by dpr) rather than under the dpr scale above: the classic
    // "+0.5 for a crisp 1px line" trick only lands on an actual device pixel
    // when 1 canvas-space unit is 1 device pixel, which stops being true the
    // moment dpr isn't a whole number (125%/150% Windows scaling) — under the
    // scaled transform, some lines fell between device pixels and got
    // anti-aliased down to near-invisible.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dzoom = zoom * this.dpr;
    if (opts.showGrid && zoom >= 4) this.paintGrid(ctx, data.width, data.height, dzoom);
    if (opts.patch) this.paintPatchGuides(ctx, data.width, data.height, dzoom, opts.patch);
    if (opts.selection) this.paintSelection(ctx, opts.selection, dzoom, SELECTION_LINE, [3, 2]);
    if (opts.cursor) this.paintSelection(ctx, opts.cursor, dzoom, CURSOR_LINE, []);
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

  /** Rounds to the nearest device pixel and centres a 1px stroke on it. */
  private static crisp(v: number): number {
    return Math.round(v) + 0.5;
  }

  private paintGrid(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number): void {
    ctx.save();
    // a flat low-alpha line disappears over similarly-toned or light pixels —
    // difference blend always contrasts with whatever's underneath, dark or light
    ctx.globalCompositeOperation = 'difference';
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    // Stroked one line at a time, not as a single compound path (all lines
    // queued via moveTo/lineTo then one stroke() call): a large multi-segment
    // path under a non-default composite mode measurably drops the odd
    // sub-path on some GPU rasterizers — a real, reproducible whole grid line
    // going missing (not faint, not anti-aliased, just entirely un-inked),
    // confirmed by sampling a rendered screenshot pixel-by-pixel. One stroke
    // per line is slightly more draw calls but leaves no shared geometry for
    // a rasterizer to mishandle.
    for (let x = 0; x <= w; x++) {
      const px = PixelRenderer.crisp(x * zoom);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h * zoom);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y++) {
      const py = PixelRenderer.crisp(y * zoom);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w * zoom, py);
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintPatchGuides(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number, patch: NinePatch): void {
    ctx.save();
    ctx.strokeStyle = PATCH_LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    // one stroke() per line — see the comment on paintGrid's loop
    if (patch.left > 0) {
      const x = PixelRenderer.crisp(patch.left * zoom);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h * zoom);
      ctx.stroke();
    }
    if (patch.right > 0) {
      const x = PixelRenderer.crisp((w - patch.right) * zoom);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h * zoom);
      ctx.stroke();
    }
    if (patch.top > 0) {
      const y = PixelRenderer.crisp(patch.top * zoom);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w * zoom, y);
      ctx.stroke();
    }
    if (patch.bottom > 0) {
      const y = PixelRenderer.crisp((h - patch.bottom) * zoom);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w * zoom, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintSelection(
    ctx: CanvasRenderingContext2D,
    sel: { x: number; y: number; w: number; h: number },
    zoom: number,
    color: string,
    dash: number[],
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    const x = Math.round(sel.x * zoom);
    const y = Math.round(sel.y * zoom);
    const w = Math.round((sel.x + sel.w) * zoom) - x;
    const h = Math.round((sel.y + sel.h) * zoom) - y;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
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

  private blit(data: PixelData): void {
    blitPixelData(this.offCtx, data);
  }

  /**
   * Which patch edge (if any) is under a client coordinate, within a small
   * hit-test tolerance — drives the draggable on-canvas margin guides.
   * Returns null when no patch is set, the point isn't near a line, or the
   * canvas has no source yet.
   */
  hitGuide(clientX: number, clientY: number, zoom: number, patch: NinePatch): keyof NinePatch | null {
    const data = this.source;
    if (!data) return null;
    const z = Math.max(1, Math.round(zoom));
    const rect = this.canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    if (cx < -GUIDE_HIT_PX || cy < -GUIDE_HIT_PX || cx > rect.width + GUIDE_HIT_PX || cy > rect.height + GUIDE_HIT_PX) {
      return null;
    }
    const near = (a: number, b: number) => Math.abs(a - b) <= GUIDE_HIT_PX;
    if (patch.left > 0 && cy >= 0 && cy <= rect.height && near(cx, patch.left * z)) return 'left';
    if (patch.right > 0 && cy >= 0 && cy <= rect.height && near(cx, (data.width - patch.right) * z)) return 'right';
    if (patch.top > 0 && cx >= 0 && cx <= rect.width && near(cy, patch.top * z)) return 'top';
    if (patch.bottom > 0 && cx >= 0 && cx <= rect.width && near(cy, (data.height - patch.bottom) * z)) return 'bottom';
    return null;
  }

  /**
   * Client coordinate -> pixel cell, clamped to the canvas bounds instead of
   * returning null outside them — used while dragging a guide, where the
   * pointer commonly overshoots the edge a little.
   */
  toCellClamped(clientX: number, clientY: number, zoom: number): { x: number; y: number } | null {
    const data = this.source;
    if (!data) return null;
    const z = Math.max(1, Math.round(zoom));
    const rect = this.canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const x = Math.max(0, Math.min(data.width, Math.round(cx / z)));
    const y = Math.max(0, Math.min(data.height, Math.round(cy / z)));
    return { x, y };
  }

  dispose(): void {
    this.source = null;
  }
}
