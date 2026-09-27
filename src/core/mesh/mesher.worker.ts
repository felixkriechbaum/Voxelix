/// <reference lib="webworker" />
import { greedyMesh } from './greedyMesh';
import type { MeshJob, MeshResult } from './meshTypes';

type Inbound =
  | { kind: 'palette'; palette: Float32Array }
  | { kind: 'jobs'; jobs: MeshJob[] };

let paletteLinear: Float32Array<ArrayBufferLike> = new Float32Array(256 * 4);

function run(job: MeshJob): void {
  const { opaque, glass } = greedyMesh(job.padded, job.palette ?? paletteLinear, job.origin[0], job.origin[1], job.origin[2]);
  const result: MeshResult = { objectId: job.objectId, chunkKey: job.chunkKey, opaque, glass };
  const buffers = [opaque, glass].flatMap((m) => [m.positions.buffer, m.normals.buffer, m.colors.buffer, m.indices.buffer]);
  (self as DedicatedWorkerGlobalScope).postMessage(result, buffers as ArrayBuffer[]);
}

self.onmessage = (e: MessageEvent<Inbound>) => {
  const msg = e.data;
  if (msg.kind === 'palette') {
    paletteLinear = msg.palette;
    return;
  }
  for (const job of msg.jobs) run(job);
};
