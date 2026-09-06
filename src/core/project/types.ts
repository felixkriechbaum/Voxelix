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
}

export interface ExportSettings {
  /** world units per voxel */
  unitsPerVoxel: number;
  upAxis: 'y' | 'z';
}

export interface ProjectJson {
  format: 'voxeleditor-project';
  version: 1;
  name: string;
  palette: Palette;
  exportSettings: ExportSettings;
  objects: VoxelObjectJson[];
  activeObjectId: string | null;
}

export const PROJECT_FILE_EXT = '.voxproj';

export function defaultExportSettings(): ExportSettings {
  return { unitsPerVoxel: 0.1, upAxis: 'y' };
}
