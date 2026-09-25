import type { PixelData } from '@/core/pixel/PixelData';
import type { NinePatch } from '@/core/pixel/types';
import type { PixelSelection, SelectionOutline } from '@/core/pixel/selection';
import { brushBox, brushMask, type BrushShape } from '@/core/pixel/brush';
import { PixelSelection as Sel } from '@/core/pixel/selection';
import type { ToolOverlay } from '@/tools/pixel/types';
import { blitPixelData, blitPixelRect } from './blit';

/** Hit-test tolerance around a guide line, in CSS pixels — generous enough to grab with a mouse. */
const GUIDE_HIT_PX = 5;

/** Zoom steps for the wheel / +/- keys. Below 1 the image is shown smoothed (an overview), from 1 up it's nearest-neighbour. */
export const ZOOM_LEVELS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];

export function nextZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_LEVELS.find((l) => l > z + 1e-6) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  return [...ZOOM_LEVELS].reverse().find((l) => l < z - 1e-6) ?? ZOOM_LEVELS[0];
}

export interface RenderOptions {
  /** CSS pixels per cell */
  zoom: number;
  showGrid: boolean;
  patch: NinePatch | null;
  selection: PixelSelection | null;
  /** cell under the pointer + the brush it would paint with */
  cursor: { x: number; y: number; size: number; shape: BrushShape } | null;
  /** faint reference image underneath — typically 'normal' while editing hover/pressed/…,
   *  so those states can be built up from it instead of painted blind */
  onion: PixelData | null;
  overlay: ToolOverlay | null;
  /** tints the frame while painting into a layer mask, so it's obvious strokes don't touch colour */
  maskMode: boolean;
}

const ONION_ALPHA = 0.3;

// used with a 'difference' composite blend, so this is mixed toward |backdrop
// - source| rather than painted flat — pick a mid alpha so it stays visible
// without a full-strength invert making every line look like a bright outline
const GRID_LINE = 'rgba(255, 255, 255, 0.5)';
const PATCH_LINE = '#3ba7ff';
const CURSOR_LINE = 'rgba(255, 255, 255, 0.9)';
const CURSOR_SHADOW = 'rgba(0, 0, 0, 0.6)';
const FRAME_LINE = 'rgba(128, 128, 128, 0.55)';
const MASK_FRAME = '#e5484d';
const CHECKER_A = '#3a3d44';
const CHECKER_B = '#2c2e33';
const CHECKER_CELL = 8;

/**
 * Viewport renderer for the pixel canvas. The <canvas> fills the stage and
 * the image is drawn into it at `zoom` with a pan offset — only the visible
 * cells are drawn, so a 1024² texture at 32× costs no more per frame than a
 * 32² button. The source is mirrored into an offscreen canvas at native size,
 * re-blitting just the rect that changed since the last frame (PixelData
 * revisions), then drawn scaled with nearest-neighbour. Grid, nine-patch
 * guides, the selection's marching ants and the brush cursor go on top in
 * device-pixel space.
 */
