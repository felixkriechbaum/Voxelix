import type { VoxelData } from '@/core/voxel/VoxelData';

/**
 * An inclusive voxel-space box (`min`..`max` on each axis). When `cells` is set
 * the selection is exactly those voxels (smart / flood select); `min`/`max` are
 * then just their bounding box, used for the gizmo and hit-testing.
 */
export interface Selection {
  min: [number, number, number];
  max: [number, number, number];
  cells?: Array<[number, number, number]>;
}

export function makeSelection(
  a: [number, number, number],
  b: [number, number, number],
): Selection {
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

/** A selection of exactly these voxels (bounding box computed for the gizmo). */
export function cellSelection(cells: Array<[number, number, number]>): Selection | null {
  if (cells.length === 0) return null;
  const min: [number, number, number] = [...cells[0]];
  const max: [number, number, number] = [...cells[0]];
  for (const [x, y, z] of cells) {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  return { min, max, cells };
}

export function translateSelection(s: Selection, d: [number, number, number]): Selection {
  return {
    min: [s.min[0] + d[0], s.min[1] + d[1], s.min[2] + d[2]],
    max: [s.max[0] + d[0], s.max[1] + d[1], s.max[2] + d[2]],
    cells: s.cells?.map(([x, y, z]) => [x + d[0], y + d[1], z + d[2]] as [number, number, number]),
  };
}

/** Clamp a box to the grid; null if it ends up empty (fully outside). */
export function clampSelection(s: Selection, data: VoxelData): Selection | null {
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi - 1, v));
  const min: [number, number, number] = [
    clamp(s.min[0], data.sizeX),
    clamp(s.min[1], data.sizeY),
    clamp(s.min[2], data.sizeZ),
  ];
  const max: [number, number, number] = [
    clamp(s.max[0], data.sizeX),
    clamp(s.max[1], data.sizeY),
    clamp(s.max[2], data.sizeZ),
  ];
  if (min[0] > max[0] || min[1] > max[1] || min[2] > max[2]) return null;
  return { min, max };
}

/** True when the whole box lies within the grid. */
export function selectionFits(s: Selection, data: VoxelData): boolean {
  return (
    s.min[0] >= 0 &&
    s.min[1] >= 0 &&
    s.min[2] >= 0 &&
    s.max[0] < data.sizeX &&
    s.max[1] < data.sizeY &&
    s.max[2] < data.sizeZ
  );
}

export function selectionDims(s: Selection): [number, number, number] {
  return [s.max[0] - s.min[0] + 1, s.max[1] - s.min[1] + 1, s.max[2] - s.min[2] + 1];
}

export function selectionContains(s: Selection, x: number, y: number, z: number): boolean {
  return (
    x >= s.min[0] && x <= s.max[0] &&
    y >= s.min[1] && y <= s.max[1] &&
    z >= s.min[2] && z <= s.max[2]
  );
}

export interface SelectionCell {
  x: number;
  y: number;
  z: number;
  /** raw cell value (0 excluded), i.e. paletteIndex + 1 */
  v: number;
}

/** Every solid cell in the selection, with its raw value. */
export function selectionCells(data: VoxelData, s: Selection): SelectionCell[] {
  const out: SelectionCell[] = [];
  if (s.cells) {
    for (const [x, y, z] of s.cells) {
      const v = data.get(x, y, z);
      if (v !== 0) out.push({ x, y, z, v });
    }
    return out;
  }
  for (let z = s.min[2]; z <= s.max[2]; z++)
    for (let y = s.min[1]; y <= s.max[1]; y++)
      for (let x = s.min[0]; x <= s.max[0]; x++) {
        const v = data.get(x, y, z);
        if (v !== 0) out.push({ x, y, z, v });
      }
  return out;
}
