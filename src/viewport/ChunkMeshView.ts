import * as THREE from 'three';
import type { VoxelData } from '@/core/voxel/VoxelData';
import type { ChunkMesher } from '@/core/mesh/ChunkMesher';
import type { MeshResult } from '@/core/mesh/meshTypes';

export interface ChunkMeshViewOpts {
  /** dim + cool tint + slight transparency — for a locked extend base */
  dimmed?: boolean;
}

/** Renders a VoxelData as one THREE.Mesh per non-empty chunk, meshed off-thread. */
export class ChunkMeshView {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private material: THREE.MeshStandardMaterial;
  private paletteOverride: Float32Array | undefined;

  constructor(
    public readonly id: string,
    public data: VoxelData,
    private mesher: ChunkMesher,
    opts: ChunkMeshViewOpts = {},
  ) {
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      color: opts.dimmed ? new THREE.Color(0.5, 0.55, 0.68) : new THREE.Color(1, 1, 1),
      transparent: !!opts.dimmed,
      opacity: opts.dimmed ? 0.92 : 1,
    });
    data.markAllChunksDirty();
  }

  /** Swap in a freshly-derived grid (extend re-resolve, resize) and re-mesh it.
   *  Meshes for chunks that no longer exist in the new grid are dropped so a
   *  shrunk grid can't leave ghosts; surviving chunks keep their mesh (no flicker
   *  on the per-frame extend refresh) and get their geometry replaced by flush(). */
  setData(data: VoxelData): void {
    this.data = data;
    const valid = new Set(data.allChunkKeys());
    for (const [k, m] of this.meshes) {
      if (valid.has(k)) continue;
      this.group.remove(m);
      m.geometry.dispose();
      this.meshes.delete(k);
    }
    data.markAllChunksDirty();
    this.flush();
  }

  flush(): void {
    if (this.data.dirty.size > 0) {
      this.mesher.meshChunks(this.id, this.data, this.data.dirty, this.paletteOverride);
    }
    this.data.dirty.clear();
  }

  /** Re-mesh with a per-object palette override (e.g. a saturation/brightness
   *  shift), or null to fall back to the shared project palette. */
  setPaletteOverride(palette: Float32Array | null): void {
    this.paletteOverride = palette ?? undefined;
    this.data.markAllChunksDirty();
    this.flush();
  }

  applyResult(r: MeshResult): void {
    if (r.objectId !== this.id) return;
    const existing = this.meshes.get(r.chunkKey);
    if (r.indices.length === 0) {
      if (existing) {
        this.group.remove(existing);
        existing.geometry.dispose();
        this.meshes.delete(r.chunkKey);
      }
      return;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(r.colors, 3));
    geom.setIndex(new THREE.BufferAttribute(r.indices, 1));
    geom.computeBoundingSphere();
    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geom;
    } else {
      const mesh = new THREE.Mesh(geom, this.material);
      mesh.userData.chunkKey = r.chunkKey;
      this.meshes.set(r.chunkKey, mesh);
      this.group.add(mesh);
    }
  }

  raycastTargets(): THREE.Mesh[] {
    return [...this.meshes.values()];
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.geometry.dispose();
    this.meshes.clear();
    this.material.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
