/**
 * Packed RGBA8 helpers. Layout is little-endian-explicit (r in bits 0-7, a in
 * bits 24-31) so it matches Canvas ImageData byte order regardless of host
 * endianness — see PixelData.asImageBuffer().
 */

export function packRgba(r: number, g: number, b: number, a: number): number {
  return (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
}

export function unpackRgba(v: number): [number, number, number, number] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

export function hexToRgba(hex: string, alpha = 255): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return packRgba(r, g, b, alpha);
}

/** Drops alpha — for swatch/palette display, which is always opaque. */
export function rgbaToHex(v: number): string {
  const [r, g, b] = unpackRgba(v);
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export const TRANSPARENT: number = 0;
