import { VoxelData } from '@/core/voxel/VoxelData';
import { clampSubdivision, type ObjectKind, type VoxelObjectJson } from './types';

export class VoxelObject {
  id: string;
  name: string;
  kind: ObjectKind;
  baseId?: string;
  data: VoxelData;
  pivot: 'bottom-center' | 'min-corner';
  /** grid cells per block edge; 1 = classic full-block grid */
  subdivision: number;

  constructor(opts: {
    id?: string;
    name: string;
    kind?: ObjectKind;
    baseId?: string;
    data: VoxelData;
    pivot?: 'bottom-center' | 'min-corner';
    subdivision?: number;
  }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.kind = opts.kind ?? 'normal';
    this.baseId = opts.baseId;
    this.data = opts.data;
    this.pivot = opts.pivot ?? 'bottom-center';
    this.subdivision = clampSubdivision(opts.subdivision);
  }

  toJSON(): VoxelObjectJson {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      baseId: this.baseId,
      data: this.data.toJSON(),
      pivot: this.pivot,
      subdivision: this.subdivision,
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
      subdivision: json.subdivision,
    });
  }
}
