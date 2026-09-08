import type * as THREE from 'three';
import type { VoxelData } from '@/core/voxel/VoxelData';
import type { PickResult, BuildPlane } from '@/viewport/Picker';
import type { CursorBox } from '@/viewport/Gizmos';
import type { Selection } from '@/core/ops/selection';

export type ToolId = 'place' | 'erase' | 'box' | 'paint' | 'bucket' | 'eyedropper' | 'select';

export interface PointerInfo {
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** consecutive-click count — 2 on the second press of a double-click */
  detail: number;
}

/** Everything a tool is allowed to do, provided by the editor session. */
export interface ToolContext {
  readonly data: VoxelData;
  readonly colorIndex: number;
  readonly buildPlane: BuildPlane;
  /** place/erase footprint in cells (block-aligned when > 1) */
  readonly brushSize: number;
  pick(clientX: number, clientY: number): PickResult | null;
  /** cell where the ray crosses the plane at `planeCoord`, axis forced to `cellValue` */
  pickOnPlane(
    clientX: number,
    clientY: number,
    axis: 0 | 1 | 2,
    planeCoord: number,
    cellValue: number,
  ): THREE.Vector3 | null;
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
  /** current voxel selection (select tool + selection ops) */
  readonly selection: Selection | null;
  setSelection(selection: Selection | null): void;
}

export interface Tool {
  readonly id: ToolId;
  pointerDown(ctx: ToolContext, p: PointerInfo): void;
  pointerMove(ctx: ToolContext, p: PointerInfo): void;
  pointerUp(ctx: ToolContext, p: PointerInfo): void;
  /** pointer left the canvas or tool switched away */
  clearPreview(ctx: ToolContext): void;
}
