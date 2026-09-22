import type { PixelData } from '@/core/pixel/PixelData';

export type PixelToolId = 'pencil' | 'eraser' | 'bucket' | 'picker' | 'select' | 'line' | 'rect' | 'circle';

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

/** Everything a pixel tool is allowed to do, provided by the editor session. */
export interface PixelToolContext {
  readonly data: PixelData;
  readonly primary: number;
  readonly secondary: number;
  /** brush edge in pixels — every tool must honour this, never default to one pixel */
  readonly brushSize: number;
  readonly contiguous: boolean;
  readonly selection: PixelRectSel | null;

  cellAt(clientX: number, clientY: number): { x: number; y: number } | null;
  begin(label: string): void;
  write(x: number, y: number, rgba: number): void;
  commit(): void;
  cancel(): void;
  setSelection(r: PixelRectSel | null): void;
  pickColor(rgba: number, slot: 'primary' | 'secondary'): void;
  setCursor(cell: { x: number; y: number } | null): void;
}

export interface PixelTool {
  readonly id: PixelToolId;
  pointerDown(ctx: PixelToolContext, p: PixelPointer): void;
  pointerMove(ctx: PixelToolContext, p: PixelPointer): void;
  pointerUp(ctx: PixelToolContext, p: PixelPointer): void;
  clearPreview(ctx: PixelToolContext): void;
}
