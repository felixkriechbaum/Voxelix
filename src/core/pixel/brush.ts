import type { PixelRect } from './PixelData';

/**
 * Brush footprint for a cell at the given brush size, anchored at the cursor
 * cell (top-left corner) — never a single cell when a larger brush is
 * selected. Free-floating, not snapped to a fixed lattice: unlike the voxel
 * editor's fractional brush (which has to land on sub-voxel positions to keep
 * a shape coherent within a voxel cell), a 2D pixel brush has no grid to stay
 * aligned to, so snapping would only get in the way — same as every other
 * pixel-art tool, an NxN brush can paint any NxN box, sliding freely with the
 * cursor. Shared by the draw tools and the cursor preview so the preview
 * always matches what a click would actually paint.
 */
export function brushBox(cx: number, cy: number, brushSize: number): PixelRect {
  const b = Math.max(1, Math.round(brushSize));
  return { x: cx, y: cy, w: b, h: b };
}
