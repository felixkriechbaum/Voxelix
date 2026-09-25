import type { Palette } from '@/core/palette';

export type WidgetType =
  | 'button'
  | 'menubutton'
  | 'optionbutton'
  | 'checkbox'
  | 'checkbutton'
  | 'label'
  | 'richtextlabel'
  | 'lineedit'
  | 'textedit'
  | 'spinbox'
  | 'progressbar'
  | 'textureprogressbar'
  | 'hslider'
  | 'vslider'
  | 'hscrollbar'
  | 'vscrollbar'
  | 'panel'
  | 'panelcontainer'
  | 'scrollcontainer'
  | 'popuppanel'
  | 'tooltip'
  | 'window'
  | 'tabcontainer'
  | 'tabbar'
  | 'itemlist'
  | 'tree'
  | 'popupmenu'
  | 'hseparator'
  | 'vseparator'
  | 'freeform';

/**
 * One image inside an element — the Godot theme item name it exports as
 * ('normal', 'fill', 'grabber_highlight', 'checked', …). Which ids exist is
 * decided by the widget's spec (core/pixel/widgets.ts).
 */
export type StateId = string;

export interface NinePatch {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function defaultNinePatch(): NinePatch {
  return { left: 0, top: 0, right: 0, bottom: 0 };
}

export interface ContentMargins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function defaultContentMargins(): ContentMargins {
  return { left: -1, top: -1, right: -1, bottom: -1 };
}

/** Serialized form of one PixelData canvas. */
export interface PixelLayerJson {
  /** base64 of the Uint32 pixel array, row-major — RLE unless `enc` says otherwise */
  pixels: string;
  enc?: 'raw';
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'add' | 'difference';

/** One layer of a state image. */
export interface PixelStackLayerJson {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  blend: BlendMode;
  /** painting keeps each pixel's existing alpha (Photoshop's "lock transparent pixels") */
  alphaLock?: boolean;
  /** clipped to the alpha of the nearest unclipped layer below */
  clip?: boolean;
  data: PixelLayerJson;
  /** grayscale layer mask (red channel = visibility), same size as the layer */
  mask?: PixelLayerJson & { enabled: boolean };
}

/** A state image as a layer stack (format version 3+), bottom layer first. */
export interface PixelStackJson {
  layers: PixelStackLayerJson[];
  activeLayerId?: string;
}

/** One part of a widget (e.g. a ProgressBar's fill, a slider's grabber):
 *  a set of same-sized state images sharing one nine-patch. */
export interface PixelElementJson {
  width: number;
  height: number;
  patch: NinePatch;
  /** -1 uses the corresponding nine-patch margin. */
  contentMargins: ContentMargins;
  /** version ≤ 2 files hold a single flat canvas (PixelLayerJson) per state */
  states: Record<StateId, PixelStackJson | PixelLayerJson>;
}

export interface PixelWidgetJson {
  id: string;
  name: string;
  type: WidgetType;
  /** keyed by the spec's element id; absent in version-1 files */
  elements?: Record<string, PixelElementJson>;

  // ---- version 1 (single canvas per widget) — read-only, migrated on load
  width?: number;
  height?: number;
  patch?: NinePatch;
  contentMargins?: ContentMargins;
  states?: Record<string, PixelLayerJson>;
  icons?: Record<string, PixelLayerJson>;
}

export interface PixelProjectJson {
  format: 'voxelix-pixel';
  /** 1 = one canvas per widget; 2 = per-element canvases; 3 = each state is a layer stack */
  version: 1 | 2 | 3;
  id: string;
  name: string;
  /** swatch shelf, reused from core/palette.ts — not a storage index */
  palette: Palette;
  widgets: PixelWidgetJson[];
  activeWidgetId: string | null;
}

export const PIXEL_FILE_EXT = '.voxui';

/** Largest canvas edge the editor allows (per element). */
export const MAX_CANVAS = 1024;

/** Largest corner radius the rectangle tool offers. */
export const MAX_CORNER_RADIUS = 32;
