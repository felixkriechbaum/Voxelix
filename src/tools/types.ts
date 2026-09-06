import type { VoxelData } from '@/core/voxel/VoxelData';
import type { PickResult } from '@/viewport/Picker';
import type { CursorBox } from '@/viewport/Gizmos';

export type ToolId = 'place' | 'erase' | 'box' | 'paint' | 'eyedropper' | 'select';

export interface PointerInfo {
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** Everything a tool is allowed to do, provided by the editor session. */
export interface ToolContext {
  readonly data: VoxelData;
  readonly colorIndex: number;
  pick(clientX: number, clientY: number): PickResult | null;
  /** open an undo batch */
  begin(label: string): void;
  /** queue a raw-value voxel write inside the open batch */
  write(x: number, y: number, z: number, value: number): void;
  /** commit the batch, push to history, re-mesh */
  commit(): void;
  /** discard the open batch (no history entry) */
  cancel(): void;
  setCursor(box: CursorBox | null): void;
  /** eyedropper / paint helpers */
  pickColor(index: number): void;
}

export interface Tool {
  readonly id: ToolId;
  pointerDown(ctx: ToolContext, p: PointerInfo): void;
  pointerMove(ctx: ToolContext, p: PointerInfo): void;
  pointerUp(ctx: ToolContext, p: PointerInfo): void;
  /** pointer left the canvas or tool switched away */
  clearPreview(ctx: ToolContext): void;
}
