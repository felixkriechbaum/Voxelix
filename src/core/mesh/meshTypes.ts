export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
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
export interface MeshResult {
  objectId: string;
  chunkKey: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export const EMPTY_MESH: MeshArrays = {
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
};
