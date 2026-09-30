import * as THREE from 'three';
import type { ChunkMesher } from '@/core/mesh/ChunkMesher';
import { EMPTY_MESH, type MeshArrays, type SmoothResult } from '@/core/mesh/meshTypes';
import { toSmoothGrid, type SmoothGrid } from '@/core/mesh/surfaceNets';
import type { VoxelData } from '@/core/voxel/VoxelData';

/**
 * One un-voxeled part, drawn as a smooth surface: a single mesh for the whole
 * part (plus one for its see-through colours), meshed off-thread. Not a pick
 * target — the part is edited through its voxel cage.
 */
export class SmoothMeshView {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private glassMesh: THREE.Mesh | null = null;
  private material: THREE.MeshStandardMaterial;
  private glassMaterial: THREE.MeshStandardMaterial;
  private grid: SmoothGrid | null = null;
  private strength = 0;
  private seq = 0;

  constructor(
    public readonly key: string,
    private mesher: ChunkMesher,
    private detail: number,
    public readonly dimmed: boolean,
  ) {
    const color = dimmed ? new THREE.Color(0.5, 0.55, 0.68) : new THREE.Color(1, 1, 1);
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0,
      color,
      transparent: dimmed,
      opacity: dimmed ? 0.92 : 1,
    });
    this.glassMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.2,
      metalness: 0,
      color: color.clone(),
      transparent: true,
      depthWrite: false,
      opacity: this.material.opacity,
    });
  }

  /** New voxels / strength / grid detail — re-mesh. */
  setData(data: VoxelData, strength: number, detail: number, palette: Float32Array): void {
    this.grid = toSmoothGrid(data);
    this.strength = strength;
    this.detail = detail;
    this.remesh(palette);
  }

  /** Same shape, new colours. */
  remesh(palette: Float32Array): void {
    const seq = ++this.seq;
    if (!this.grid) {
      this.apply({ kind: 'smooth', key: this.key, seq, opaque: EMPTY_MESH, glass: EMPTY_MESH });
      return;
    }
    // the worker takes the cells over, so keep our own copy for the next palette change
    const grid = { ...this.grid, cells: this.grid.cells.slice() };
    this.mesher.meshSmooth({ key: this.key, seq, grid, strength: this.strength, detail: this.detail, palette: palette.slice() });
  }

  /** Filled bounds in cell units, for framing the camera. */
  bounds(): THREE.Box3 | null {
    if (!this.grid) return null;
    const [x, y, z] = this.grid.origin;
    const [w, h, d] = this.grid.dims;
    return new THREE.Box3(new THREE.Vector3(x, y, z), new THREE.Vector3(x + w, y + h, z + d));
  }

  apply(r: SmoothResult): void {
    // results from an older job arriving late are dropped
    if (r.key !== this.key || r.seq !== this.seq) return;
    this.mesh = this.replace(this.mesh, r.opaque, this.material);
    this.glassMesh = this.replace(this.glassMesh, r.glass, this.glassMaterial);
  }

  private replace(existing: THREE.Mesh | null, arrays: MeshArrays, material: THREE.Material): THREE.Mesh | null {
    if (existing) {
      this.group.remove(existing);
      existing.geometry.dispose();
    }
    if (arrays.indices.length === 0) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 4));
    geom.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
    geom.computeBoundingSphere();
    const mesh = new THREE.Mesh(geom, material);
    this.group.add(mesh);
    return mesh;
  }

  dispose(): void {
    for (const m of [this.mesh, this.glassMesh]) m?.geometry.dispose();
    this.material.dispose();
    this.glassMaterial.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

