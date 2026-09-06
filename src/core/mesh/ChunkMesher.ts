import MesherWorker from './mesher.worker?worker';
import type { MeshResult } from './meshTypes';
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

  meshChunk(objectId: string, data: VoxelData, chunkKey: number): void {
    const padded = data.extractPadded(chunkKey);
    const o = data.chunkOrigin(chunkKey);
    this.worker.postMessage(
      { kind: 'job', job: { objectId, chunkKey, padded, origin: [o.x, o.y, o.z] } },
      [padded.buffer],
    );
  }

  dispose(): void {
    this.worker.terminate();
  }
}
