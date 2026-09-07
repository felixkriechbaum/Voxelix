import MesherWorker from './mesher.worker?worker';
import type { MeshJob, MeshResult } from './meshTypes';
import type { VoxelData } from '@/core/voxel/VoxelData';

/** Owns the mesher worker and turns dirty chunks into geometry off the main thread. */
export class ChunkMesher {
  private worker: Worker;
  private handler: ((r: MeshResult) => void) | null = null;

  constructor() {
    this.worker = new MesherWorker();
    this.worker.onmessage = (e: MessageEvent<MeshResult>) => this.handler?.(e.data);
  }

  onResult(fn: (r: MeshResult) => void): void {
    this.handler = fn;
  }

  setPalette(paletteLinear: Float32Array<ArrayBufferLike>): void {
    this.worker.postMessage({ kind: 'palette', palette: paletteLinear.slice() });
  }

  /** Queue meshing for one or more chunks in a single message. */
  meshChunks(objectId: string, data: VoxelData, chunkKeys: Iterable<number>): void {
    const jobs: MeshJob[] = [];
    const transfer: Transferable[] = [];
    for (const chunkKey of chunkKeys) {
      const padded = data.extractPadded(chunkKey);
      const o = data.chunkOrigin(chunkKey);
      jobs.push({ objectId, chunkKey, padded, origin: [o.x, o.y, o.z] });
      transfer.push(padded.buffer as ArrayBuffer);
    }
    if (jobs.length > 0) this.worker.postMessage({ kind: 'jobs', jobs }, transfer);
  }

  dispose(): void {
    this.worker.terminate();
  }
}
