import { floodRegion } from '@/core/pixel/ops/flood';
import { brushBox } from '@/core/pixel/brush';
import type { PixelPointer, PixelTool, PixelToolContext, PixelToolId } from './types';

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

  protected abstract valueFor(ctx: PixelToolContext, p: PixelPointer): number;

  pointerDown(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    if (!cell) return;
    this.drawing = true;
    this.lastCell = cell;
    ctx.begin(this.id === 'eraser' ? 'Erase' : 'Draw');
    this.stroke(ctx, p, cell);
  }

  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    const cell = ctx.cellAt(p.clientX, p.clientY);
    ctx.setCursor(cell);
    if (!this.drawing || !cell) return;
    // fill the gap between the last cell and this one so a fast drag doesn't leave holes
    if (this.lastCell) {
      for (const [x, y] of lineCells(this.lastCell.x, this.lastCell.y, cell.x, cell.y)) {
        this.stroke(ctx, p, { x, y });
      }
    } else {
      this.stroke(ctx, p, cell);
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

  private stroke(ctx: PixelToolContext, p: PixelPointer, cell: { x: number; y: number }): void {
    const value = this.valueFor(ctx, p);
    for (const [x, y] of brushCells(ctx, cell.x, cell.y)) ctx.write(x, y, value);
  }
}

class PencilTool extends DrawTool {
  readonly id: PixelToolId = 'pencil';
  protected valueFor(ctx: PixelToolContext, p: PixelPointer): number {
    return colorFor(ctx, p);
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

/** Placeholder for a not-yet-implemented tool id (select/line/rect — see docs/pixel-editor-plan.md M5). */
class NoopTool implements PixelTool {
  constructor(readonly id: PixelToolId) {}
  pointerDown(): void {}
  pointerMove(ctx: PixelToolContext, p: PixelPointer): void {
    ctx.setCursor(ctx.cellAt(p.clientX, p.clientY));
  }
  pointerUp(): void {}
  clearPreview(ctx: PixelToolContext): void {
    ctx.setCursor(null);
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
    case 'select':
    case 'line':
    case 'rect':
      return new NoopTool(id);
  }
}
