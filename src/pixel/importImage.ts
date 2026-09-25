import { MAX_CANVAS } from '@/core/pixel/types';
import type { ImportedImage } from '@/editor/pixel/PixelRunner';

/** Decodes an image file / clipboard blob into packed RGBA (straight alpha, same layout as PixelData). */
export async function decodeImage(blob: Blob): Promise<ImportedImage> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    if (bitmap.width > MAX_CANVAS || bitmap.height > MAX_CANVAS) {
      throw new Error(`image is ${bitmap.width}×${bitmap.height} — the editor supports up to ${MAX_CANVAS}×${MAX_CANVAS}`);
    }
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
    const pixels = new Uint32Array(c.width * c.height);
    for (let i = 0; i < pixels.length; i++) {
      const o = i * 4;
      const a = bytes[o + 3];
      pixels[i] = a === 0 ? 0 : ((a << 24) | (bytes[o + 2] << 16) | (bytes[o + 1] << 8) | bytes[o]) >>> 0;
    }
    return { width: c.width, height: c.height, pixels };
  } finally {
    bitmap.close();
  }
}

/** File name without extension, for the new layer's name. */
export function layerNameFor(file: { name?: string } | null, fallback = 'Image'): string {
  const n = file?.name?.replace(/\.[^.]+$/, '').trim();
  return n || fallback;
}
