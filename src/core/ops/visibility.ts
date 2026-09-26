import type { VoxelData } from '@/core/voxel/VoxelData';
import type { Selection } from './selection';

/** Where the camera looks from, in cell space (meshes sit at the origin). */
export interface ViewRay {
  /** camera position */
  eye: [number, number, number];
  /** normalised view direction */
  dir: [number, number, number];
  /** parallel rays (orthographic camera) instead of rays converging on `eye` */
  ortho: boolean;
}

const FACES: Array<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];
/** where on a face (0..1 along its two in-plane axes) sight lines are tested */
const SAMPLES: Array<[number, number]> = [
  [0.5, 0.5],
  [0.15, 0.15], [0.85, 0.15],
  [0.15, 0.85], [0.85, 0.85],
];
const EPS = 1e-4;

/**
 * True when some exposed face of the solid cell at (x,y,z) has an unobstructed
 * line of sight to the camera — i.e. at least part of it is on screen, not
 * hidden behind other voxels.
 */
export function isCellVisible(data: VoxelData, x: number, y: number, z: number, view: ViewRay): boolean {
  const p = [0, 0, 0];
  const t = [0, 0, 0];
  for (const n of FACES) {
    if (data.get(x + n[0], y + n[1], z + n[2]) !== 0) continue; // covered face
    const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const [su, sv] of SAMPLES) {
      p[0] = x;
      p[1] = y;
      p[2] = z;
      p[axis] += n[axis] > 0 ? 1 + EPS : -EPS;
      p[u] += su;
      p[v] += sv;
      let maxT = Infinity;
      if (view.ortho) {
        t[0] = -view.dir[0];
        t[1] = -view.dir[1];
        t[2] = -view.dir[2];
      } else {
        t[0] = view.eye[0] - p[0];
        t[1] = view.eye[1] - p[1];
        t[2] = view.eye[2] - p[2];
        maxT = Math.hypot(t[0], t[1], t[2]);
        if (maxT === 0) continue;
        t[0] /= maxT;
        t[1] /= maxT;
        t[2] /= maxT;
      }
      if (t[0] * n[0] + t[1] * n[1] + t[2] * n[2] <= 0) break; // face turned away
      if (rayClear(data, p, t, maxT)) return true;
    }
  }
  return false;
}

/** Grid march (Amanatides–Woo) from `p` along unit `d`: false on the first solid cell. */
function rayClear(data: VoxelData, p: number[], d: number[], maxT: number): boolean {
  const size = [data.sizeX, data.sizeY, data.sizeZ];
  const cell = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  const step = [0, 0, 0];
  const tMax = [Infinity, Infinity, Infinity];
  const tDelta = [Infinity, Infinity, Infinity];
  for (let a = 0; a < 3; a++) {
    if (d[a] > 0) {
      step[a] = 1;
      tMax[a] = (cell[a] + 1 - p[a]) / d[a];
      tDelta[a] = 1 / d[a];
    } else if (d[a] < 0) {
      step[a] = -1;
      tMax[a] = (p[a] - cell[a]) / -d[a];
      tDelta[a] = -1 / d[a];
    }
  }
  let t = 0;
  for (;;) {
    // left the grid on an axis we're moving away along → nothing can block any more
    for (let a = 0; a < 3; a++) {
      if ((cell[a] < 0 && step[a] <= 0) || (cell[a] >= size[a] && step[a] >= 0)) return true;
    }
    if (data.get(cell[0], cell[1], cell[2]) !== 0) return false;
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    t = tMax[a];
    if (t > maxT) return true; // reached the camera
    cell[a] += step[a];
    tMax[a] += tDelta[a];
  }
}

/** Every solid cell inside the box that the camera can see. */
export function visibleCellsInBox(data: VoxelData, s: Selection, view: ViewRay): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let z = s.min[2]; z <= s.max[2]; z++)
    for (let y = s.min[1]; y <= s.max[1]; y++)
      for (let x = s.min[0]; x <= s.max[0]; x++) {
        if (data.get(x, y, z) !== 0 && isCellVisible(data, x, y, z, view)) out.push([x, y, z]);
      }
  return out;
}
