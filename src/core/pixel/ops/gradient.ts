export type GradientKind = 'linear' | 'radial';
/** smooth = per-pixel RGBA blend; dither = two-colour ordered (Bayer 4×4) dither, the pixel-art way */
export type GradientStyle = 'smooth' | 'dither';

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Position 0..1 of cell (px, py) along a gradient dragged from (x0, y0) to (x1, y1), all in cell units. */
export function gradientT(kind: GradientKind, x0: number, y0: number, x1: number, y1: number, px: number, py: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  let t: number;
  if (kind === 'radial') {
    t = Math.sqrt(((px - x0) ** 2 + (py - y0) ** 2) / len2);
  } else {
    t = ((px - x0) * dx + (py - y0) * dy) / len2;
  }
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Straight-alpha lerp of two packed RGBA values. */
export function lerpRgba(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >>> s) & 0xff) * (1 - t) + ((b >>> s) & 0xff) * t);
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

export function gradientColor(style: GradientStyle, from: number, to: number, t: number, x: number, y: number): number {
  if (style === 'dither') {
    const threshold = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
    return t < threshold ? from : to;
  }
  return lerpRgba(from, to, t);
}
