import type { PixelData } from '@/core/pixel/PixelData';
import { blitPixelData } from './blit';

/** Encode a PixelData canvas as a PNG blob, optionally scaled up with nearest-neighbour (no blur). */
export async function encodePng(data: PixelData, scale = 1): Promise<Blob> {
  const s = Math.max(1, Math.round(scale));
  const canvas = document.createElement('canvas');
  canvas.width = data.width * s;
  canvas.height = data.height * s;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  if (s === 1) {
    blitPixelData(ctx, data);
  } else {
    const off = document.createElement('canvas');
    off.width = data.width;
    off.height = data.height;
    const octx = off.getContext('2d');
    if (!octx) throw new Error('2D canvas context unavailable');
    blitPixelData(octx, data);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, data.width, data.height, 0, 0, canvas.width, canvas.height);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))), 'image/png');
  });
}
