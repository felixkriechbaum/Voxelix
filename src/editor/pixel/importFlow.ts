import { usePixelStore } from '@/stores/pixel';
import { usePixelSession } from './session';
import { decodeImage, layerNameFor } from '@/pixel/importImage';
import { toast } from '@/editor/toasts';

const IMAGE_ACCEPT = 'image/png,image/gif,image/webp,image/jpeg,image/bmp';

/**
 * Brings an image in as a new layer on the active state. An image larger
 * than the canvas offers to grow the canvas first (every state and layer of
 * the element grows with it, centred), since cropping someone's texture
 * silently is worse than asking.
 */
export async function importImageBlob(blob: Blob, name: string): Promise<void> {
  const store = usePixelStore();
  const runner = usePixelSession().runner.value;
  const el = store.activeElement();
  if (!runner || !el) return;
  let img;
  try {
    img = await decodeImage(blob);
  } catch (e) {
    toast(`Could not import image: ${(e as Error).message}`, 'error');
    return;
  }
  if (img.width > el.width || img.height > el.height) {
    const w = Math.max(el.width, img.width);
    const h = Math.max(el.height, img.height);
    if (!window.confirm(`The image is ${img.width}×${img.height}, the canvas ${el.width}×${el.height}. Grow the canvas to ${w}×${h}? (Clears this part's undo history.)`)) return;
    store.resizeActiveElement(w, h, 'center');
  }
  if (runner.importLayer(img, name)) toast(`Imported "${name}" as a new layer`, 'success');
}

/** Opens the file chooser for an image and imports it as a layer. */
export function importImageFromDisk(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMAGE_ACCEPT;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void importImageBlob(file, layerNameFor(file));
  });
  input.click();
}
