import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { greedyMesh } from '@/core/mesh/greedyMesh';
import type { MeshArrays } from '@/core/mesh/meshTypes';
import { paletteToLinearArray, type Palette } from '@/core/palette';
import { resolveEffectiveData } from '@/core/project/resolve';
import type { VoxelData } from '@/core/voxel/VoxelData';
import type { VoxelObject } from '@/core/project/VoxelObject';
import type { Project } from '@/core/project/Project';
import type { ExportSettings } from '@/core/project/types';

/** Greedy-mesh every chunk of an object and concatenate into one mesh. */
export function buildMergedArrays(data: VoxelData, paletteLinear: Float32Array): MeshArrays {
  const parts: MeshArrays[] = [];
  let vcount = 0;
  let icount = 0;
  for (const key of data.allChunkKeys()) {
    const padded = data.extractPadded(key);
    const o = data.chunkOrigin(key);
    const m = greedyMesh(padded, paletteLinear, o.x, o.y, o.z);
    if (m.indices.length === 0) continue;
    parts.push(m);
    vcount += m.positions.length / 3;
    icount += m.indices.length;
  }
  const positions = new Float32Array(vcount * 3);
  const normals = new Float32Array(vcount * 3);
  const colors = new Float32Array(vcount * 3);
  const indices = new Uint32Array(icount);
  let vo = 0;
  let io = 0;
  for (const m of parts) {
    positions.set(m.positions, vo * 3);
    normals.set(m.normals, vo * 3);
    colors.set(m.colors, vo * 3);
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
  effectiveData: VoxelData,
  palette: Palette,
  settings: ExportSettings,
): Promise<GlbFile | null> {
  const bounds = effectiveData.filledBounds();
  if (!bounds) return null;

  const paletteLinear = paletteToLinearArray(palette);
  const arrays = buildMergedArrays(effectiveData, paletteLinear);

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

  const s = settings.unitsPerVoxel;
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
  geom.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3));
  geom.setIndex(new THREE.BufferAttribute(arrays.indices, 1));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geom, material);
  mesh.name = object.name;

  const exporter = new GLTFExporter();
  const result = (await exporter.parseAsync(mesh, {
    binary: true,
    onlyVisible: false,
  })) as ArrayBuffer;

  geom.dispose();
  material.dispose();
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
    const data = resolveEffectiveData(obj, project);
    const file = await exportObjectToGlb(obj, data, project.palette, project.exportSettings);
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
