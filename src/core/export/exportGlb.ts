import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { greedyMesh } from '@/core/mesh/greedyMesh';
import { surfaceNets, toSmoothGrid } from '@/core/mesh/surfaceNets';
import type { ChunkMeshes, MeshArrays } from '@/core/mesh/meshTypes';
import { adjustPaletteLinear, paletteToLinearArray, type Palette } from '@/core/palette';
import { resolveLook, type ResolvedLook } from '@/core/project/resolve';
import type { VoxelData } from '@/core/voxel/VoxelData';
import type { VoxelObject } from '@/core/project/VoxelObject';
import type { Project } from '@/core/project/Project';
import { metersPerVoxel, type ExportSettings } from '@/core/project/types';

/** Let the browser paint (progress overlay, etc.) between bursts of work. */
const breathe = () => new Promise<void>((r) => setTimeout(r));

/** Greedy-mesh every chunk of an object; opaque and see-through geometry each concatenated. */
export async function buildMergedArrays(
  data: VoxelData,
  paletteLinear: Float32Array,
): Promise<ChunkMeshes> {
  const opaque: MeshArrays[] = [];
  const glass: MeshArrays[] = [];
  const keys = data.allChunkKeys();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const padded = data.extractPadded(key);
    const o = data.chunkOrigin(key);
    const m = greedyMesh(padded, paletteLinear, o.x, o.y, o.z);
    if (m.opaque.indices.length > 0) opaque.push(m.opaque);
    if (m.glass.indices.length > 0) glass.push(m.glass);
    if ((i & 31) === 31) await breathe();
  }
  return { opaque: concatArrays(opaque), glass: concatArrays(glass) };
}

function concatArrays(parts: MeshArrays[]): MeshArrays {
  let vcount = 0;
  let icount = 0;
  for (const m of parts) {
    vcount += m.positions.length / 3;
    icount += m.indices.length;
  }
  const positions = new Float32Array(vcount * 3);
  const normals = new Float32Array(vcount * 3);
  const colors = new Float32Array(vcount * 4);
  const indices = new Uint32Array(icount);
  let vo = 0;
  let io = 0;
  for (const m of parts) {
    positions.set(m.positions, vo * 3);
    normals.set(m.normals, vo * 3);
    colors.set(m.colors, vo * 4);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo;
    vo += m.positions.length / 3;
    io += m.indices.length;
  }
  return { positions, normals, colors, indices };
}

export interface GlbFile {
  name: string;
  blob: Blob;
}

