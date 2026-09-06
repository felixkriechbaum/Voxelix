import { VoxelData } from '@/core/voxel/VoxelData';
import type { ObjectKind, VoxelObjectJson } from './types';

export class VoxelObject {
  id: string;
  name: string;
  kind: ObjectKind;
  baseId?: string;
  data: VoxelData;
  pivot: 'bottom-center' | 'min-corner';

  constructor(opts: {
    id?: string;
    name: string;
    kind?: ObjectKind;
    baseId?: string;
    data: VoxelData;
    pivot?: 'bottom-center' | 'min-corner';
  }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.kind = opts.kind ?? 'normal';
    this.baseId = opts.baseId;
    this.data = opts.data;
    this.pivot = opts.pivot ?? 'bottom-center';
  }

  toJSON(): VoxelObjectJson {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      baseId: this.baseId,
      data: this.data.toJSON(),
      pivot: this.pivot,
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
    });
  }
}
