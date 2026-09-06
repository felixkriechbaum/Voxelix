/// <reference lib="webworker" />
import { greedyMesh } from './greedyMesh';
import type { MeshJob, MeshResult } from './meshTypes';

type Inbound =
  | { kind: 'palette'; palette: Float32Array }
  | { kind: 'job'; job: MeshJob };

let paletteLinear: Float32Array<ArrayBufferLike> = new Float32Array(768);

self.onmessage = (e: MessageEvent<Inbound>) => {
  const msg = e.data;
  if (msg.kind === 'palette') {
    paletteLinear = msg.palette;
    return;
  }
  const { job } = msg;
  const mesh = greedyMesh(job.padded, paletteLinear, job.origin[0], job.origin[1], job.origin[2]);
  const result: MeshResult = {
    objectId: job.objectId,
    chunkKey: job.chunkKey,
    positions: mesh.positions,
    normals: mesh.normals,
    colors: mesh.colors,
    indices: mesh.indices,
  };
  (self as DedicatedWorkerGlobalScope).postMessage(result, [
    mesh.positions.buffer,
    mesh.normals.buffer,
    mesh.colors.buffer,
    mesh.indices.buffer,
  ]);
};
