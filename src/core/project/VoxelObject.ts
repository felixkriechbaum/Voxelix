import { VoxelData } from '@/core/voxel/VoxelData';
import { CELLS_PER_VOXEL } from '@/core/voxel/constants';
import type { ColorAdjust, ObjectKind, VoxelObjectJson } from './types';

export class VoxelObject {
  id: string;
  name: string;
  kind: ObjectKind;
  baseId?: string;
  data: VoxelData;
  pivot: 'bottom-center' | 'min-corner';
  /** grid cells per voxel edge: 1 = coarse, or CELLS_PER_VOXEL once subdivided */
  detail: number;
  /** per-object saturation/brightness shift; undefined = unchanged */
  colorAdjust?: ColorAdjust;

  constructor(opts: {
    id?: string;
    name: string;
    kind?: ObjectKind;
    baseId?: string;
    data: VoxelData;
    pivot?: 'bottom-center' | 'min-corner';
    detail?: number;
    colorAdjust?: ColorAdjust;
  }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.kind = opts.kind ?? 'normal';
    this.baseId = opts.baseId;
    this.data = opts.data;
    this.pivot = opts.pivot ?? 'bottom-center';
    this.detail = Math.min(CELLS_PER_VOXEL, Math.max(1, Math.round(opts.detail ?? 1)));
    this.colorAdjust = opts.colorAdjust;
  }

  toJSON(): VoxelObjectJson {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      baseId: this.baseId,
      data: this.data.toJSON(),
      pivot: this.pivot,
      detail: this.detail,
      colorAdjust: this.colorAdjust,
    };
  }

  static fromJSON(json: VoxelObjectJson): VoxelObject {
    return new VoxelObject({
      id: json.id,
      name: json.name,
      kind: json.kind,
      baseId: json.baseId,
      data: VoxelData.fromJSON(json.data),
      pivot: json.pivot,
      detail: json.detail,
      colorAdjust: json.colorAdjust,
    });
  }
}