export class PixelRenderer {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private blitted: PixelData | null = null;
  private blittedRev = 0;
  private onionOff: HTMLCanvasElement;
  private onionOffCtx: CanvasRenderingContext2D;
  private onionBlitted: PixelData | null = null;
  private onionRev = 0;
  private checker: CanvasPattern | null = null;
  private dpr = 1;
  /** stage size in CSS px */
  private viewW = 1;
  private viewH = 1;
  /** image top-left, in CSS px from the canvas top-left */
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private size = { w: 1, h: 1 };
  /** client point to keep fixed on the next zoom change (the wheel's pointer) */
  private anchor: { x: number; y: number } | null = null;
  private needsCenter = true;
  private brushOutlines = new Map<string, SelectionOutline>();

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    [this.off, this.offCtx] = offscreen();
    [this.onionOff, this.onionOffCtx] = offscreen();
  }

  /** The stage's CSS size changed. */
  resize(w: number, h: number): void {
    const cw = Math.max(1, Math.floor(w));
    const ch = Math.max(1, Math.floor(h));
    if (this.needsCenter === false && (this.viewW !== cw || this.viewH !== ch)) {
      // keep the image centre where it was relative to the stage centre
      this.panX += (cw - this.viewW) / 2;
      this.panY += (ch - this.viewH) / 2;
    }
    this.viewW = cw;
    this.viewH = ch;
  }

  /** The largest zoom step that shows the whole image (≤ 32×, with a margin). */
  fitZoom(w: number, h: number): number {
    const fit = Math.min((this.viewW - 48) / w, (this.viewH - 48) / h);
    const steps = ZOOM_LEVELS.filter((z) => z <= Math.min(32, fit));
    return steps.length ? steps[steps.length - 1] : ZOOM_LEVELS[0];
  }

  /** Centre the image on the next frame (after a fit / a widget switch). */
  center(): void {
    this.needsCenter = true;
  }

  /** Next zoom change keeps this client point over the same image cell. */
  setZoomAnchor(clientX: number, clientY: number): void {
    this.anchor = { x: clientX, y: clientY };
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.needsCenter = false;
  }

  render(source: PixelData | null, opts: RenderOptions): void {
    this.dpr = window.devicePixelRatio || 1;
    const pxW = Math.round(this.viewW * this.dpr);
    const pxH = Math.round(this.viewH * this.dpr);
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    }
    this.canvas.style.width = `${this.viewW}px`;
    this.canvas.style.height = `${this.viewH}px`;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    if (!source) return;

    this.size = { w: source.width, h: source.height };
    this.applyZoom(opts.zoom);
    if (this.needsCenter) {
      this.panX = (this.viewW - source.width * this.zoom) / 2;
      this.panY = (this.viewH - source.height * this.zoom) / 2;
      this.needsCenter = false;
    }
    this.clampPan();
    this.sync(source, opts.onion);

    const z = this.zoom;
    const dpr = this.dpr;
    // image rect in device px, snapped so cell edges land on whole device pixels
    const ox = Math.round(this.panX * dpr);
    const oy = Math.round(this.panY * dpr);
    const dz = z * dpr;
    const iw = Math.round(source.width * dz);
    const ih = Math.round(source.height * dz);

    // visible cell range
    const cx0 = Math.max(0, Math.floor(-ox / dz));
    const cy0 = Math.max(0, Math.floor(-oy / dz));
    const cx1 = Math.min(source.width, Math.ceil((pxW - ox) / dz));
    const cy1 = Math.min(source.height, Math.ceil((pxH - oy) / dz));
    if (cx1 <= cx0 || cy1 <= cy0) return;
    const dx0 = ox + Math.round(cx0 * dz);
    const dy0 = oy + Math.round(cy0 * dz);
    const dw = ox + Math.round(cx1 * dz) - dx0;
    const dh = oy + Math.round(cy1 * dz) - dy0;

    // checker backdrop — a pattern fill, anchored to the image so it scrolls with it
    const pattern = this.checkerPattern();
    if (pattern) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillStyle = pattern;
      ctx.fillRect(dx0 - ox, dy0 - oy, dw, dh);
      ctx.restore();
    }

    ctx.imageSmoothingEnabled = z < 1;
    ctx.imageSmoothingQuality = 'high';
    if (opts.onion && this.onionBlitted === opts.onion) {
      ctx.globalAlpha = ONION_ALPHA;
      ctx.drawImage(this.onionOff, cx0, cy0, cx1 - cx0, cy1 - cy0, dx0, dy0, dw, dh);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.off, cx0, cy0, cx1 - cx0, cy1 - cy0, dx0, dy0, dw, dh);
    ctx.imageSmoothingEnabled = false;

    // image frame
    ctx.strokeStyle = opts.maskMode ? MASK_FRAME : FRAME_LINE;
    ctx.lineWidth = opts.maskMode ? 2 : 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, iw + 1, ih + 1);

    if (opts.showGrid && z >= 4) this.paintGrid(ctx, source.width, source.height, ox, oy, dz, cx0, cy0, cx1, cy1);
    if (opts.patch) this.paintPatchGuides(ctx, source.width, source.height, ox, oy, dz, opts.patch);
    if (opts.selection) this.paintOutline(ctx, opts.selection.outline(), ox, oy, dz, true);
    if (opts.cursor) this.paintCursor(ctx, opts.cursor, ox, oy, dz);
    if (opts.overlay) this.paintOverlay(ctx, opts.overlay, ox, oy, dz);
  }

  private applyZoom(zoom: number): void {
    const z = Math.max(ZOOM_LEVELS[0], zoom);
    if (z === this.zoom) {
      this.anchor = null;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    // keep the anchor (or the stage centre) over the same image point
    const ax = this.anchor ? this.anchor.x - rect.left : this.viewW / 2;
    const ay = this.anchor ? this.anchor.y - rect.top : this.viewH / 2;
    const ix = (ax - this.panX) / this.zoom;
    const iy = (ay - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = ax - ix * z;
    this.panY = ay - iy * z;
    this.anchor = null;
  }

  /** Never let the image scroll entirely out of view. */
  private clampPan(): void {
    const w = this.size.w * this.zoom;
    const h = this.size.h * this.zoom;
    const keep = 48;
    this.panX = Math.min(this.viewW - keep, Math.max(keep - w, this.panX));
    this.panY = Math.min(this.viewH - keep, Math.max(keep - h, this.panY));
  }

  /** Mirror the source (and onion) into their offscreen canvases — only what changed. */
  private sync(source: PixelData, onion: PixelData | null): void {
    if (source !== this.blitted || this.off.width !== source.width || this.off.height !== source.height) {
      this.off.width = source.width;
      this.off.height = source.height;
      blitPixelData(this.offCtx, source);
      this.blitted = source;
      this.blittedRev = source.rev;
    } else {
      const r = source.changedSince(this.blittedRev);
      if (r) blitPixelRect(this.offCtx, source, r);
      this.blittedRev = source.rev;
    }

    // same size only, by construction — every state of an element shares its
    // canvas dimensions — but skip rather than distort if that's ever not true
    if (!onion || onion.width !== source.width || onion.height !== source.height) return;
    if (onion !== this.onionBlitted || this.onionOff.width !== onion.width || this.onionOff.height !== onion.height) {
      this.onionOff.width = onion.width;
      this.onionOff.height = onion.height;
      blitPixelData(this.onionOffCtx, onion);
      this.onionBlitted = onion;
      this.onionRev = onion.rev;
    } else {
      const r = onion.changedSince(this.onionRev);
      if (r) blitPixelRect(this.onionOffCtx, onion, r);
      this.onionRev = onion.rev;
    }
  }

  private checkerPattern(): CanvasPattern | null {
    if (this.checker) return this.checker;
    const tile = document.createElement('canvas');
    const c = Math.max(1, Math.round(CHECKER_CELL * (window.devicePixelRatio || 1)));
    tile.width = c * 2;
    tile.height = c * 2;
    const t = tile.getContext('2d');
    if (!t) return null;
    t.fillStyle = CHECKER_A;
    t.fillRect(0, 0, c * 2, c * 2);
    t.fillStyle = CHECKER_B;
    t.fillRect(c, 0, c, c);
    t.fillRect(0, c, c, c);
    this.checker = this.ctx.createPattern(tile, 'repeat');
    return this.checker;
  }

  /** Rounds to the nearest device pixel and centres a 1px stroke on it. */
  private static crisp(v: number): number {
    return Math.round(v) + 0.5;
  }

  private paintGrid(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    ox: number,
    oy: number,
    dz: number,
    cx0: number,
    cy0: number,
    cx1: number,
    cy1: number,
  ): void {
    ctx.save();
    // a flat low-alpha line disappears over similarly-toned or light pixels —
    // difference blend always contrasts with whatever's underneath, dark or light
    ctx.globalCompositeOperation = 'difference';
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    // Stroked one line at a time, not as a single compound path: a large
    // multi-segment path under a non-default composite mode measurably drops
    // the odd sub-path on some GPU rasterizers (a whole grid line going
    // missing, confirmed by sampling a rendered screenshot). Only the visible
    // lines are drawn, so this stays a few hundred strokes at most.
    const top = oy + Math.round(cy0 * dz);
    const bottom = oy + Math.round(Math.min(h, cy1) * dz);
    const left = ox + Math.round(cx0 * dz);
    const right = ox + Math.round(Math.min(w, cx1) * dz);
    for (let x = cx0; x <= cx1; x++) {
      const px = PixelRenderer.crisp(ox + x * dz);
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
    }
    for (let y = cy0; y <= cy1; y++) {
      const py = PixelRenderer.crisp(oy + y * dz);
      ctx.beginPath();
      ctx.moveTo(left, py);
      ctx.lineTo(right, py);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Dash unit scaled to the current zoom rather than a fixed device-pixel
   * length: at a fixed [4,3] on a long, heavily-zoomed line, hundreds of tiny
   * dash cycles made the rasterizer drop part of the stroke entirely.
   * Roughly one dash cycle per cell keeps the segment count sane.
   */
  private static dashPattern(dz: number): number[] {
    const on = Math.max(3, Math.min(12, Math.round(dz * 0.5)));
    return [on, Math.max(2, Math.round(on * 0.7))];
  }

  private paintPatchGuides(ctx: CanvasRenderingContext2D, w: number, h: number, ox: number, oy: number, dz: number, patch: NinePatch): void {
    ctx.save();
    ctx.strokeStyle = PATCH_LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash(PixelRenderer.dashPattern(dz));
    const x0 = ox;
    const x1 = ox + Math.round(w * dz);
    const y0 = oy;
    const y1 = oy + Math.round(h * dz);
    const vline = (cx: number) => {
      const x = PixelRenderer.crisp(ox + cx * dz);
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    };
    const hline = (cy: number) => {
      const y = PixelRenderer.crisp(oy + cy * dz);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    };
    if (patch.left > 0) vline(patch.left);
    if (patch.right > 0) vline(w - patch.right);
    if (patch.top > 0) hline(patch.top);
    if (patch.bottom > 0) hline(h - patch.bottom);
    ctx.restore();
  }

  /**
   * Strokes a selection outline (merged edge runs in cell units): a dark
   * solid pass, then light dashes crawling over time — "marching ants". Runs
   * outside the viewport are skipped, and the rest go out in modest batches
   * rather than one giant path (see the note on paintGrid).
   */
  private paintOutline(ctx: CanvasRenderingContext2D, o: SelectionOutline, ox: number, oy: number, dz: number, ants: boolean, color = '#ffffff'): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const pass = (style: string, dash: number[], offset: number) => {
      ctx.strokeStyle = style;
      ctx.setLineDash(dash);
      ctx.lineDashOffset = offset;
      let n = 0;
      ctx.beginPath();
      const flush = () => {
        ctx.stroke();
        ctx.beginPath();
        n = 0;
      };
      for (let k = 0; k < o.h.length; k += 3) {
        const y = PixelRenderer.crisp(oy + o.h[k + 1] * dz);
        if (y < -1 || y > H + 1) continue;
        const xa = Math.max(-2, Math.round(ox + o.h[k] * dz));
        const xb = Math.min(W + 2, Math.round(ox + o.h[k + 2] * dz));
        if (xb < 0 || xa > W) continue;
        ctx.moveTo(xa, y);
        ctx.lineTo(xb, y);
        if (++n >= 400) flush();
      }
      for (let k = 0; k < o.v.length; k += 3) {
        const x = PixelRenderer.crisp(ox + o.v[k] * dz);
        if (x < -1 || x > W + 1) continue;
        const ya = Math.max(-2, Math.round(oy + o.v[k + 1] * dz));
        const yb = Math.min(H + 2, Math.round(oy + o.v[k + 2] * dz));
        if (yb < 0 || ya > H) continue;
        ctx.moveTo(x, ya);
        ctx.lineTo(x, yb);
        if (++n >= 400) flush();
      }
      if (n > 0) ctx.stroke();
    };
    ctx.save();
    ctx.lineWidth = 1;
    if (ants) {
      pass('rgba(0, 0, 0, 0.85)', [], 0);
      const pattern = [4, 4];
      pass(color, pattern, -((performance.now() / 40) % 8));
    } else {
      pass(CURSOR_SHADOW, [], 0);
      ctx.translate(-1, -1);
      pass(color, [], 0);
    }
    ctx.restore();
  }

  private paintCursor(ctx: CanvasRenderingContext2D, c: NonNullable<RenderOptions['cursor']>, ox: number, oy: number, dz: number): void {
    const box = brushBox(c.x, c.y, c.size);
    const key = `${c.shape}:${box.w}`;
    let outline = this.brushOutlines.get(key);
    if (!outline) {
      const m = brushMask(box.w, c.shape);
      outline = new Sel(box.w, box.w, m.slice()).outline();
      this.brushOutlines.set(key, outline);
    }
    this.paintOutline(ctx, outline, ox + Math.round(box.x * dz), oy + Math.round(box.y * dz), dz, false, CURSOR_LINE);
  }

  private paintOverlay(ctx: CanvasRenderingContext2D, o: ToolOverlay, ox: number, oy: number, dz: number): void {
    if (o.points.length < 2) return;
    ctx.save();
    const path = () => {
      ctx.beginPath();
      o.points.forEach((p, i) => {
        const x = ox + p.x * dz;
        const y = oy + p.y * dz;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (o.closed) ctx.closePath();
    };
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    path();
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    path();
    ctx.stroke();
    ctx.restore();
  }

  /** Client coordinate -> fractional cell coordinate (not clamped). */
  toPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - Math.round(this.panX * this.dpr) / this.dpr) / this.zoom,
      y: (clientY - rect.top - Math.round(this.panY * this.dpr) / this.dpr) / this.zoom,
    };
  }

  /** Client coordinate -> pixel cell, or null when outside the image. */
  toCell(clientX: number, clientY: number): { x: number; y: number } | null {
    const p = this.toPoint(clientX, clientY);
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= this.size.w || y >= this.size.h) return null;
    return { x, y };
  }

  /**
   * Client coordinate -> nearest cell *edge*, clamped to the image — used
   * while dragging a nine-patch guide, where the pointer commonly overshoots.
   */
  toEdgeClamped(clientX: number, clientY: number): { x: number; y: number } {
    const p = this.toPoint(clientX, clientY);
    return {
      x: Math.max(0, Math.min(this.size.w, Math.round(p.x))),
      y: Math.max(0, Math.min(this.size.h, Math.round(p.y))),
    };
  }

  /**
   * Which patch edge (if any) is under a client coordinate, within a small
   * hit-test tolerance — drives the draggable on-canvas margin guides.
   */
  hitGuide(clientX: number, clientY: number, patch: NinePatch): keyof NinePatch | null {
    const { w, h } = this.size;
    const p = this.toPoint(clientX, clientY);
    const tol = GUIDE_HIT_PX / this.zoom;
    if (p.x < -tol || p.y < -tol || p.x > w + tol || p.y > h + tol) return null;
    const near = (a: number, b: number) => Math.abs(a - b) <= tol;
    const inY = p.y >= 0 && p.y <= h;
    const inX = p.x >= 0 && p.x <= w;
    if (patch.left > 0 && inY && near(p.x, patch.left)) return 'left';
    if (patch.right > 0 && inY && near(p.x, w - patch.right)) return 'right';
    if (patch.top > 0 && inX && near(p.y, patch.top)) return 'top';
    if (patch.bottom > 0 && inX && near(p.y, h - patch.bottom)) return 'bottom';
    return null;
  }

  /** Small PNG data URL for thumbnails / the recent-project list — at most 256px on the long side. */
  captureThumbnail(source: PixelData | null): string {
    if (!source) return '';
    const scale = Math.min(2, 256 / Math.max(source.width, source.height));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(source.width * scale));
    out.height = Math.max(1, Math.round(source.height * scale));
    const octx = out.getContext('2d');
    if (!octx) return '';
    const [tmp, tctx] = offscreen();
    tmp.width = source.width;
    tmp.height = source.height;
    blitPixelData(tctx, source);
    octx.imageSmoothingEnabled = scale < 1;
    octx.drawImage(tmp, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  dispose(): void {
    this.blitted = null;
    this.onionBlitted = null;
  }
}

function offscreen(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return [c, ctx];
}
