import type { PixelData } from '@/core/pixel/PixelData';
import type { BrushShape } from '@/core/pixel/brush';
import type { PixelSelection } from '@/core/pixel/selection';
import type { GradientKind, GradientStyle } from '@/core/pixel/ops/gradient';

export type PixelToolId =
  | 'pencil'
  | 'eraser'
  | 'bucket'
  | 'picker'
  | 'move'
  | 'select'
  | 'select-ellipse'
  | 'lasso'
  | 'wand'
  | 'gradient'
  | 'line'
  | 'rect'
  | 'circle';

export interface PixelPointer {
  clientX: number;
  clientY: number;
  /** 0 = primary (left), 2 = secondary (right) */
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  detail: number;
}

export interface PixelRectSel {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Transient screen overlay a tool draws while dragging (lasso path, gradient line) — in cell units. */
export interface ToolOverlay {
  points: Array<{ x: number; y: number }>;
  closed: boolean;
}

/** Everything a pixel tool is allowed to do, provided by the editor session. */
export interface PixelToolContext {
  /** the buffer being painted: the active layer's pixels, or its mask while editing the mask */
  readonly data: PixelData;
  /** what's visible (all layers merged) — the colour picker samples this */
  readonly composite: PixelData;
  readonly primary: number;
  readonly secondary: number;
  /** brush edge in pixels — every tool must honour this, never default to one pixel */
  readonly brushSize: number;
  readonly brushShape: BrushShape;
  /** rectangle tool: corner rounding in pixels, 0 = sharp corners */
  readonly cornerRadius: number;
  /** rectangle tool: inner border width in pixels, drawn in the other colour; 0 = no border */
  readonly rectBorder: number;
  /** bucket / wand: only the connected region (off = every matching pixel) */
  readonly contiguous: boolean;
  /** bucket / wand: per-channel colour tolerance, 0..255 */
  readonly tolerance: number;
  readonly gradientKind: GradientKind;
  readonly gradientStyle: GradientStyle;
  readonly selection: PixelSelection | null;

  /** Pixel cell under a client point, or null outside the canvas. */
  cellAt(clientX: number, clientY: number): { x: number; y: number } | null;
  /** Fractional cell coordinates under a client point, not clamped to the canvas. */
  pointAt(clientX: number, clientY: number): { x: number; y: number };
  begin(label: string): void;
  /** Writes are clipped to the selection, when there is one. */
  write(x: number, y: number, rgba: number): void;
  commit(): void;
  cancel(): void;
  setSelection(sel: PixelSelection | null): void;
  pickColor(rgba: number, slot: 'primary' | 'secondary'): void;
  setCursor(cell: { x: number; y: number } | null): void;
  setOverlay(o: ToolOverlay | null): void;

  /** Move tool: lifts the selected pixels (or the whole layer) — false when there's nothing to move. */
  moveBegin(): boolean;
  /** Move tool: shows the lifted pixels offset by (dx, dy) from where they started. */
  moveTo(dx: number, dy: number): void;
  moveEnd(): void;
  /** Gradient tool: fills the selection (or the whole layer) along the drag. */
  fillGradient(from: { x: number; y: number }, to: { x: number; y: number }, reverse: boolean): void;
}

export interface PixelTool {
  readonly id: PixelToolId;
  pointerDown(ctx: PixelToolContext, p: PixelPointer): void;
  pointerMove(ctx: PixelToolContext, p: PixelPointer): void;
  pointerUp(ctx: PixelToolContext, p: PixelPointer): void;
  clearPreview(ctx: PixelToolContext): void;
}
