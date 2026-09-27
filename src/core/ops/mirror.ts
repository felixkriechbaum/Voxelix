/** Which axes are mirrored: [x, y, z]. X is flipped by the YZ plane, Y by XZ, Z by XY. */
export type MirrorAxes = readonly [boolean, boolean, boolean];

export type Vec3 = [number, number, number];

export function anyMirror(axes: MirrorAxes): boolean {
  return axes[0] || axes[1] || axes[2];
}

/**
 * Every mirror image of cell `c` in a grid of `size`, the cell itself excluded.
 * Each enabled plane runs through the grid centre, so cell `x` maps to
 * `size - 1 - x`. With several planes on, all combinations are produced (up to
 * 7 images); a cell sitting on a plane maps onto itself and is deduplicated.
 * Brush blocks stay intact: the cells of an aligned block mirror to the cells
 * of an aligned block whenever the grid size is a multiple of the brush.
 */
export function mirrorImages(c: Vec3, size: Vec3, axes: MirrorAxes): Vec3[] {
  let out: Vec3[] = [c];
  for (let a = 0; a < 3; a++) {
    if (!axes[a]) continue;
    const flipped = size[a] - 1 - c[a];
    if (flipped === c[a]) continue;
    out = out.concat(
      out.map((p) => {
        const q: Vec3 = [p[0], p[1], p[2]];
        q[a] = flipped;
        return q;
      }),
    );
  }
  return out.slice(1);
}

/** Mirror images of the half-open box [min, max) — for the ghost cursor. */
export function mirrorBoxes(min: Vec3, max: Vec3, size: Vec3, axes: MirrorAxes): Array<[Vec3, Vec3]> {
  let out: Array<[Vec3, Vec3]> = [[min, max]];
  for (let a = 0; a < 3; a++) {
    if (!axes[a]) continue;
    const lo = size[a] - max[a];
    if (lo === min[a]) continue; // box is symmetric about this plane
    out = out.concat(
      out.map(([mn, mx]) => {
        const n: Vec3 = [mn[0], mn[1], mn[2]];
        const x: Vec3 = [mx[0], mx[1], mx[2]];
        n[a] = size[a] - mx[a];
        x[a] = size[a] - mn[a];
        return [n, x] as [Vec3, Vec3];
      }),
    );
  }
  return out.slice(1);
}
