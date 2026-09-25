import { colorsMatch } from './flood';

export type Adjustment =
  /** hue in degrees (-180..180), saturation / lightness in -100..100 */
  | { kind: 'hsl'; hue: number; saturation: number; lightness: number }
  /** both -100..100 */
  | { kind: 'brightnessContrast'; brightness: number; contrast: number }
  | { kind: 'invert' }
  | { kind: 'desaturate' }
  /** 2..32 levels per channel */
  | { kind: 'posterize'; levels: number }
  /** swaps every pixel matching `from` (within tolerance) for `to`, keeping each pixel's own alpha when `to` is opaque */
  | { kind: 'replace'; from: number; to: number; tolerance: number };

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(hk + 1 / 3) * 255, f(hk) * 255, f(hk - 1 / 3) * 255];
}

/** Move a 0..1 value toward 1 (amount > 0) or 0 (amount < 0) by |amount| percent — Photoshop-style slider response. */
function shift01(v: number, amount: number): number {
  const a = amount / 100;
  return a >= 0 ? v + (1 - v) * a : v * (1 + a);
}

function adjustOne(v: number, adj: Adjustment): number {
  const a = v >>> 24;
  if (a === 0 && adj.kind !== 'replace') return v;
  let r = v & 0xff;
  let g = (v >>> 8) & 0xff;
  let b = (v >>> 16) & 0xff;
  switch (adj.kind) {
    case 'hsl': {
      const [h, s, l] = rgbToHsl(r, g, b);
      [r, g, b] = hslToRgb(h + adj.hue, Math.min(1, Math.max(0, shift01(s, adj.saturation))), Math.min(1, Math.max(0, shift01(l, adj.lightness))));
      break;
    }
    case 'brightnessContrast': {
      const c = adj.contrast * 2.55;
      const f = (259 * (c + 255)) / (255 * (259 - c));
      const br = adj.brightness * 1.28;
      r = (r - 128) * f + 128 + br;
      g = (g - 128) * f + 128 + br;
      b = (b - 128) * f + 128 + br;
      break;
    }
    case 'invert':
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
      break;
    case 'desaturate': {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = y;
      break;
    }
    case 'posterize': {
      const n = Math.max(2, Math.min(32, Math.round(adj.levels))) - 1;
      r = (Math.round((r / 255) * n) / n) * 255;
      g = (Math.round((g / 255) * n) / n) * 255;
      b = (Math.round((b / 255) * n) / n) * 255;
      break;
    }
    case 'replace': {
      if (!colorsMatch(v, adj.from, adj.tolerance)) return v;
      const to = adj.to >>> 0;
      // an opaque target keeps the pixel's own alpha, so anti-aliased / faded edges stay faded
      if (to >>> 24 === 255 && a > 0) return ((a << 24) | (to & 0xffffff)) >>> 0;
      return to;
    }
  }
  return ((a << 24) | (clamp255(b) << 16) | (clamp255(g) << 8) | clamp255(r)) >>> 0;
}

/** A new buffer with `adj` applied to the selected pixels (every pixel when `sel` is null). Alpha is left alone. */
export function adjustPixels(src: Uint32Array, sel: Uint8Array | null, adj: Adjustment): Uint32Array {
  const out = src.slice();
  // many pixels share a colour in pixel art — memoise per distinct value
  const memo = new Map<number, number>();
  for (let i = 0; i < src.length; i++) {
    if (sel && !sel[i]) continue;
    const v = src[i];
    let r = memo.get(v);
    if (r === undefined) {
      r = adjustOne(v, adj);
      if (memo.size < 65536) memo.set(v, r);
    }
    out[i] = r;
  }
  return out;
}
