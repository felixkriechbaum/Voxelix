import { floodIndices } from '@/core/pixel/ops/flood';
import { brushCells as footprint } from '@/core/pixel/brush';
import { PixelSelection, polygonSelection, selectionModeFor, type SelectionMode } from '@/core/pixel/selection';
import type { PixelPointer, PixelRectSel, PixelTool, PixelToolContext, PixelToolId } from './types';

/** Colour for a click: right mouse button paints the secondary colour, everything else primary. */
function colorFor(ctx: PixelToolContext, p: PixelPointer): number {
  return p.button === 2 ? ctx.secondary : ctx.primary;
}

/** The brush footprint for (cx, cy) at the context's current brush size and shape — never a single cell. */
function brushCells(ctx: PixelToolContext, cx: number, cy: number): Array<[number, number]> {
  return footprint(cx, cy, ctx.brushSize, ctx.brushShape);
}

abstract class DrawTool implements PixelTool {
  abstract readonly id: PixelToolId;
  private drawing = false;
  private lastCell: { x: number; y: number } | null = null;
  /**
   * The button that started the stroke. PointerEvent.button is only
   * meaningful on the down/up transition — during pointermove while a
   * button is held, browsers report 0 regardless of which button is
   * actually down (the live state lives in `buttons`, a bitmask, not
   * `button`). Re-reading `p.button` per move would flip a right-click
   * stroke to the primary colour after the very first move event, so the
   * colour is decided once at pointerDown and held for the whole stroke.
   */
  private strokeButton = 0;

  protected abstract valueFor(ctx: PixelToolContext, button: number): number;

  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    if (!cell) return;
    this.drawing = true;
    this.lastCell = cell;
    this.strokeButton = p.button;
    ctx.begin(this.id === 'eraser' ? 'Erase' : 'Draw');
    this.stroke(ctx, cell);
  }

  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    ctx.setCursor(cell);
    if (!this.drawing || !cell) return;
    // fill the gap between the last cell and this one so a fast drag doesn't leave holes
    if (this.lastCell) {
      for (const [x, y] of lineCells(this.lastCell.x, this.lastCell.y, cell.x, cell.y)) {
        this.stroke(ctx, { x, y });
      }
    } else {
      this.stroke(ctx, cell);
    }
    this.lastCell = cell;
  }

  pointerUp(ctx: PixelToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.lastCell = null;
    ctx.commit();
  }

  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
    if (this.drawing) {
      this.drawing = false;
      this.lastCell = null;
      ctx.commit();
    }
  }

  private stroke(ctx: PixelToolContext, cell: { x: number; y: number }): void {
    const value = this.valueFor(ctx, this.strokeButton);
    for (const [x, y] of brushCells(ctx, cell.x, cell.y)) ctx.write(x, y, value);
  }
}

class PencilTool extends DrawTool {
  readonly id: PixelToolId = 'pencil';
  protected valueFor(ctx: PixelToolContext, button: number): number {
    return button === 2 ? ctx.secondary : ctx.primary;
  }
}

class EraserTool extends DrawTool {
  readonly id: PixelToolId = 'eraser';
  protected valueFor(): number {
    return 0;
  }
}

class PickerTool implements PixelTool {
  readonly id: PixelToolId = 'picker';
  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    if (!cell) return;
    ctx.pickColor(ctx.composite.get(cell.x, cell.y), p.button === 2 ? 'secondary' : 'primary');
  }
  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    ctx.setCursor(ctx.cellAt(p.clientX, p.clientY));
  }
  pointerUp(): void {}
  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
  }
}

class BucketTool implements PixelTool {
  readonly id: PixelToolId = 'bucket';
  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    if (!cell) return;
    const value = colorFor(ctx, p);
    const seed = ctx.data.get(cell.x, cell.y);
    if (seed === value && ctx.tolerance === 0) return;
    const idx = floodIndices(ctx.data, cell.x, cell.y, ctx.contiguous, ctx.tolerance);
    if (idx.length === 0) return;
    const w = ctx.data.width;
    ctx.begin('Fill');
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const x = i % w;
      ctx.write(x, (i - x) / w, value);
    }
    ctx.commit();
  }
  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    ctx.setCursor(ctx.cellAt(p.clientX, p.clientY));
  }
  pointerUp(): void {}
  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
  }
}

