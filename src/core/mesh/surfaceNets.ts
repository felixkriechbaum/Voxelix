import type { VoxelData } from '@/core/voxel/VoxelData';
import { CELLS_PER_VOXEL } from '@/core/voxel/constants';
import type { ChunkMeshes, MeshArrays } from './meshTypes';

/**
 * The filled block of a part's grid to un-voxel: `cells` holds raw values
 * (0 = empty, else paletteIndex + 1) for an nx × ny × nz box whose low corner
 * sits at `origin` in the object's grid.
 */
export interface SmoothGrid {
  cells: Uint16Array;
  dims: [number, number, number];
  origin: [number, number, number];
}

/** How far strength 100 blurs the shape, in voxels. */
const REACH_AT_FULL = 3;
/** Box-blur passes — three of them come close to a gaussian. */
const PASSES = 3;
/** Past this many samples a coarse object is sampled less finely, to keep the memory in check. */
const SAMPLE_BUDGET = 12_000_000;
/** How far colours run into each other, as a share of how far the shape is blurred. */
const COLOR_SPREAD = 0.5;
/** Below this strength the corners still lean towards the voxel corners, so 0 → 1 doesn't jump. */
const BLEND_UNTIL = 10;

/** The filled part of `data` as a dense block, or null when it's empty. */
export function toSmoothGrid(data: VoxelData): SmoothGrid | null {
  const b = data.filledBounds();
  if (!b) return null;
  const origin: [number, number, number] = [b.min.x, b.min.y, b.min.z];
  const dims: [number, number, number] = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
  const cells = new Uint16Array(dims[0] * dims[1] * dims[2]);
  data.forEachFilled((x, y, z, c) => {
    cells[x - origin[0] + (y - origin[1]) * dims[0] + (z - origin[2]) * dims[0] * dims[1]] = c + 1;
  });
  return { cells, dims, origin };
}

/**
 * A smooth surface over a voxel grid, as two meshes like `greedyMesh`: the
 * opaque colours and the see-through ones.
 *
 * `strength` (0–100) blurs the voxels into a soft density field — occupancy
 * and colour alike (colours over half the distance), so colours run into
 * each other — and the surface is
 * where that field is half full, extracted as a surface net: one vertex per
 * cell of the sample lattice the surface passes through, at the mean of its
 * edge crossings, joined by a quad across every sample edge that changes
 * sides. With no blur the vertices sit on the voxel corners, which is the
 * voxel surface itself.
 *
 * As in the smooth modifier, a voxel stays while the blur there is over half
 * the fullest spot in reach, and empty space fills where it's over half full
 * — so thin rods and plates get rounded, neither melting away nor swelling.
 * `detail` is grid cells per voxel; a coarse grid is sampled several times
 * per cell, or it couldn't be rounded any finer than whole voxels.
 */
