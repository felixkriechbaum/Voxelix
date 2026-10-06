import { VoxelData } from '@/core/voxel/VoxelData';
import { CELLS_PER_VOXEL } from '@/core/voxel/constants';
import { mergeParts, VoxelPart } from './parts';
import type { ColorAdjust, ObjectKind, VoxelObjectJson } from './types';

export class VoxelObject {
  id: string;
  name: string;
  kind: ObjectKind;
  baseId?: string;
  /**
   * The object's meshes. All share one grid (same size + detail); export merges
   * them, modifiers applied, into a single mesh. An extend overlay always has
   * exactly one part — its diff.
   */
  parts: VoxelPart[];
  /** the part tools edit */
  activePartId: string;
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
    /** a single-part object's voxels (ignored when `parts` is given) */
    data?: VoxelData;
    parts?: VoxelPart[];
    activePartId?: string;
    pivot?: 'bottom-center' | 'min-corner';
    detail?: number;
    colorAdjust?: ColorAdjust;
  }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.kind = opts.kind ?? 'normal';
    this.baseId = opts.baseId;
    this.parts =
      opts.parts && opts.parts.length > 0
        ? opts.parts
        : [new VoxelPart({ name: 'Part 1', data: opts.data ?? new VoxelData(16, 16, 16) })];
    this.activePartId = this.parts.some((p) => p.id === opts.activePartId) ? opts.activePartId! : this.parts[0].id;
    this.pivot = opts.pivot ?? 'bottom-center';
    this.detail = Math.min(CELLS_PER_VOXEL, Math.max(1, Math.round(opts.detail ?? 1)));
    this.colorAdjust = opts.colorAdjust;
  }

  get activePart(): VoxelPart {
    return this.parts.find((p) => p.id === this.activePartId) ?? this.parts[0];
  }

  /** The active part's voxels — what tools read and write. */
  get data(): VoxelData {
    return this.activePart.data;
  }
  set data(value: VoxelData) {
    this.activePart.data = value;
  }

  /** More than a plain single grid: several parts, modifiers generating voxels, or a hidden part. */
  get isComposite(): boolean {
    return this.parts.length > 1 || this.parts.some((p) => p.hasActiveModifiers || p.hidden);
  }

  /** What the object looks like: every visible part merged, modifiers applied. */
  merged(): VoxelData {
    return this.isComposite ? mergeParts(this.parts, this.detail) : this.parts[0].data;
  }

  /** Collapse to a single plain part holding the merged look (used when turning into an overlay). */
  flatten(): void {
    if (!this.isComposite && this.parts.length === 1) return;
    const part = new VoxelPart({ name: 'Part 1', data: this.merged() });
    this.parts = [part];
    this.activePartId = part.id;
  }

  toJSON(): VoxelObjectJson {
    const json: VoxelObjectJson = {
      id: this.id,
      name: this.name,
      kind: this.kind,
      baseId: this.baseId,
      // always the finished look, so older versions still open the file correctly
      data: this.merged().toJSON(),
      pivot: this.pivot,
      detail: this.detail,
      colorAdjust: this.colorAdjust,
    };
    if (this.parts.length > 1 || this.parts[0].modifiers.length > 0 || this.parts[0].hidden) {
      json.parts = this.parts.map((p) => p.toJSON());
      json.activePartId = this.activePartId;
    }
    return json;
  }

  static fromJSON(json: VoxelObjectJson): VoxelObject {
    return new VoxelObject({
      id: json.id,
      name: json.name,
      kind: json.kind,
      baseId: json.baseId,
      data: VoxelData.fromJSON(json.data),
      parts: json.parts?.map((p) => VoxelPart.fromJSON(p)),
      activePartId: json.activePartId,
      pivot: json.pivot,
      detail: json.detail,
      colorAdjust: json.colorAdjust,
    });
  }
}
