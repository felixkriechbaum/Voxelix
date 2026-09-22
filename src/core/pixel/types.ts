import type { Palette } from '@/core/palette';

export type WidgetType =
  | 'button'
  | 'optionbutton'
  | 'checkbox'
  | 'panel'
  | 'lineedit'
  | 'progressbar'
  | 'freeform';

export type StateId = 'normal' | 'hover' | 'pressed' | 'disabled' | 'focus';

export interface NinePatch {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function defaultNinePatch(): NinePatch {
  return { left: 0, top: 0, right: 0, bottom: 0 };
}

/** Serialized form of one PixelData canvas. */
export interface PixelLayerJson {
  /** RLE-base64 of the Uint32 pixel array, row-major */
  pixels: string;
}

export interface PixelWidgetJson {
  id: string;
  name: string;
  type: WidgetType;
  width: number;
  height: number;
  patch: NinePatch;
  /** one image per state; a missing state visually inherits 'normal' */
  states: Partial<Record<StateId, PixelLayerJson>>;
  /** extra parts, e.g. the OptionButton arrow */
  icons?: Record<string, PixelLayerJson>;
}

export interface PixelProjectJson {
  format: 'voxelix-pixel';
  version: 1;
  id: string;
  name: string;
  /** swatch shelf, reused from core/palette.ts — not a storage index */
  palette: Palette;
  widgets: PixelWidgetJson[];
  activeWidgetId: string | null;
}

export const PIXEL_FILE_EXT = '.voxui';
