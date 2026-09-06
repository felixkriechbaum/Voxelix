export type ShapeKind = 'box' | 'sphere' | 'cylinder' | 'pyramid';

export interface ShapeSpec {
  kind: ShapeKind;
  w: number;
  h: number;
  d: number;
  hollow: boolean;
}

/** Local voxel offsets (0..w-1 etc.) that make up the shape. */
export function voxelizeShape(spec: ShapeSpec): Array<[number, number, number]> {
  const { kind, w, h, d, hollow } = spec;
  const out: Array<[number, number, number]> = [];
  const filled = (x: number, y: number, z: number) => solidAt(kind, x, y, z, w, h, d);

  for (let z = 0; z < d; z++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!filled(x, y, z)) continue;
        if (hollow && isInterior(filled, x, y, z)) continue;
        out.push([x, y, z]);
      }
  return out;
}

function isInterior(
  filled: (x: number, y: number, z: number) => boolean,
  x: number,
  y: number,
  z: number,
): boolean {
  return (
    filled(x - 1, y, z) && filled(x + 1, y, z) &&
    filled(x, y - 1, z) && filled(x, y + 1, z) &&
    filled(x, y, z - 1) && filled(x, y, z + 1)
  );
}

function solidAt(
  kind: ShapeKind,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
): boolean {
  if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return false;
  switch (kind) {
    case 'box':
      return true;
    case 'sphere': {
      const nx = (x + 0.5) / w - 0.5;
      const ny = (y + 0.5) / h - 0.5;
      const nz = (z + 0.5) / d - 0.5;
      return nx * nx * 4 + ny * ny * 4 + nz * nz * 4 <= 1.0;
    }
    case 'cylinder': {
      const nx = (x + 0.5) / w - 0.5;
      const nz = (z + 0.5) / d - 0.5;
      return nx * nx * 4 + nz * nz * 4 <= 1.0;
    }
    case 'pyramid': {
      const t = h <= 1 ? 0 : y / (h - 1);
      const halfW = (w / 2) * (1 - t);
      const halfD = (d / 2) * (1 - t);
      const cx = w / 2;
      const cz = d / 2;
      return Math.abs(x + 0.5 - cx) <= halfW && Math.abs(z + 0.5 - cz) <= halfD;
    }
  }
}
