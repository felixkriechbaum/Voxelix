import { CHUNK, MAX_SIZE, REMOVED } from './constants';
import type { Bounds, VoxelDataJson } from './types';
import { u16ToBase64, base64ToU16 } from '@/core/io/serialize';

const CHUNK3 = CHUNK * CHUNK * CHUNK;

/**
 * One object's voxel grid, stored as sparse 16^3 chunks.
 * Cell value: 0 = empty, otherwise (paletteIndex + 1).
 */
export class VoxelData {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  private cx: number;
  private cy: number;
  private cz: number;
  private chunks = new Map<number, Uint16Array>();
  /** Chunk keys whose geometry needs rebuilding. */
  readonly dirty = new Set<number>();

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.sizeX = clampSize(sizeX);
    this.sizeY = clampSize(sizeY);
    this.sizeZ = clampSize(sizeZ);
    this.cx = Math.ceil(this.sizeX / CHUNK);
    this.cy = Math.ceil(this.sizeY / CHUNK);
    this.cz = Math.ceil(this.sizeZ / CHUNK);
  }

  get chunkCount(): { x: number; y: number; z: number } {
    return { x: this.cx, y: this.cy, z: this.cz };
  }

  chunkKey(ccx: number, ccy: number, ccz: number): number {
    return ccx + ccy * this.cx + ccz * this.cx * this.cy;
  }

  chunkOrigin(key: number): { x: number; y: number; z: number } {
    const ccx = key % this.cx;
    const ccy = ((key / this.cx) | 0) % this.cy;
    const ccz = (key / (this.cx * this.cy)) | 0;
    return { x: ccx * CHUNK, y: ccy * CHUNK, z: ccz * CHUNK };
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  /** Raw cell value (0 = empty, else paletteIndex + 1). Out of bounds -> 0. */
  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 0;
    const ccx = (x / CHUNK) | 0;
    const ccy = (y / CHUNK) | 0;
    const ccz = (z / CHUNK) | 0;
    const chunk = this.chunks.get(this.chunkKey(ccx, ccy, ccz));
    if (!chunk) return 0;
    const lx = x - ccx * CHUNK;
    const ly = y - ccy * CHUNK;
    const lz = z - ccz * CHUNK;
    return chunk[lx + ly * CHUNK + lz * CHUNK * CHUNK];
  }

  /** -1 when empty, otherwise the palette index. */
  getColor(x: number, y: number, z: number): number {
    return this.get(x, y, z) - 1;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== 0;
  }

  /** Writes a raw cell value. Returns the previous value. */
  setRaw(x: number, y: number, z: number, value: number): number {
    if (!this.inBounds(x, y, z)) return 0;
    const ccx = (x / CHUNK) | 0;
    const ccy = (y / CHUNK) | 0;
    const ccz = (z / CHUNK) | 0;
    const key = this.chunkKey(ccx, ccy, ccz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      if (value === 0) return 0;
      chunk = new Uint16Array(CHUNK3);
      this.chunks.set(key, chunk);
    }
    const lx = x - ccx * CHUNK;
    const ly = y - ccy * CHUNK;
    const lz = z - ccz * CHUNK;
    const i = lx + ly * CHUNK + lz * CHUNK * CHUNK;
    const prev = chunk[i];
    if (prev === value) return prev;
    chunk[i] = value;
    this.markDirtyAround(ccx, ccy, ccz, lx, ly, lz);
    return prev;
  }

  /** Sets a voxel to a palette colour. Returns the previous raw value. */
  set(x: number, y: number, z: number, paletteIndex: number): number {
    return this.setRaw(x, y, z, paletteIndex + 1);
  }

  clear(x: number, y: number, z: number): number {
    return this.setRaw(x, y, z, 0);
  }

  private markDirtyAround(ccx: number, ccy: number, ccz: number, lx: number, ly: number, lz: number): void {
    this.dirty.add(this.chunkKey(ccx, ccy, ccz));
    if (lx === 0 && ccx > 0) this.dirty.add(this.chunkKey(ccx - 1, ccy, ccz));
    if (lx === CHUNK - 1 && ccx < this.cx - 1) this.dirty.add(this.chunkKey(ccx + 1, ccy, ccz));
    if (ly === 0 && ccy > 0) this.dirty.add(this.chunkKey(ccx, ccy - 1, ccz));
    if (ly === CHUNK - 1 && ccy < this.cy - 1) this.dirty.add(this.chunkKey(ccx, ccy + 1, ccz));
    if (lz === 0 && ccz > 0) this.dirty.add(this.chunkKey(ccx, ccy, ccz - 1));
    if (lz === CHUNK - 1 && ccz < this.cz - 1) this.dirty.add(this.chunkKey(ccx, ccy, ccz + 1));
  }

  markAllChunksDirty(): void {
    for (let z = 0; z < this.cz; z++)
      for (let y = 0; y < this.cy; y++)
        for (let x = 0; x < this.cx; x++) this.dirty.add(this.chunkKey(x, y, z));
  }

  allChunkKeys(): number[] {
    const keys: number[] = [];
    for (let z = 0; z < this.cz; z++)
      for (let y = 0; y < this.cy; y++)
        for (let x = 0; x < this.cx; x++) keys.push(this.chunkKey(x, y, z));
    return keys;
  }

  /** (CHUNK + 2)^3 padded volume for one chunk so boundary faces cull correctly. */
  extractPadded(key: number): Uint16Array {
    const p = CHUNK + 2;
    const out = new Uint16Array(p * p * p);
    const { x: ox, y: oy, z: oz } = this.chunkOrigin(key);
    for (let z = -1; z <= CHUNK; z++)
      for (let y = -1; y <= CHUNK; y++)
        for (let x = -1; x <= CHUNK; x++) {
          const v = this.get(ox + x, oy + y, oz + z);
          if (v !== 0) out[x + 1 + (y + 1) * p + (z + 1) * p * p] = v;
        }
    return out;
  }

  forEachFilled(fn: (x: number, y: number, z: number, paletteIndex: number) => void): void {
    for (const [key, chunk] of this.chunks) {
      const { x: ox, y: oy, z: oz } = this.chunkOrigin(key);
      for (let i = 0; i < CHUNK3; i++) {
        const v = chunk[i];
        if (v === 0 || v === REMOVED) continue;
        const lx = i % CHUNK;
        const ly = ((i / CHUNK) | 0) % CHUNK;
        const lz = (i / (CHUNK * CHUNK)) | 0;
        fn(ox + lx, oy + ly, oz + lz, v - 1);
      }
    }
  }

  /** Every non-zero cell, including REMOVED markers. Used to resolve overlays. */
  forEachEntry(fn: (x: number, y: number, z: number, value: number) => void): void {
    for (const [key, chunk] of this.chunks) {
      const { x: ox, y: oy, z: oz } = this.chunkOrigin(key);
      for (let i = 0; i < CHUNK3; i++) {
        const v = chunk[i];
        if (v === 0) continue;
        const lx = i % CHUNK;
        const ly = ((i / CHUNK) | 0) % CHUNK;
        const lz = (i / (CHUNK * CHUNK)) | 0;
        fn(ox + lx, oy + ly, oz + lz, v);
      }
    }
  }

  isRemoved(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) === REMOVED;
  }

  isEmpty(): boolean {
    for (const chunk of this.chunks.values())
      for (let i = 0; i < CHUNK3; i++) if (chunk[i] !== 0) return false;
    return true;
  }

  /** Tight bounds of filled voxels (max exclusive). Null when empty. */
  filledBounds(): Bounds | null {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let any = false;
    this.forEachFilled((x, y, z) => {
      any = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    });
    if (!any) return null;
    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX + 1, y: maxY + 1, z: maxZ + 1 },
    };
  }

  clone(): VoxelData {
    const copy = new VoxelData(this.sizeX, this.sizeY, this.sizeZ);
    for (const [key, chunk] of this.chunks) copy.chunks.set(key, chunk.slice());
    copy.markAllChunksDirty();
    return copy;
  }

  resize(sizeX: number, sizeY: number, sizeZ: number): void {
    const next = new VoxelData(sizeX, sizeY, sizeZ);
    this.forEachFilled((x, y, z, c) => {
      if (next.inBounds(x, y, z)) next.set(x, y, z, c);
    });
    this.adopt(next);
  }

  /**
   * Rescale the grid by an integer factor while preserving physical extent:
   * `factor` 2 blows every cell up into a 2^3 block (so nothing visually shrinks
   * when the grid is subdivided); `factor` 0.5 collapses each 2^3 block back to
   * one cell. Keeps REMOVED overlay markers. Sizes are clamped to MAX_SIZE.
   */
  resample(factor: number): void {
    if (factor === 1 || factor <= 0) return;
    const next = new VoxelData(
      Math.round(this.sizeX * factor),
      Math.round(this.sizeY * factor),
      Math.round(this.sizeZ * factor),
    );
    if (factor > 1) {
      const f = Math.round(factor);
      this.forEachEntry((x, y, z, v) => {
        for (let dz = 0; dz < f; dz++)
          for (let dy = 0; dy < f; dy++)
            for (let dx = 0; dx < f; dx++) {
              if (next.inBounds(x * f + dx, y * f + dy, z * f + dz)) {
                next.setRaw(x * f + dx, y * f + dy, z * f + dz, v);
              }
            }
      });
    } else {
      const f = Math.round(1 / factor);
      this.forEachEntry((x, y, z, v) => {
        const px = (x / f) | 0;
        const py = (y / f) | 0;
        const pz = (z / f) | 0;
        // first non-empty cell in a block wins
        if (next.inBounds(px, py, pz) && next.get(px, py, pz) === 0) next.setRaw(px, py, pz, v);
      });
    }
    this.adopt(next);
  }

  private adopt(next: VoxelData): void {
    this.sizeX = next.sizeX;
    this.sizeY = next.sizeY;
    this.sizeZ = next.sizeZ;
    this.cx = next.cx;
    this.cy = next.cy;
    this.cz = next.cz;
    this.chunks = next.chunks;
    this.markAllChunksDirty();
  }

  toJSON(): VoxelDataJson {
    const chunks: Record<string, string> = {};
    for (const [key, chunk] of this.chunks) {
      let empty = true;
      for (let i = 0; i < CHUNK3; i++) if (chunk[i] !== 0) { empty = false; break; }
      if (empty) continue;
      chunks[key] = u16ToBase64(chunk);
    }
    return { size: [this.sizeX, this.sizeY, this.sizeZ], chunks };
  }

  static fromJSON(json: VoxelDataJson): VoxelData {
    const data = new VoxelData(json.size[0], json.size[1], json.size[2]);
    for (const [key, b64] of Object.entries(json.chunks)) {
      data.chunks.set(Number(key), base64ToU16(b64));
    }
    data.markAllChunksDirty();
    return data;
  }
}

function clampSize(n: number): number {
  return Math.max(1, Math.min(MAX_SIZE, Math.floor(n)));
}
