import { floodRegion } from '@/core/pixel/ops/flood';
import { brushBox } from '@/core/pixel/brush';
import type { PixelPointer, PixelRectSel, PixelTool, PixelToolContext, PixelToolId } from './types';

/** Colour for a click: right mouse button paints the secondary colour, everything else primary. */
function colorFor(ctx: PixelToolContext, p: PixelPointer): number {
  return p.button === 2 ? ctx.secondary : ctx.primary;
}

/** Brush-aligned block of cells for (cx, cy) at the context's current brush size — never a single cell. */
function brushCells(ctx: PixelToolContext, cx: number, cy: number): Array<[number, number]> {
  const box = brushBox(cx, cy, ctx.brushSize);
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) cells.push([box.x + x, box.y + y]);
  return cells;
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
    ctx.pickColor(ctx.data.get(cell.x, cell.y), p.button === 2 ? 'secondary' : 'primary');
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
    if (seed === value) return;
    const cells = floodRegion(ctx.data, cell.x, cell.y, ctx.contiguous);
    if (cells.length === 0) return;
    ctx.begin('Fill');
    for (const [x, y] of cells) ctx.write(x, y, value);
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

/** Normalised box (corners -> bounds) plus the inscribed ellipse's continuous centre/radii, shared by ellipseCells and squircleCells. */
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

/** Superellipse exponent for the "squircle" shape — 4 is the usual textbook value for a rounded-square look, between an ellipse (2) and a true rounded rect (very large). */
const SQUIRCLE_N = 4;

/** Same area-test approach as ellipseCells, but against |nx|^n + |ny|^n <= 1 — a rounded square rather than a round ellipse. */
function squircleCells(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const { minX, maxX, minY, maxY, rx, ry, cx, cy } = boxRadii(x0, y0, x1, y1);
  const cells: Array<[number, number]> = [];
  for (let y = minY; y <= maxY; y++) {
    const ny = Math.abs((y + 0.5 - cy) / ry);
    for (let x = minX; x <= maxX; x++) {
      const nx = Math.abs((x + 0.5 - cx) / rx);
      if (nx ** SQUIRCLE_N + ny ** SQUIRCLE_N <= 1) cells.push([x, y]);
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
 * Shared "rubber-band" drag pattern for rect/line/circle/squircle: rather
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

class RectTool extends DragShapeTool {
  readonly id: PixelToolId = 'rect';
  protected label = 'Rectangle';
  protected paint(ctx: PixelToolContext, start: { x: number; y: number }, end0: { x: number; y: number }, value: number, shiftKey: boolean): void {
    const end = constrainSquare(start, end0, shiftKey);
    const r = normalizedRect(start.x, start.y, end.x, end.y);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) ctx.write(x, y, value);
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

/** Superellipse ("squircle") inscribed in the drag box; shift constrains it to a symmetric squircle. */
class SquircleTool extends DragShapeTool {
  readonly id: PixelToolId = 'squircle';
  protected label = 'Squircle';
  protected paint(ctx: PixelToolContext, start: { x: number; y: number }, end0: { x: number; y: number }, value: number, shiftKey: boolean): void {
    const end = constrainSquare(start, end0, shiftKey);
    for (const [x, y] of squircleCells(start.x, start.y, end.x, end.y)) ctx.write(x, y, value);
  }
}

/** Drag a rectangular selection; a plain click (no drag) clears it. Doesn't touch pixels itself. */
class SelectTool implements PixelTool {
  readonly id: PixelToolId = 'select';
  private start: { x: number; y: number } | null = null;
  private dragged = false;

  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    if (!cell) return;
    this.start = cell;
    this.dragged = false;
    ctx.setSelection(normalizedRect(cell.x, cell.y, cell.x, cell.y));
  }

  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    if (!this.start) {
      ctx.setCursor(cell);
      return;
    }
    if (!cell) return;
    this.dragged = true;
    ctx.setSelection(normalizedRect(this.start.x, this.start.y, cell.x, cell.y));
  }

  pointerUp(ctx: PixelToolContext): void {
    if (this.start && !this.dragged) ctx.setSelection(null); // a plain click clears the selection
    this.start = null;
  }

  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
    this.start = null;
  }
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
    case 'squircle':
      return new SquircleTool();
    case 'select':
      return new SelectTool();
  }
}