/** Bresenham line, inclusive of both endpoints — used to fill drag gaps and by the line tool. */
function lineCells(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

/** Normalised box (corners -> bounds) plus the inscribed ellipse's continuous centre/radii. */
function boxRadii(x0: number, y0: number, x1: number, y1: number) {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const rx = (maxX - minX + 1) / 2;
  const ry = (maxY - minY + 1) / 2;
  return { minX, maxX, minY, maxY, rx, ry, cx: minX + rx, cy: minY + ry };
}

/**
 * Every cell whose centre falls inside the ellipse inscribed in the box
 * spanning the two corners — a simple area test rather than a midpoint/
 * Bresenham ellipse walk, which keeps it trivially correct (and symmetric)
 * at the cost of an O(w*h) scan; fine at the pixel-art canvas sizes this
 * editor deals with.
 */
function ellipseCells(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const { minX, maxX, minY, maxY, rx, ry, cx, cy } = boxRadii(x0, y0, x1, y1);
  const cells: Array<[number, number]> = [];
  for (let y = minY; y <= maxY; y++) {
    const ny = (y + 0.5 - cy) / ry;
    for (let x = minX; x <= maxX; x++) {
      const nx = (x + 0.5 - cx) / rx;
      if (nx * nx + ny * ny <= 1) cells.push([x, y]);
    }
  }
  return cells;
}

/**
 * Cells of a filled rectangle whose corners are rounded with `radius`
 * pixels — same cell-centre area test as ellipseCells, against a quarter
 * circle in each corner. The radius is clamped to half the shorter side, so
 * a big radius on a small box gives a pill / circle rather than overlapping
 * corners. radius 0 = plain rectangle.
 */
function roundedRectCells(r: PixelRectSel, radius: number): Array<[number, number]> {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  const cells: Array<[number, number]> = [];
  const left = r.x + rad;
  const right = r.x + r.w - rad;
  const top = r.y + rad;
  const bottom = r.y + r.h - rad;
  // testing cell centres against the full radius only nibbles a single
  // pixel off each corner even at r=3; pulling the arc in a little gives the
  // stepped corner pixel artists expect (r=1 drops the corner pixel, r=3
  // steps 2-1) while staying symmetric
  const cut = Math.max(0, rad - 0.3);
  for (let y = r.y; y < r.y + r.h; y++) {
    const py = y + 0.5;
    const qy = py < top ? top - py : py > bottom ? py - bottom : 0;
    for (let x = r.x; x < r.x + r.w; x++) {
      const px = x + 0.5;
      const qx = px < left ? left - px : px > right ? px - right : 0;
      if (qx * qx + qy * qy <= cut * cut) cells.push([x, y]);
    }
  }
  return cells;
}

/** Box spanning two corners, inclusive of both. */
function normalizedRect(x0: number, y0: number, x1: number, y1: number): PixelRectSel {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

/** With shift held, pulls `end` out to the nearer square corner (matching the drag direction) — the usual "Shift = constrain to a square/circle" drawing-tool convention. */
function constrainSquare(start: { x: number; y: number }, end: { x: number; y: number }, shift: boolean): { x: number; y: number } {
  if (!shift) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + (dx < 0 ? -d : d), y: start.y + (dy < 0 ? -d : d) };
}

/**
 * Shared "rubber-band" drag pattern for rect/line/circle: rather
 * than a separate preview overlay, each move reverts the in-progress batch
 * and repaints the shape from the (unchanged) start point to the new cursor
 * cell — the same begin/write/cancel machinery a single stroke already uses,
 * so what's shown mid-drag is the exact real pixels, not an approximation
 * (e.g. a bounding box standing in for a diagonal line). Modifier keys are
 * read live on every move rather than frozen at pointerDown, unlike the
 * mouse button (see PencilTool) — `shiftKey` reflects the current key state
 * on every event, it isn't a down/up-only transition, so toggling it mid-drag
 * correctly flips between free and constrained live.
 */
abstract class DragShapeTool implements PixelTool {
  abstract readonly id: PixelToolId;
  protected start: { x: number; y: number } | null = null;
  private button = 0;

  protected abstract label: string;
  protected abstract paint(
    ctx: PixelToolContext,
    start: { x: number; y: number },
    end: { x: number; y: number },
    value: number,
    shiftKey: boolean,
  ): void;

  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    if (!cell) return;
    this.start = cell;
    this.button = p.button;
    ctx.begin(this.label);
    this.paint(ctx, cell, cell, this.button === 2 ? ctx.secondary : ctx.primary, p.shiftKey);
  }

  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    if (!this.start) {
      ctx.setCursor(cell);
      return;
    }
    if (!cell) return;
    ctx.cancel();
    ctx.begin(this.label);
    this.paint(ctx, this.start, cell, this.button === 2 ? ctx.secondary : ctx.primary, p.shiftKey);
  }

  pointerUp(ctx: PixelToolContext): void {
    if (!this.start) return;
    this.start = null;
    ctx.commit();
  }

  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
    if (this.start) {
      ctx.cancel();
      this.start = null;
    }
  }
}