/** Build a single .glb for one object, honouring pivot / scale / up-axis. */
export async function exportObjectToGlb(
  object: VoxelObject,
  look: ResolvedLook,
  palette: Palette,
  settings: ExportSettings,
): Promise<GlbFile | null> {
  const bounds = look.data.filledBounds();
  if (!bounds) return null;

  let paletteLinear = paletteToLinearArray(palette);
  const adj = object.colorAdjust;
  if (adj && (adj.saturation !== 0 || adj.brightness !== 0)) {
    paletteLinear = adjustPaletteLinear(paletteLinear, adj.saturation, adj.brightness);
  }
  // un-voxeled parts are smooth surfaces of their own; the rest stays voxels
  const split = await buildMergedArrays(look.voxelData, paletteLinear);
  for (const layer of look.smooth) {
    const grid = toSmoothGrid(layer.data);
    if (!grid) continue;
    await breathe();
    const smooth = surfaceNets(grid, paletteLinear, layer.strength, object.detail);
    split.opaque = concatArrays([split.opaque, smooth.opaque]);
    split.glass = concatArrays([split.glass, smooth.glass]);
  }
  // one mesh for the whole object; see-through voxels become a second
  // primitive with a blended material (glTF alphaMode BLEND)
  const opaqueIndexCount = split.opaque.indices.length;
  const glassIndexCount = split.glass.indices.length;
  const arrays = concatArrays([split.opaque, split.glass]);

  let ox: number;
  let oy: number;
  let oz: number;
  if (object.pivot === 'min-corner') {
    ox = -bounds.min.x;
    oy = -bounds.min.y;
    oz = -bounds.min.z;
  } else {
    ox = -(bounds.min.x + bounds.max.x) / 2;
    oy = -bounds.min.y;
    oz = -(bounds.min.z + bounds.max.z) / 2;
  }

  // a finer object stores several cells per voxel; scale each cell down to match
  const s = metersPerVoxel(settings) / Math.max(1, object.detail);
  const pos = arrays.positions;
  const nrm = arrays.normals;
  const zUp = settings.upAxis === 'z';
  for (let i = 0; i < pos.length; i += 3) {
    let x = (pos[i] + ox) * s;
    let y = (pos[i + 1] + oy) * s;
    let z = (pos[i + 2] + oz) * s;
    if (zUp) {
      const ry = -z;
      const rz = y;
      y = ry;
      z = rz;
    }
    pos[i] = x;
    pos[i + 1] = y;
    pos[i + 2] = z;
  }
  if (zUp) {
    for (let i = 0; i < nrm.length; i += 3) {
      const y = nrm[i + 1];
      const z = nrm[i + 2];
      nrm[i + 1] = -z;
      nrm[i + 2] = y;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 4));
  geom.setIndex(new THREE.BufferAttribute(arrays.indices, 1));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    name: 'glass',
    vertexColors: true,
    roughness: 0.2,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  });
  const materials: THREE.Material[] = [];
  if (opaqueIndexCount > 0) {
    geom.addGroup(0, opaqueIndexCount, materials.length);
    materials.push(material);
  }
  if (glassIndexCount > 0) {
    geom.addGroup(opaqueIndexCount, glassIndexCount, materials.length);
    materials.push(glassMaterial);
  }
  const mesh = new THREE.Mesh(geom, materials.length === 1 ? materials[0] : materials);
  if (materials.length === 1) geom.clearGroups();
  mesh.name = object.name;

  // Hand the exporter a named Scene, not a bare Mesh: given a loose object it
  // wraps one itself and hardcodes the name to "AuxScene", which is then what
  // Godot calls the imported scene's root. With a Scene the object's own name
  // carries through.
  const scene = new THREE.Scene();
  scene.name = object.name;
  scene.add(mesh);

  const exporter = new GLTFExporter();
  const result = (await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: false,
  })) as ArrayBuffer;

  geom.dispose();
  material.dispose();
  glassMaterial.dispose();
  return { name: `${sanitizeFilename(object.name)}.glb`, blob: new Blob([result], { type: 'model/gltf-binary' }) };
}

export function sanitizeFilename(name: string): string {
  return name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'object';
}

export interface BatchProgress {
  done: number;
  total: number;
  /** object currently being processed */
  name: string;
}

/**
 * Export every object in the project as its own `.glb`, resolving extend
 * overlays first. Empty objects are skipped; filename clashes get a `-2` suffix.
 */
export async function exportProjectToGlbs(
  project: Project,
  onProgress?: (p: BatchProgress) => void,
): Promise<GlbFile[]> {
  const files: GlbFile[] = [];
  const used = new Set<string>();
  const total = project.objects.length;
  let done = 0;
  for (const obj of project.objects) {
    onProgress?.({ done, total, name: obj.name });
    await breathe(); // let the overlay repaint before this object blocks
    const file = await exportObjectToGlb(obj, resolveLook(obj, project), project.palette, project.exportSettings);
    done++;
    if (file) {
      file.name = dedupeName(file.name, used);
      files.push(file);
    }
  }
  onProgress?.({ done, total, name: '' });
  return files;
}

function dedupeName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let i = 2; used.has(candidate); i++) candidate = `${stem}-${i}${ext}`;
  used.add(candidate);
  return candidate;
}
