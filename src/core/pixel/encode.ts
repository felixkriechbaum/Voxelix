import { base64ToBytes, base64ToRleU32, bytesToBase64, rleU32ToBase64 } from '@/core/io/serialize';
import type { PixelLayerJson } from './types';

/**
 * Packs a pixel buffer for the project file. RLE (6 bytes per run) wins for
 * flat pixel-art, but a noisy / imported 1024² texture has almost no runs and
 * would come out at 1.5× its raw size — so whichever is smaller is written,
 * tagged with `enc` (absent = RLE, which is what every older file has).
 */
export function encodePixels(px: Uint32Array): PixelLayerJson {
  let runs = 0;
  for (let i = 0; i < px.length; ) {
    const v = px[i];
    let run = 1;
    while (i + run < px.length && px[i + run] === v && run < 0xffff) run++;
    runs++;
    i += run;
  }
  if (runs * 6 <= px.length * 4) return { pixels: rleU32ToBase64(px) };
  const bytes = new Uint8Array(px.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < px.length; i++) view.setUint32(i * 4, px[i], true);
  return { pixels: bytesToBase64(bytes), enc: 'raw' };
}

export function decodePixels(json: PixelLayerJson, len: number): Uint32Array {
  if (json.enc !== 'raw') return base64ToRleU32(json.pixels, len);
  const bytes = base64ToBytes(json.pixels);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(len);
  const n = Math.min(len, Math.floor(bytes.byteLength / 4));
  for (let i = 0; i < n; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}