/**
 * Filled rectangle; shift constrains it to a square. Corners are rounded by
 * the tool option's radius (0 = sharp). With a border width set, an inner
 * border of that many pixels is drawn in the other colour (secondary when
 * dragging with the left button, primary with the right) — the inner shape
 * is the same rounded rect inset by the border, with its radius shrunk by the
 * same amount, so the border stays even around the corners.
 */
class RectTool extends DragShapeTool {
  readonly id: PixelToolId = 'rect';
  protected label = 'Rectangle';
  protected paint(ctx: PixelToolContext, start: { x: number; y: number }, end0: { x: number; y: number }, value: number, shiftKey: boolean): void {
    const end = constrainSquare(start, end0, shiftKey);
    const r = normalizedRect(start.x, start.y, end.x, end.y);
    const radius = Math.min(ctx.cornerRadius, r.w / 2, r.h / 2);
    const b = ctx.rectBorder;
    if (b <= 0) {
      for (const [x, y] of roundedRectCells(r, radius)) ctx.write(x, y, value);
      return;
    }
    const border = value === ctx.primary ? ctx.secondary : ctx.primary;
    const innerRect = { x: r.x + b, y: r.y + b, w: r.w - 2 * b, h: r.h - 2 * b };
    const inner = new Set<number>();
    if (innerRect.w > 0 && innerRect.h > 0) {
      for (const [x, y] of roundedRectCells(innerRect, Math.max(0, radius - b))) inner.add(x + y * 65536);
    }
    for (const [x, y] of roundedRectCells(r, radius)) ctx.write(x, y, inner.has(x + y * 65536) ? value : border);
  }
}

class LineTool extends DragShapeTool {
  readonly id: PixelToolId = 'line';
  protected label = 'Line';
  protected paint(ctx: PixelToolContext, start: { x: number; y: number }, end: { x: number; y: number }, value: number): void {
    for (const [x, y] of lineCells(start.x, start.y, end.x, end.y)) {
      for (const [bx, by] of brushCells(ctx, x, y)) ctx.write(bx, by, value);
    }
  }
}

/** Free ellipse inscribed in the drag box; shift constrains it to a perfect circle. */
class CircleTool extends DragShapeTool {
  readonly id: PixelToolId = 'circle';
  protected label = 'Ellipse';
  protected paint(ctx: PixelToolContext, start: { x: number; y: number }, end0: { x: number; y: number }, value: number, shiftKey: boolean): void {
    const end = constrainSquare(start, end0, shiftKey);
    for (const [x, y] of ellipseCells(start.x, start.y, end.x, end.y)) ctx.write(x, y, value);
  }
}

