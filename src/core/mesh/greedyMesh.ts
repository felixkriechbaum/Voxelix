import { CHUNK } from '@/core/voxel/constants';
import type { MeshArrays } from './meshTypes';

const PAD = CHUNK + 2;

function cell(data: Uint16Array, x: number, y: number, z: number): number {
  return data[x + 1 + (y + 1) * PAD + (z + 1) * PAD * PAD];
}

/**
 * Greedy mesh one chunk from its padded (CHUNK+2)^3 volume.
 * Coplanar faces of equal colour are merged into large quads; hidden faces are
 * dropped. Colours are baked per-vertex from `paletteLinear` (256 * 3, linear).
 * Voxel (x,y,z) fills the unit cube [x, x+1]; output is offset by (ox,oy,oz).
 */
export function greedyMesh(
  data: Uint16Array,
  paletteLinear: Float32Array<ArrayBufferLike>,
  ox: number,
  oy: number,
  oz: number,
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
          if ((a !== 0) === (b !== 0)) mask[n] = 0;
          else if (a !== 0) mask[n] = a; // front face, +d normal
          else mask[n] = -b; // back face, -d normal
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
          const cr = paletteLinear[colorIndex * 3];
          const cg = paletteLinear[colorIndex * 3 + 1];
          const cb = paletteLinear[colorIndex * 3 + 2];
          for (const p of corners) {
            positions.push(p[0] + ox, p[1] + oy, p[2] + oz);
            normals.push(q[0] * sign, q[1] * sign, q[2] * sign);
            colors.push(cr, cg, cb);
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
