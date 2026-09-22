import type { PixelRect } from './PixelData';

/**
 * Brush-aligned footprint for a cell at the given brush size — grid-snapped,
 * never a single cell when a larger brush is selected. Shared by the draw
 * tools and the cursor preview so the preview always matches what a click
 * would actually paint.
 */
export function brushBox(cx: number, cy: number, brushSize: number): PixelRect {
  const b = Math.max(1, Math.round(brushSize));
  const x = Math.floor(cx / b) * b;
  const y = Math.floor(cy / b) * b;
  return { x, y, w: b, h: b };
}