/**
 * Shared marquee behaviour for the rectangle / ellipse select tools. The
 * combine mode comes from the modifiers held at pointer-down (Shift add, Alt
 * subtract, both intersect) and stays fixed for the drag, same as Photoshop.
 * A plain click without a modifier deselects.
 */
abstract class MarqueeTool implements PixelTool {
  abstract readonly id: PixelToolId;
  private start: { x: number; y: number } | null = null;
  private base: PixelSelection | null = null;
  private mode: SelectionMode = 'replace';
  private dragged = false;

  protected abstract shape(ctx: PixelToolContext, r: PixelRectSel): PixelSelection;

  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    this.start = clampCell(ctx, ctx.pointAt(p.clientX, p.clientY));
    this.base = ctx.selection;
    this.mode = this.base ? selectionModeFor(p.shiftKey, p.altKey) : 'replace';
    this.dragged = false;
  }

  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    if (!this.start) {
      ctx.setCursor(ctx.cellAt(p.clientX, p.clientY));
      return;
    }
    const cell = clampCell(ctx, ctx.pointAt(p.clientX, p.clientY));
    if (!this.dragged && cell.x === this.start.x && cell.y === this.start.y) return;
    this.dragged = true;
    const next = this.shape(ctx, normalizedRect(this.start.x, this.start.y, cell.x, cell.y));
    ctx.setSelection(this.base ? this.base.combine(next, this.mode) : next);
  }

  pointerUp(ctx: PixelToolContext): void {
    if (this.start && !this.dragged && this.mode === 'replace') ctx.setSelection(null);
    this.start = null;
    this.base = null;
  }

  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
  }
}

class SelectTool extends MarqueeTool {
  readonly id: PixelToolId = 'select';
  protected shape(ctx: PixelToolContext, r: PixelRectSel): PixelSelection {
    return PixelSelection.rect(ctx.data.width, ctx.data.height, r);
  }
}

class EllipseSelectTool extends MarqueeTool {
  readonly id: PixelToolId = 'select-ellipse';
  protected shape(ctx: PixelToolContext, r: PixelRectSel): PixelSelection {
    return PixelSelection.fromCells(ctx.data.width, ctx.data.height, ellipseCells(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1));
  }
}

/** Freehand lasso: drag a closed outline; cells whose centre falls inside are selected. */
class LassoTool implements PixelTool {
  readonly id: PixelToolId = 'lasso';
  private points: Array<{ x: number; y: number }> | null = null;
  private base: PixelSelection | null = null;
  private mode: SelectionMode = 'replace';

  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    this.points = [ctx.pointAt(p.clientX, p.clientY)];
    this.base = ctx.selection;
    this.mode = this.base ? selectionModeFor(p.shiftKey, p.altKey) : 'replace';
    ctx.setOverlay({ points: this.points, closed: false });
  }

  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    if (!this.points) {
      ctx.setCursor(ctx.cellAt(p.clientX, p.clientY));
      return;
    }
    const pt = ctx.pointAt(p.clientX, p.clientY);
    const last = this.points[this.points.length - 1];
    if (Math.abs(pt.x - last.x) + Math.abs(pt.y - last.y) < 0.35) return;
    this.points.push(pt);
    ctx.setOverlay({ points: this.points, closed: false });
  }

  pointerUp(ctx: PixelToolContext): void {
    const pts = this.points;
    this.points = null;
    ctx.setOverlay(null);
    if (!pts) return;
    if (pts.length < 3) {
      if (this.mode === 'replace') ctx.setSelection(null);
      return;
    }
    const next = polygonSelection(ctx.data.width, ctx.data.height, pts);
    const combined = this.base ? this.base.combine(next, this.mode) : next;
    ctx.setSelection(combined.isEmpty() ? null : combined);
  }

  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
    if (this.points) this.pointerUp(ctx);
  }
}

