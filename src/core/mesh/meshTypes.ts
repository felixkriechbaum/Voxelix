import type { SmoothGrid } from './surfaceNets';

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  /** RGBA per vertex, linear colour + alpha */
  colors: Float32Array;
  indices: Uint32Array;
}

/** One chunk's geometry: opaque voxels, and see-through ones (glass) apart. */
export interface ChunkMeshes {
  opaque: MeshArrays;
  glass: MeshArrays;
}

/** Message sent to the mesher worker for one chunk. */
export interface MeshJob {
  objectId: string;
  chunkKey: number;
  /** padded (CHUNK + 2)^3 volume, raw cell values */
  padded: Uint16Array;
  /** chunk world-space origin */
  origin: [number, number, number];
  /** per-object palette override (e.g. a saturation/brightness shift); falls
   *  back to the shared palette set via the 'palette' message when absent */
  palette?: Float32Array;
}

/** Result posted back from the mesher worker. */
export interface MeshResult extends ChunkMeshes {
  objectId: string;
  chunkKey: number;
}

export const EMPTY_MESH: MeshArrays = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
};

/** Message sent to the mesher worker to un-voxel one part as a whole. */
export interface SmoothJob {
  key: string;
  /** newer jobs for the same key supersede older ones */
  seq: number;
  grid: SmoothGrid;
  strength: number;
  detail: number;
  palette: Float32Array;
}

/** Result posted back for a SmoothJob. */
export interface SmoothResult extends ChunkMeshes {
  kind: 'smooth';
  key: string;
  seq: number;
}
