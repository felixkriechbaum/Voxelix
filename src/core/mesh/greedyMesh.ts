import { CHUNK } from '@/core/voxel/constants';
import type { ChunkMeshes, MeshArrays } from './meshTypes';

const PAD = CHUNK + 2;

function cell(data: Uint16Array, x: number, y: number, z: number): number {
  return data[x + 1 + (y + 1) * PAD + (z + 1) * PAD * PAD];
}

/**
 * Greedy mesh one chunk from its padded (CHUNK+2)^3 volume, as two meshes:
 * the opaque voxels, and the see-through ones (palette alpha < 1, e.g. glass)
 * which need their own blended material.
 *
 * Coplanar faces of equal colour are merged into large quads; hidden faces are
 * dropped. What counts as hidden depends on transparency:
 *  - an opaque face shows wherever its neighbour is empty *or see-through*,
 *    so a wall behind a window pane is still drawn;
 *  - a see-through face shows against empty space or a *different* see-through
 *    colour — never against an opaque voxel, and never inside a block of the
 *    same glass (no internal panes).
 * Colours are baked per-vertex as RGBA from `paletteLinear` (256 × 4, linear).
 * Voxel (x,y,z) fills the unit cube [x, x+1]; output is offset by (ox,oy,oz).
 */
export function greedyMesh(
  data: Uint16Array,
  paletteLinear: Float32Array<ArrayBufferLike>,
  ox: number,
  oy: number,
  oz: number,
): ChunkMeshes {
  const see = (v: number) => v !== 0 && paletteLinear[(v - 1) * 4 + 3] < 1;
  const solid = (v: number) => v !== 0 && !see(v);

  const opaque = meshPass(data, paletteLinear, ox, oy, oz, (a, b) => {
    // front face (+d) of a, or back face (-d) of b, or nothing
    if (solid(a) && !solid(b)) return a;
    if (solid(b) && !solid(a)) return -b;
    return 0;
  });
  const glass = meshPass(data, paletteLinear, ox, oy, oz, (a, b) => {
    if (see(a) && (b === 0 || (see(b) && b !== a))) return a;
    if (see(b) && (a === 0 || (see(a) && a !== b))) return -b;
    return 0;
  });
  return { opaque, glass };
}

/**
 * One greedy pass. `face(a, b)` looks at the two cells either side of a slice
 * boundary and returns the cell value whose face to emit there — positive for
 * a's +d face, negative for b's -d face — or 0 for none.
 */
function meshPass(
  data: Uint16Array,
  paletteLinear: Float32Array<ArrayBufferLike>,
  ox: number,
  oy: number,
  oz: number,
  face: (a: number, b: number) => number,
): MeshArrays {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const dims = [CHUNK, CHUNK, CHUNK];
  const x = [0, 0, 0];
  const q = [0, 0, 0];
  const pos = [0, 0, 0];
  const au = [0, 0, 0];
  const av = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du = dims[u];
    const dv = dims[v];
    const dd = dims[d];
    q[0] = q[1] = q[2] = 0;
    q[d] = 1;
    const mask = new Int32Array(du * dv);

    for (let sliceD = -1; sliceD < dd; sliceD++) {
      let n = 0;
      for (x[v] = 0; x[v] < dv; x[v]++) {
        for (x[u] = 0; x[u] < du; x[u]++, n++) {
          x[d] = sliceD;
          const a = cell(data, x[0], x[1], x[2]);
          x[d] = sliceD + 1;
          const b = cell(data, x[0], x[1], x[2]);
          mask[n] = face(a, b);
        }
      }

      n = 0;
      for (let j = 0; j < dv; j++) {
        for (let i = 0; i < du; ) {
          const c = mask[n];
          if (c === 0) {
            i++;
            n++;
            continue;
          }
          let w = 1;
          while (i + w < du && mask[n + w] === c) w++;
          let h = 1;
          let stop = false;
          while (j + h < dv && !stop) {
            for (let k = 0; k < w; k++) {
              if (mask[n + k + h * du] !== c) {
                stop = true;
                break;
              }
            }
            if (!stop) h++;
          }

          const front = c > 0;
          const colorIndex = Math.abs(c) - 1;
          const sign = front ? 1 : -1;

          pos[d] = sliceD + 1;
          pos[u] = i;
          pos[v] = j;
          au[0] = au[1] = au[2] = 0;
          av[0] = av[1] = av[2] = 0;
          au[u] = w;
          av[v] = h;

          const base = positions.length / 3;
          const corners = [
            [pos[0], pos[1], pos[2]],
            [pos[0] + au[0], pos[1] + au[1], pos[2] + au[2]],
            [pos[0] + au[0] + av[0], pos[1] + au[1] + av[1], pos[2] + au[2] + av[2]],
            [pos[0] + av[0], pos[1] + av[1], pos[2] + av[2]],
          ];
          const cr = paletteLinear[colorIndex * 4];
          const cg = paletteLinear[colorIndex * 4 + 1];
          const cb = paletteLinear[colorIndex * 4 + 2];
          const ca = paletteLinear[colorIndex * 4 + 3];
          for (const p of corners) {
            positions.push(p[0] + ox, p[1] + oy, p[2] + oz);
            normals.push(q[0] * sign, q[1] * sign, q[2] * sign);
            colors.push(cr, cg, cb, ca);
          }
          if (front) {
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          } else {
            indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
          }

          for (let hh = 0; hh < h; hh++)
            for (let ww = 0; ww < w; ww++) mask[n + ww + hh * du] = 0;

          i += w;
          n += w;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
