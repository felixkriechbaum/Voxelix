import { PALETTE_SIZE } from './voxel/constants';

/** A project palette: PALETTE_SIZE sRGB hex strings — "#rrggbb", or
 *  "#rrggbbaa" for a see-through colour (glass). Index 0 is a usable colour
 *  like any other. */
export type Palette = string[];

const DEFAULT_RAMPS = [
  ['#e6194b', '#f58231', '#ffe119', '#bfef45', '#3cb44b', '#42d4f4', '#4363d8', '#911eb4', '#f032e6'],
];

export function createDefaultPalette(): Palette {
  const p: Palette = new Array(PALETTE_SIZE).fill('#000000');
  // grayscale ramp on the first row
  for (let i = 0; i < 16; i++) {
    const v = Math.round((i / 15) * 255);
    p[i] = rgbToHex(v, v, v);
  }
  // a few saturated hues to start with
  const hues = DEFAULT_RAMPS[0];
  hues.forEach((hex, i) => {
    p[16 + i] = hex;
  });
  // fill the rest with a soft HSV sweep so slots are visible, not black
  for (let i = 32; i < PALETTE_SIZE; i++) {
    const t = (i - 32) / (PALETTE_SIZE - 32);
    const [r, g, b] = hsvToRgb(t, 0.5, 0.85);
    p[i] = rgbToHex(r, g, b);
  }
  return p;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Opacity of a palette colour, 0–1 ("#rrggbb" is fully opaque). */
export function hexAlpha(hex: string): number {
  const h = hex.replace('#', '');
  return h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
}

/** The colour without its alpha — what `<input type="color">` accepts. */
export function hexOpaque(hex: string): string {
  return `#${hex.replace('#', '').slice(0, 6)}`;
}

/** `hex` with opacity `alpha` (0–1); fully opaque stays in the short "#rrggbb" form. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  return a >= 255 ? hexOpaque(hex) : `${hexOpaque(hex)}${a.toString(16).padStart(2, '0')}`;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const s = Math.max(0, Math.min(1, c));
  return s <= 0.0031308 ? s * 12.92 : 1.055 * Math.pow(s, 1 / 2.4) - 0.055;
}

/** Floats per palette slot in the linear array: r, g, b (linear) + alpha. */
export const PALETTE_STRIDE = 4;

/** 256 * RGBA Float32Array, colour in linear space, for meshing and GLB vertex colours. */
export function paletteToLinearArray(palette: Palette): Float32Array {
  const out = new Float32Array(PALETTE_SIZE * PALETTE_STRIDE);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const hex = palette[i] ?? '#000000';
    const [r, g, b] = hexToRgb(hex);
    out[i * 4] = srgbToLinear(r);
    out[i * 4 + 1] = srgbToLinear(g);
    out[i * 4 + 2] = srgbToLinear(b);
    out[i * 4 + 3] = hexAlpha(hex);
  }
  return out;
}

/**
 * A per-object saturation/brightness shift, applied to a copy of the linear
 * palette at mesh/export time — the project's palette itself is never
 * touched, so other objects sharing the same palette slots are unaffected.
 * `saturation`/`brightness` are shifts in [-1, 1]; 0 means unchanged.
 */
export function adjustPaletteLinear(
  paletteLinear: Float32Array<ArrayBufferLike>,
  saturation: number,
  brightness: number,
): Float32Array {
  const out = new Float32Array(paletteLinear.length);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const r = linearToSrgb(paletteLinear[i * 4]) * 255;
    const g = linearToSrgb(paletteLinear[i * 4 + 1]) * 255;
    const b = linearToSrgb(paletteLinear[i * 4 + 2]) * 255;
    const [h, s, v] = rgbToHsv(r, g, b);
    const [nr, ng, nb] = hsvToRgb(
      h,
      Math.max(0, Math.min(1, s + saturation)),
      Math.max(0, Math.min(1, v + brightness)),
    );
    out[i * 4] = srgbToLinear(nr);
    out[i * 4 + 1] = srgbToLinear(ng);
    out[i * 4 + 2] = srgbToLinear(nb);
    out[i * 4 + 3] = paletteLinear[i * 4 + 3]; // a colour shift never changes opacity
  }
  return out;
}

/** RGB (0-255) to HSV, each component 0-1. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [r * 255, g * 255, b * 255];
}
