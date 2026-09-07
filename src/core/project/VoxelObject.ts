import { VoxelData } from '@/core/voxel/VoxelData';
import { MAX_DETAIL } from '@/core/voxel/constants';
import type { ObjectKind, VoxelObjectJson } from './types';

export class VoxelObject {
  id: string;
  name: string;
  kind: ObjectKind;
  baseId?: string;
  data: VoxelData;
  pivot: 'bottom-center' | 'min-corner';
  /** grid cells per voxel edge (1 = coarse; up to MAX_DETAIL for finer placement) */
  detail: number;

  constructor(opts: {
    id?: string;
    name: string;
    kind?: ObjectKind;
    baseId?: string;
    data: VoxelData;
    pivot?: 'bottom-center' | 'min-corner';
    detail?: number;
  }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.kind = opts.kind ?? 'normal';
    this.baseId = opts.baseId;
    this.data = opts.data;
    this.pivot = opts.pivot ?? 'bottom-center';
    this.detail = Math.min(MAX_DETAIL, Math.max(1, Math.round(opts.detail ?? 1)));
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
    });
  }
}
