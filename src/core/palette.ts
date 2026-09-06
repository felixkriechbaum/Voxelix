import { PALETTE_SIZE } from './voxel/constants';

/** A project palette: PALETTE_SIZE sRGB hex strings ("#rrggbb"). Index 0 is a
 *  usable colour like any other. */
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

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** 256 * 3 Float32Array in linear space, for meshing and GLB vertex colours. */
export function paletteToLinearArray(palette: Palette): Float32Array {
  const out = new Float32Array(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const [r, g, b] = hexToRgb(palette[i] ?? '#000000');
    out[i * 3] = srgbToLinear(r);
    out[i * 3 + 1] = srgbToLinear(g);
    out[i * 3 + 2] = srgbToLinear(b);
  }
  return out;
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
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
