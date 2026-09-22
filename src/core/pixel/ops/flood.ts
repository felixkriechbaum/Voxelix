import type { PixelData } from '@/core/pixel/PixelData';

/**
 * Flood fill from a seed pixel across cells matching its colour exactly
 * (including alpha and full transparency). `contiguous` toggles 4- vs
 * 8-connected spread.
 */
export function floodRegion(
  data: PixelData,
  sx: number,
  sy: number,
  contiguous: boolean,
): Array<[number, number]> {
  const seedColor = data.get(sx, sy);
  const out: Array<[number, number]> = [];
  const visited = new Uint8Array(data.width * data.height);
  const stack: Array<[number, number]> = [[sx, sy]];

  while (stack.length) {
    const [x, y] = stack.pop()!;
    const i = data.index(x, y);
    if (i < 0 || visited[i]) continue;
    visited[i] = 1;
    if (data.get(x, y) !== seedColor) continue;

    out.push([x, y]);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    if (!contiguous) {
      stack.push([x + 1, y + 1], [x - 1, y + 1], [x + 1, y - 1], [x - 1, y - 1]);
    }
  }
  return out;
}
