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
  /** base64 of a Uint16Array, one entry per filled-chunk, prefixed by chunk key. */
  chunks: Record<string, string>;
}
