import {
  clampSelection,
  selectionCells,
  selectionDims,
  selectionFits,
  translateSelection,
  type Selection,
} from '@/core/ops/selection';
import type { ToolContext } from '@/tools/types';

/**
 * Selection operations, expressed against a ToolContext so they run through the
 * same overlay-aware write path and undo history as a tool stroke. ToolRunner
 * implements ToolContext, so the selection panel / arrow keys can call these
 * with the live runner.
 */

/** Move the selected voxels by an integer delta; the box moves with them. */
export function moveSelection(ctx: ToolContext, sel: Selection, d: [number, number, number]): void {
  if (d[0] === 0 && d[1] === 0 && d[2] === 0) return;
  const next = translateSelection(sel, d);
  if (!selectionFits(next, ctx.data)) return; // would leave the grid — ignore the nudge

  const cells = selectionCells(ctx.data, sel);
  if (cells.length === 0) {
    ctx.setSelection(next);
    return;
  }
  ctx.begin('Move selection');
  for (const c of cells) ctx.write(c.x, c.y, c.z, 0);
  for (const c of cells) {
    const nx = c.x + d[0];
    const ny = c.y + d[1];
    const nz = c.z + d[2];
    if (ctx.data.inBounds(nx, ny, nz)) ctx.write(nx, ny, nz, c.v);
  }
  ctx.commit();
  ctx.setSelection(next);
}

/** Repaint every solid voxel in the selection with the current palette colour. */
export function recolourSelection(ctx: ToolContext, sel: Selection, colorIndex: number): void {
  const cells = selectionCells(ctx.data, sel);
  if (cells.length === 0) return;
  ctx.begin('Recolour selection');
  for (const c of cells) ctx.write(c.x, c.y, c.z, colorIndex + 1);
  ctx.commit();
}

/** Clear every voxel in the selection. */
export function deleteSelection(ctx: ToolContext, sel: Selection): void {
  const cells = selectionCells(ctx.data, sel);
  if (cells.length === 0) return;
  ctx.begin('Delete selection');
  for (const c of cells) ctx.write(c.x, c.y, c.z, 0);
  ctx.commit();
}

/**
 * Stamp a copy of the selection next to itself and select the copy. Prefers an
 * offset of one selection-width along X, then Z, then a (1,1,1) nudge.
 */
export function duplicateSelection(ctx: ToolContext, sel: Selection): void {
  const cells = selectionCells(ctx.data, sel);
  if (cells.length === 0) return;
  const [dx, , dz] = selectionDims(sel);

  const candidates: Array<[number, number, number]> = [
    [dx, 0, 0],
    [0, 0, dz],
    [1, 1, 1],
  ];
  const offset = candidates.find((d) => selectionFits(translateSelection(sel, d), ctx.data));
  if (!offset) return;

  ctx.begin('Duplicate selection');
  for (const c of cells) {
    ctx.write(c.x + offset[0], c.y + offset[1], c.z + offset[2], c.v);
  }
  ctx.commit();
  ctx.setSelection(clampSelection(translateSelection(sel, offset), ctx.data));
}