/** Magic wand: selects pixels of (roughly) the clicked colour on the active layer — tolerance + contiguous from the tool options. */
class WandTool implements PixelTool {
  readonly id: PixelToolId = 'wand';
  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    if (!cell) return;
    const { width, height } = ctx.data;
    const next = PixelSelection.fromIndices(width, height, floodIndices(ctx.data, cell.x, cell.y, ctx.contiguous, ctx.tolerance));
    const base = ctx.selection;
    const combined = base ? base.combine(next, selectionModeFor(p.shiftKey, p.altKey)) : next;
    ctx.setSelection(combined.isEmpty() ? null : combined);
  }
  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    ctx.setCursor(ctx.cellAt(p.clientX, p.clientY));
  }
  pointerUp(): void {}
  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
  }
}

/** Drags the selected pixels (or, with no selection, the whole layer). Shift locks to the dominant axis. */
class MoveTool implements PixelTool {
  readonly id: PixelToolId = 'move';
  private start: { x: number; y: number } | null = null;

  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    if (!ctx.moveBegin()) return;
    const pt = ctx.pointAt(p.clientX, p.clientY);
    this.start = { x: Math.floor(pt.x), y: Math.floor(pt.y) };
  }
  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    if (!this.start) return;
    const pt = ctx.pointAt(p.clientX, p.clientY);
    let dx = Math.floor(pt.x) - this.start.x;
    let dy = Math.floor(pt.y) - this.start.y;
    if (p.shiftKey) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    ctx.moveTo(dx, dy);
  }
  pointerUp(ctx: PixelToolContext): void {
    if (!this.start) return;
    this.start = null;
    ctx.moveEnd();
  }
  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
    if (this.start) this.pointerUp(ctx);
  }
}

/** Drag a line; release fills the selection (or layer) with a primary → secondary gradient. Right button reverses it, Shift snaps to 45°. */
class GradientTool implements PixelTool {
  readonly id: PixelToolId = 'gradient';
  private start: { x: number; y: number } | null = null;
  private end: { x: number; y: number } | null = null;
  private reverse = false;

  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    const pt = ctx.pointAt(p.clientX, p.clientY);
    this.start = pt;
    this.end = pt;
    this.reverse = p.button === 2;
    ctx.setOverlay({ points: [pt, pt], closed: false });
  }
  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    if (!this.start) {
      ctx.setCursor(ctx.cellAt(p.clientX, p.clientY));
      return;
    }
    let pt = ctx.pointAt(p.clientX, p.clientY);
    if (p.shiftKey) pt = snap45(this.start, pt);
    this.end = pt;
    ctx.setOverlay({ points: [this.start, pt], closed: false });
  }
  pointerUp(ctx: PixelToolContext): void {
    const { start, end } = this;
    this.start = null;
    this.end = null;
    ctx.setOverlay(null);
    if (!start || !end) return;
    ctx.fillGradient(start, end, this.reverse);
  }
  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
    if (this.start) {
      this.start = null;
      this.end = null;
      ctx.setOverlay(null);
    }
  }
}

function snap45(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}

function clampCell(ctx: PixelToolContext, pt: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(ctx.data.width - 1, Math.floor(pt.x))),
    y: Math.max(0, Math.min(ctx.data.height - 1, Math.floor(pt.y))),
  };
}

export function createPixelTool(id: PixelToolId): PixelTool {
  switch (id) {
    case 'pencil':
      return new PencilTool();
    case 'eraser':
      return new EraserTool();
    case 'picker':
      return new PickerTool();
    case 'bucket':
      return new BucketTool();
    case 'rect':
      return new RectTool();
    case 'line':
      return new LineTool();
    case 'circle':
      return new CircleTool();
    case 'select':
      return new SelectTool();
    case 'select-ellipse':
      return new EllipseSelectTool();
    case 'lasso':
      return new LassoTool();
    case 'wand':
      return new WandTool();
    case 'move':
      return new MoveTool();
    case 'gradient':
      return new GradientTool();
  }
}