export function surfaceNets(
  grid: SmoothGrid,
  paletteLinear: Float32Array<ArrayBufferLike>,
  strength: number,
  detail: number,
): ChunkMeshes {
  const s = Math.max(0, Math.min(100, strength));
  const [gx, gy, gz] = grid.dims;
  // samples per grid cell
  let k = s > 0 ? Math.max(1, Math.ceil(CELLS_PER_VOXEL / Math.max(1, detail))) : 1;
  while (k > 1 && gx * gy * gz * k ** 3 > SAMPLE_BUDGET) k--;
  // blur radius of one pass, in samples (fractions allowed)
  const r = ((s / 100) * REACH_AT_FULL * detail * k) / PASSES;
  const reach = Math.ceil(r * PASSES);
  const pad = reach + 1;
  const nx = gx * k + 2 * pad;
  const ny = gy * k + 2 * pad;
  const nz = gz * k + 2 * pad;
  const sy = nx;
  const sz = nx * ny;
  const n = nx * ny * nz;
  const dims: [number, number, number] = [nx, ny, nz];

  // occupancy and colour × occupancy per sample
  const occ = new Float32Array(n);
  const rgba = [0, 1, 2, 3].map(() => new Float32Array(n));
  for (let z = 0; z < gz; z++)
    for (let y = 0; y < gy; y++)
      for (let x = 0; x < gx; x++) {
        const v = grid.cells[x + y * gx + z * gx * gy];
        if (v === 0) continue;
        const o = (v - 1) * 4;
        for (let dz = 0; dz < k; dz++)
          for (let dy = 0; dy < k; dy++)
            for (let dx = 0; dx < k; dx++) {
              const i = pad + x * k + dx + (pad + y * k + dy) * sy + (pad + z * k + dz) * sz;
              occ[i] = 1;
              for (let ch = 0; ch < 4; ch++) rgba[ch][i] = paletteLinear[o + ch];
            }
      }

  // the field the surface is cut from: the blurred occupancy — relative to
  // the local peak where there was a voxel, so thin bits keep their body, and
  // as it is elsewhere, so they don't swell either
  let field = occ;
  // colours blur over only part of that distance — kept apart as their own
  // occupancy + colour fields, so the colour mean stays a proper average
  let colorOcc = occ;
  let colorRgba = rgba;
  if (r > 0) {
    const solid = occ.slice();
    colorOcc = occ.slice();
    colorRgba = rgba.map((f) => f.slice());
    for (const f of [colorOcc, ...colorRgba]) blur(f, dims, r * COLOR_SPREAD);
    for (const f of [occ, ...rgba]) blur(f, dims, r);
    const peak = occ.slice();
    slidingMax(peak, dims, reach);
    field = new Float32Array(n);
    for (let i = 0; i < n; i++) field[i] = solid[i] && peak[i] > 1e-6 ? occ[i] / peak[i] : occ[i];
  }
  const inside = (i: number) => field[i] > 0.5;

  // one vertex per lattice cell (the cube between 8 samples) the surface crosses
  const vertexAt = new Int32Array(n).fill(-1);
  const pos: number[] = [];
  const col: number[] = [];
  const t = Math.min(1, s / BLEND_UNTIL);
  const corners = [0, 1, sy, 1 + sy, sz, 1 + sz, sy + sz, 1 + sy + sz];
  const cornerXYZ = [0, 1, 0, 1, 0, 1, 0, 1].map((cx, c) => [cx, (c >> 1) & 1, (c >> 2) & 1]);
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], // along x
    [0, 2], [1, 3], [4, 6], [5, 7], // along y
    [0, 4], [1, 5], [2, 6], [3, 7], // along z
  ];
  const vertex = (cell: number) => {
    let v = vertexAt[cell];
    if (v >= 0) return v;
    v = pos.length / 3;
    vertexAt[cell] = v;
    const x = cell % nx;
    const y = Math.floor(cell / sy) % ny;
    const z = Math.floor(cell / sz);
    // mean of the edge crossings of the half-full level
    let mx = 0, my = 0, mz = 0, m = 0;
    for (const [a, b] of edges) {
      const fa = field[cell + corners[a]] - 0.5;
      const fb = field[cell + corners[b]] - 0.5;
      if ((fa > 0) === (fb > 0)) continue;
      const u = fa / (fa - fb);
      const A = cornerXYZ[a], B = cornerXYZ[b];
      mx += A[0] + (B[0] - A[0]) * u;
      my += A[1] + (B[1] - A[1]) * u;
      mz += A[2] + (B[2] - A[2]) * u;
      m++;
    }
    const lx = 0.5 + ((m ? mx / m : 0.5) - 0.5) * t;
    const ly = 0.5 + ((m ? my / m : 0.5) - 0.5) * t;
    const lz = 0.5 + ((m ? mz / m : 0.5) - 0.5) * t;
    // sample (i) sits at cell coordinate (i - pad + 0.5) / k
    pos.push(
      grid.origin[0] + (x + lx - pad + 0.5) / k,
      grid.origin[1] + (y + ly - pad + 0.5) / k,
      grid.origin[2] + (z + lz - pad + 0.5) / k,
    );
    // colour: the blurred colour of the 8 samples, weighted by how full they
    // are; where the surface swelled out past the colour blur's reach (a
    // filled-in inner corner), the wider shape blur's colour stands in
    let w = 0;
    const c = [0, 0, 0, 0];
    for (const o of corners) {
      w += colorOcc[cell + o];
      for (let ch = 0; ch < 4; ch++) c[ch] += colorRgba[ch][cell + o];
    }
    if (w < 1e-3) {
      w = 0;
      c.fill(0);
      for (const o of corners) {
        w += occ[cell + o];
        for (let ch = 0; ch < 4; ch++) c[ch] += rgba[ch][cell + o];
      }
    }
    for (let ch = 0; ch < 4; ch++) col.push(w > 1e-6 ? c[ch] / w : 1);
    return v;
  };

  // a quad across every sample edge whose ends lie on different sides,
  // through the 4 lattice cells around that edge, facing out of the solid end
  const quads: number[] = [];
  const quadGlass: boolean[] = [];
  const strides = [1, sy, sz];
  for (let d = 0; d < 3; d++) {
    const su = strides[(d + 1) % 3];
    const sw = strides[(d + 2) % 3];
    const step = strides[d];
    for (let z = 1; z < nz - 1; z++)
      for (let y = 1; y < ny - 1; y++)
        for (let x = 1; x < nx - 1; x++) {
          const i = x + y * sy + z * sz;
          const a = inside(i);
          if (a === inside(i + step)) continue;
          // lattice cells are indexed by their low sample: the edge i → i+step
          // borders the cells at i, i − u, i − w, i − u − w
          const c00 = vertex(i - su - sw);
          const c10 = vertex(i - sw);
          const c11 = vertex(i);
          const c01 = vertex(i - su);
          // u × w = +d: this order faces +d, out of a solid `i`
          if (a) quads.push(c00, c10, c11, c01);
          else quads.push(c00, c01, c11, c10);
          const solid = a ? i : i + step;
          quadGlass.push(occ[solid] > 1e-6 && rgba[3][solid] / occ[solid] < 0.99);
        }
  }

  // smooth normals: area-weighted sum over the two triangles of each quad
  const vcount = pos.length / 3;
  const nrm = new Float32Array(vcount * 3);
  const addTri = (a: number, b: number, c: number) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      nrm[v * 3] += fx;
      nrm[v * 3 + 1] += fy;
      nrm[v * 3 + 2] += fz;
    }
  };
  for (let q = 0; q < quads.length; q += 4) {
    addTri(quads[q], quads[q + 1], quads[q + 2]);
    addTri(quads[q], quads[q + 2], quads[q + 3]);
  }
  for (let v = 0; v < vcount; v++) {
    const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1;
    nrm[v * 3] /= l;
    nrm[v * 3 + 1] /= l;
    nrm[v * 3 + 2] /= l;
  }

  const build = (glass: boolean): MeshArrays => {
    const remap = new Int32Array(vcount).fill(-1);
    const used: number[] = [];
    const indices: number[] = [];
    const take = (v: number) => {
      if (remap[v] < 0) {
        remap[v] = used.length;
        used.push(v);
      }
      return remap[v];
    };
    for (let q = 0, qi = 0; q < quads.length; q += 4, qi++) {
      if (quadGlass[qi] !== glass) continue;
      const a = take(quads[q]), b = take(quads[q + 1]), c = take(quads[q + 2]), d = take(quads[q + 3]);
      indices.push(a, b, c, a, c, d);
    }
    const positions = new Float32Array(used.length * 3);
    const normals = new Float32Array(used.length * 3);
    const colors = new Float32Array(used.length * 4);
    used.forEach((v, i) => {
      for (let ch = 0; ch < 3; ch++) {
        positions[i * 3 + ch] = pos[v * 3 + ch];
        normals[i * 3 + ch] = nrm[v * 3 + ch];
      }
      for (let ch = 0; ch < 4; ch++) colors[i * 4 + ch] = col[v * 4 + ch];
    });
    return { positions, normals, colors, indices: Uint32Array.from(indices) };
  };
  return { opaque: build(false), glass: build(true) };
}

