import type { VoxelDataJson } from '@/core/voxel/types';
import type { Palette } from '@/core/palette';

export type ObjectKind = 'normal' | 'extend';

/** A single voxel object inside a project (serialized form). */
export interface VoxelObjectJson {
  id: string;
  name: string;
  kind: ObjectKind;
  /** set when kind === 'extend': the object this overlay builds on */
  baseId?: string;
  data: VoxelDataJson;
  /** per-object export pivot; default 'bottom-center' */
  pivot?: 'bottom-center' | 'min-corner';
  /** grid cells per voxel edge; default 1 */
  detail?: number;
}

export interface ExportSettings {
  /**
   * Scale reference: an edge of `refVoxels` voxels is exported as `refMeters`
   * metres (glTF units are metres). metres-per-voxel = refMeters / refVoxels.
   */
  refVoxels: number;
  refMeters: number;
  upAxis: 'y' | 'z';
  /** legacy absolute scale written by older files; folded into the ref pair on load */
  unitsPerVoxel?: number;
}

export interface ProjectJson {
  format: 'voxeleditor-project';
  version: 1;
  /** stable project identity; absent in files written before autosave existed */
  id?: string;
  name: string;
  palette: Palette;
  exportSettings: ExportSettings;
  objects: VoxelObjectJson[];
  activeObjectId: string | null;
}

export const PROJECT_FILE_EXT = '.voxproj';

export function defaultExportSettings(): ExportSettings {
  return { refVoxels: 16, refMeters: 1, upAxis: 'y' };
}

/** Metres per voxel for the exporter, from the ref pair (or a legacy value). */
export function metersPerVoxel(s: ExportSettings): number {
  if (s.refVoxels > 0 && s.refMeters > 0) return s.refMeters / s.refVoxels;
  return s.unitsPerVoxel && s.unitsPerVoxel > 0 ? s.unitsPerVoxel : 0.1;
}

/** Accept a possibly-legacy settings object from a .voxproj and normalise it. */
export function normalizeExportSettings(s: Partial<ExportSettings> | undefined | null): ExportSettings {
  if (s && typeof s.refVoxels === 'number' && typeof s.refMeters === 'number') {
    return { refVoxels: s.refVoxels, refMeters: s.refMeters, upAxis: s.upAxis ?? 'y' };
  }
  if (s && typeof s.unitsPerVoxel === 'number' && s.unitsPerVoxel > 0) {
    return { refVoxels: 1, refMeters: s.unitsPerVoxel, upAxis: s.upAxis ?? 'y' };
  }
  return defaultExportSettings();
}
