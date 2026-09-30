/// <reference lib="webworker" />
import { greedyMesh } from './greedyMesh';
import { surfaceNets } from './surfaceNets';
import type { ChunkMeshes, MeshJob, MeshResult, SmoothJob, SmoothResult } from './meshTypes';

type Inbound =
  | { kind: 'palette'; palette: Float32Array }
  | { kind: 'jobs'; jobs: MeshJob[] }
  | { kind: 'smooth'; job: SmoothJob };

let paletteLinear: Float32Array<ArrayBufferLike> = new Float32Array(256 * 4);

function post(result: MeshResult | SmoothResult, meshes: ChunkMeshes): void {
  const { opaque, glass } = meshes;
  const buffers = [opaque, glass].flatMap((m) => [m.positions.buffer, m.normals.buffer, m.colors.buffer, m.indices.buffer]);
  (self as DedicatedWorkerGlobalScope).postMessage(result, buffers as ArrayBuffer[]);
}

function run(job: MeshJob): void {
  const meshes = greedyMesh(job.padded, job.palette ?? paletteLinear, job.origin[0], job.origin[1], job.origin[2]);
  post({ objectId: job.objectId, chunkKey: job.chunkKey, ...meshes }, meshes);
}

function runSmooth(job: SmoothJob): void {
  const meshes = surfaceNets(job.grid, job.palette, job.strength, job.detail);
  post({ kind: 'smooth', key: job.key, seq: job.seq, ...meshes }, meshes);
}

self.onmessage = (e: MessageEvent<Inbound>) => {
  const msg = e.data;
  if (msg.kind === 'palette') {
    paletteLinear = msg.palette;
    return;
  }
  if (msg.kind === 'smooth') {
    runSmooth(msg.job);
    return;
  }
  for (const job of msg.jobs) run(job);
};
