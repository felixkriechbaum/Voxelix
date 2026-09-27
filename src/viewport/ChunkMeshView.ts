import * as THREE from 'three';
import type { VoxelData } from '@/core/voxel/VoxelData';
import type { ChunkMesher } from '@/core/mesh/ChunkMesher';
import type { MeshArrays, MeshResult } from '@/core/mesh/meshTypes';

export interface ChunkMeshViewOpts {
  /** dim + cool tint + slight transparency — for a locked extend base */
  dimmed?: boolean;
}

/** Renders a VoxelData as one THREE.Mesh per non-empty chunk, meshed off-thread. */
export class ChunkMeshView {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  /** see-through voxels (palette alpha < 1), one mesh per chunk, blended */
  private glassMeshes = new Map<number, THREE.Mesh>();
  private material: THREE.MeshStandardMaterial;
  private glassMaterial: THREE.MeshStandardMaterial;
  private paletteOverride: Float32Array | undefined;
  private baseOpacity: number;
  private baseTransparent: boolean;

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
    this.baseOpacity = this.material.opacity;
    this.baseTransparent = this.material.transparent;
    // vertex alpha carries each colour's own opacity; a glossier finish reads as glass
    this.glassMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.2,
      metalness: 0,
      color: this.material.color.clone(),
      transparent: true,
      depthWrite: false,
      opacity: this.material.opacity,
    });
    data.markAllChunksDirty();
  }

  /** X-ray: faint and depth-write-free so voxels behind show through. */
  setXray(on: boolean): void {
    const m = this.material;
    m.transparent = on || this.baseTransparent;
    m.opacity = on ? this.baseOpacity * 0.3 : this.baseOpacity;
    m.depthWrite = !on;
    m.needsUpdate = true;
    this.glassMaterial.opacity = on ? this.baseOpacity * 0.3 : this.baseOpacity;
    this.glassMaterial.needsUpdate = true;
  }

  /** Swap in a freshly-derived grid (extend re-resolve, resize) and re-mesh it.
   *  Meshes for chunks that no longer exist in the new grid are dropped so a
   *  shrunk grid can't leave ghosts; surviving chunks keep their mesh (no flicker
   *  on the per-frame extend refresh) and get their geometry replaced by flush(). */
  setData(data: VoxelData): void {
    this.data = data;
    const valid = new Set(data.allChunkKeys());
    for (const map of [this.meshes, this.glassMeshes]) {
      for (const [k, m] of map) {
        if (valid.has(k)) continue;
        this.group.remove(m);
        m.geometry.dispose();
        map.delete(k);
      }
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
    this.applyArrays(this.meshes, r.chunkKey, r.opaque, this.material);
    this.applyArrays(this.glassMeshes, r.chunkKey, r.glass, this.glassMaterial);
  }

  private applyArrays(
    map: Map<number, THREE.Mesh>,
    chunkKey: number,
    arrays: MeshArrays,
    material: THREE.Material,
  ): void {
    const existing = map.get(chunkKey);
    if (arrays.indices.length === 0) {
      if (existing) {
        this.group.remove(existing);
        existing.geometry.dispose();
        map.delete(chunkKey);
      }
      return;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 4));
    geom.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
    geom.computeBoundingSphere();
    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geom;
    } else {
      const mesh = new THREE.Mesh(geom, material);
      mesh.userData.chunkKey = chunkKey;
      map.set(chunkKey, mesh);
      this.group.add(mesh);
    }
  }

  /** Glass included — a pane has to be clickable to paint or erase it. */
  raycastTargets(): THREE.Mesh[] {
    return [...this.meshes.values(), ...this.glassMeshes.values()];
  }

  dispose(): void {
    for (const m of [...this.meshes.values(), ...this.glassMeshes.values()]) m.geometry.dispose();
    this.meshes.clear();
    this.glassMeshes.clear();
    this.material.dispose();
    this.glassMaterial.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