/** `PASSES` box blurs of radius `r` (fractional: the outermost taps count by the fraction), along each axis. */
function blur(f: Float32Array, dims: [number, number, number], r: number): void {
  const ri = Math.floor(r);
  const frac = r - ri;
  const norm = 1 / (2 * r + 1);
  const strides = [1, dims[0], dims[0] * dims[1]];
  const line = new Float64Array(Math.max(...dims) + 1);
  const prefix = new Float64Array(line.length + 1);
  for (let pass = 0; pass < PASSES; pass++)
    for (let axis = 0; axis < 3; axis++) {
      const len = dims[axis];
      const step = strides[axis];
      const ua = (axis + 1) % 3;
      const va = (axis + 2) % 3;
      for (let v = 0; v < dims[va]; v++)
        for (let u = 0; u < dims[ua]; u++) {
          const base = u * strides[ua] + v * strides[va];
          let any = false;
          for (let i = 0; i < len; i++) {
            line[i] = f[base + i * step];
            prefix[i + 1] = prefix[i] + line[i];
            if (line[i] !== 0) any = true;
          }
          if (!any) continue;
          const at = (i: number) => (i >= 0 && i < len ? line[i] : 0);
          for (let i = 0; i < len; i++) {
            const lo = Math.max(0, i - ri);
            const hi = Math.min(len - 1, i + ri);
            const sum = prefix[hi + 1] - prefix[lo] + frac * (at(i - ri - 1) + at(i + ri + 1));
            f[base + i * step] = sum * norm;
          }
        }
    }
}

/** Replace every sample by the largest value within `reach` samples (a box, separable). */
function slidingMax(f: Float32Array, dims: [number, number, number], reach: number): void {
  const strides = [1, dims[0], dims[0] * dims[1]];
  const line = new Float32Array(Math.max(...dims));
  const deque = new Int32Array(line.length);
  for (let axis = 0; axis < 3; axis++) {
    const len = dims[axis];
    const step = strides[axis];
    const ua = (axis + 1) % 3;
    const va = (axis + 2) % 3;
    for (let v = 0; v < dims[va]; v++)
      for (let u = 0; u < dims[ua]; u++) {
        const base = u * strides[ua] + v * strides[va];
        for (let i = 0; i < len; i++) line[i] = f[base + i * step];
        // monotonic deque over the window [i - reach, i + reach]
        let head = 0, tail = 0, next = 0;
        for (let i = 0; i < len; i++) {
          for (; next < len && next <= i + reach; next++) {
            while (tail > head && line[deque[tail - 1]] <= line[next]) tail--;
            deque[tail++] = next;
          }
          while (deque[head] < i - reach) head++;
          f[base + i * step] = line[deque[head]];
        }
      }
  }
}
