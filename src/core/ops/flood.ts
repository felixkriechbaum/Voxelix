import type { VoxelData } from '@/core/voxel/VoxelData';

/**
 * 6-connected flood fill from a seed voxel.
 * When `sameColour` is true it only spreads across voxels sharing the seed's
 * colour; otherwise across any solid voxel.
 */
export function floodRegion(
  data: VoxelData,
  sx: number,
  sy: number,
  sz: number,
  sameColour: boolean,
): Array<[number, number, number]> {
  const seed = data.get(sx, sy, sz);
  if (seed === 0) return [];
  const seedColour = seed;

  const out: Array<[number, number, number]> = [];
  const visited = new Set<string>();
  const stack: Array<[number, number, number]> = [[sx, sy, sz]];
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;

  while (stack.length) {
    const [x, y, z] = stack.pop()!;
    const key = k(x, y, z);
    if (visited.has(key)) continue;
    visited.add(key);

    const v = data.get(x, y, z);
    if (v === 0) continue;
    if (sameColour && v !== seedColour) continue;

    out.push([x, y, z]);
    stack.push([x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]);
  }
  return out;
}
