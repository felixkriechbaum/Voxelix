/** Solid shapes, built upright in their own w × h × d box. */
export type SolidKind = 'box' | 'sphere' | 'dome' | 'cylinder' | 'cone' | 'pyramid' | 'wedge' | 'tube';
/** Flat shapes: a width × depth outline, `h` voxels thick, laid on a chosen plane. */
export type FlatKind = 'plane' | 'circle' | 'ring';
export type ShapeKind = SolidKind | FlatKind;

/** Which plane a flat shape lies in — same names as the build plane. */
export type ShapePlane = 'xz' | 'xy' | 'yz';

export const FLAT_KINDS: readonly FlatKind[] = ['plane', 'circle', 'ring'];

export function isFlat(kind: ShapeKind): kind is FlatKind {
  return (FLAT_KINDS as readonly string[]).includes(kind);
}

/** Shapes that are open by construction, so a "hollow" option means nothing. */
export function supportsHollow(kind: ShapeKind): boolean {
  return !isFlat(kind) && kind !== 'tube';
}

export interface ShapeSpec {
  kind: SolidKind;
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

/** In-plane axes [first, second] and the thickness axis of each plane (0=x, 1=y, 2=z). */
const PLANE_AXES: Record<ShapePlane, [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]> = {
  xz: [0, 2, 1],
  xy: [0, 1, 2],
  yz: [2, 1, 0],
};

export function planeAxes(plane: ShapePlane): [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] {
  return PLANE_AXES[plane];
}

/**
 * A flat shape: `size` × `depth` in the plane (along its first / second axis),
 * `thickness` voxels through it. Returns cells in object axes plus the extent
 * of the shape along x / y / z.
 */
export function voxelizeFlat(
  kind: FlatKind,
  plane: ShapePlane,
  size: number,
  depth: number,
  thickness: number,
): { cells: Array<[number, number, number]>; dims: [number, number, number] } {
  // build it lying flat — first axis → x, thickness → y, second axis → z —
  // then rotate the axes into the requested plane
  const solid: SolidKind = kind === 'plane' ? 'box' : kind === 'circle' ? 'cylinder' : 'tube';
  const flat = voxelizeShape({ kind: solid, w: size, h: thickness, d: depth, hollow: false });
  const [a, b, t] = PLANE_AXES[plane];
  const dims: [number, number, number] = [0, 0, 0];
  dims[a] = size;
  dims[b] = depth;
  dims[t] = thickness;
  const cells = flat.map(([u, th, v]) => {
    const c: [number, number, number] = [0, 0, 0];
    c[a] = u;
    c[b] = v;
    c[t] = th;
    return c;
  });
  return { cells, dims };
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

/** Inside the ellipse that fills the w × d footprint, cell centres tested. */
function inEllipse(x: number, z: number, w: number, d: number, scale = 1): boolean {
  const nx = (x + 0.5) / w - 0.5;
  const nz = (z + 0.5) / d - 0.5;
  return nx * nx * 4 + nz * nz * 4 <= scale * scale;
}

function solidAt(
  kind: SolidKind,
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
    case 'dome': {
      // the top half of a sphere: flat base on y = 0, h is the full rise
      const nx = (x + 0.5) / w - 0.5;
      const ny = (y + 0.5) / h;
      const nz = (z + 0.5) / d - 0.5;
      return nx * nx * 4 + ny * ny + nz * nz * 4 <= 1.0;
    }
    case 'cylinder':
      return inEllipse(x, z, w, d);
    case 'cone':
      return inEllipse(x, z, w, d, 1 - y / h);
    case 'pyramid': {
      const t = h <= 1 ? 0 : y / (h - 1);
      const halfW = (w / 2) * (1 - t);
      const halfD = (d / 2) * (1 - t);
      const cx = w / 2;
      const cz = d / 2;
      return Math.abs(x + 0.5 - cx) <= halfW && Math.abs(z + 0.5 - cz) <= halfD;
    }
    case 'wedge':
      // a ramp: full height at the back (z = 0), down to one voxel at the front
      return y + 0.5 <= h * (1 - z / d);
    case 'tube':
      // a cylinder wall one voxel thick, open at both ends
      return (
        inEllipse(x, z, w, d) &&
        !(inEllipse(x - 1, z, w, d) && inEllipse(x + 1, z, w, d) && inEllipse(x, z - 1, w, d) && inEllipse(x, z + 1, w, d))
      );
  }
}
