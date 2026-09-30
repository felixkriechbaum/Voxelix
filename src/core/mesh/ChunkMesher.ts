import MesherWorker from './mesher.worker?worker';
import type { MeshJob, MeshResult, SmoothJob, SmoothResult } from './meshTypes';
import type { VoxelData } from '@/core/voxel/VoxelData';

/** Owns the mesher worker and turns dirty chunks into geometry off the main thread. */
export class ChunkMesher {
  private worker: Worker;
  private handler: ((r: MeshResult) => void) | null = null;
  private smoothHandler: ((r: SmoothResult) => void) | null = null;

  constructor() {
    this.worker = new MesherWorker();
    this.worker.onmessage = (e: MessageEvent<MeshResult | SmoothResult>) => {
      const r = e.data;
      if ('kind' in r) this.smoothHandler?.(r);
      else this.handler?.(r);
    };
  }

  onResult(fn: (r: MeshResult) => void): void {
    this.handler = fn;
  }

  onSmoothResult(fn: (r: SmoothResult) => void): void {
    this.smoothHandler = fn;
  }

  /** Un-voxel one part as a whole (a surface can't be cut into chunks without seams). */
  meshSmooth(job: SmoothJob): void {
    this.worker.postMessage({ kind: 'smooth', job }, [job.grid.cells.buffer as ArrayBuffer]);
  }

  setPalette(paletteLinear: Float32Array<ArrayBufferLike>): void {
    this.worker.postMessage({ kind: 'palette', palette: paletteLinear.slice() });
  }

  /** Queue meshing for one or more chunks in a single message. `palette`, when
   *  given, overrides the shared palette for this object only (e.g. a
   *  per-object saturation/brightness shift) without touching it. */
  meshChunks(
    objectId: string,
    data: VoxelData,
    chunkKeys: Iterable<number>,
    palette?: Float32Array,
  ): void {
    const jobs: MeshJob[] = [];
    const transfer: Transferable[] = [];
    for (const chunkKey of chunkKeys) {
      const padded = data.extractPadded(chunkKey);
      const o = data.chunkOrigin(chunkKey);
      jobs.push({ objectId, chunkKey, padded, origin: [o.x, o.y, o.z], palette });
      transfer.push(padded.buffer as ArrayBuffer);
    }
    if (jobs.length > 0) this.worker.postMessage({ kind: 'jobs', jobs }, transfer);
  }

  dispose(): void {
    this.worker.terminate();
  }
}
