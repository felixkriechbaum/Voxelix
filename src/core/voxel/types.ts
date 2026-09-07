export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** One voxel write, used by tools to build undo/redo entries. */
export interface VoxelEdit {
  x: number;
  y: number;
  z: number;
  /** Stored cell value before the edit (0 = empty, else paletteIndex + 1). */
  prev: number;
  /** Stored cell value after the edit. */
  next: number;
}

/** Serialized form of a VoxelData grid inside a .voxproj file. */
export interface VoxelDataJson {
  size: [number, number, number];
  /**
   * chunk key -> base64. `enc: 'rle'` means run-length `[count, value]` u16 pairs
   * (small for the big solid regions a subdivided grid creates); anything else /
   * absent means a raw Uint16Array of one full chunk.
   */
  chunks: Record<string, string>;
  enc?: 'rle';
}
