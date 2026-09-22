import { PixelData } from './PixelData';
import { specFor } from './widgets';
import { clampContentMargins, clampPatch } from './ninepatch';
import { defaultNinePatch } from './types';
import type {
  ContentMargins,
  NinePatch,
  PixelLayerJson,
  PixelWidgetJson,
  StateId,
  WidgetType,
} from './types';

export class PixelWidget {
  id: string;
  name: string;
  type: WidgetType;
  width: number;
  height: number;
  patch: NinePatch;
  contentMargins: ContentMargins;
  states: Map<StateId, PixelData>;
  icons: Map<string, PixelData>;

  constructor(opts: {
    id?: string;
    name: string;
    type: WidgetType;
    width: number;
    height: number;
    patch?: NinePatch;
    contentMargins?: ContentMargins;
    states?: Map<StateId, PixelData>;
    icons?: Map<string, PixelData>;
  }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.type = opts.type;
    this.width = Math.max(1, Math.round(opts.width));
    this.height = Math.max(1, Math.round(opts.height));
    this.patch = opts.patch ?? defaultNinePatch();
    this.contentMargins = clampContentMargins(opts.contentMargins);
    this.states = opts.states ?? new Map();
    this.icons = opts.icons ?? new Map();
  }

  static createNew(name: string, type: WidgetType): PixelWidget {
    const spec = specFor(type);
    const [w, h] = spec.defaultSize;
    const widget = new PixelWidget({ name, type, width: w, height: h });
    const initialStates: StateId[] = spec.states.length ? spec.states : ['normal'];
    for (const s of initialStates) widget.states.set(s, new PixelData(w, h));
    for (const icon of spec.icons ?? []) widget.icons.set(icon.id, new PixelData(icon.size[0], icon.size[1]));
    return widget;
  }

  /**
   * Resizes every state's canvas in place (icons keep their own fixed size —
   * they're not tied to the widget's own canvas dimensions), clamping the
   * nine-patch margins so they never end up overlapping the new, possibly
   * smaller, bounds. A structural change, not a paint edit: callers should
   * drop any undo history for this widget's states afterwards, since a
   * PixelEdit's flat index is only meaningful for the width it was recorded
   * against.
   */
  resize(width: number, height: number, anchor: 'topleft' | 'center' = 'topleft'): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.width && h === this.height) return;
    for (const [id, data] of this.states) this.states.set(id, data.resize(w, h, anchor));
    this.width = w;
    this.height = h;
    this.patch = clampPatch(this.patch, w, h);
  }

  /** The canvas a given state paints into — falls back to 'normal' if the state hasn't been added. */
  stateData(id: StateId): PixelData {
    const existing = this.states.get(id);
    if (existing) return existing;
    let normal = this.states.get('normal');
    if (!normal) {
      normal = new PixelData(this.width, this.height);
      this.states.set('normal', normal);
    }
    return normal;
  }

  toJSON(): PixelWidgetJson {
    const states: Partial<Record<StateId, PixelLayerJson>> = {};
    for (const [id, data] of this.states) states[id] = data.toJSON();
    let icons: Record<string, PixelLayerJson> | undefined;
    if (this.icons.size) {
      icons = {};
      for (const [id, data] of this.icons) icons[id] = data.toJSON();
    }
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      width: this.width,
      height: this.height,
      patch: this.patch,
      contentMargins: this.contentMargins,
      states,
      icons,
    };
  }

  static fromJSON(json: PixelWidgetJson): PixelWidget {
    const widget = new PixelWidget({
      id: json.id,
      name: json.name,
      type: json.type,
      width: json.width,
      height: json.height,
      patch: json.patch,
      contentMargins: json.contentMargins,
    });
    for (const [id, layer] of Object.entries(json.states)) {
      widget.states.set(id as StateId, PixelData.fromJSON(layer as PixelLayerJson, json.width, json.height));
    }
    if (json.icons) {
      const spec = specFor(json.type);
      for (const [id, layer] of Object.entries(json.icons)) {
        const iconSpec = spec.icons?.find((i) => i.id === id);
        const [iw, ih] = iconSpec?.size ?? [json.width, json.height];
        widget.icons.set(id, PixelData.fromJSON(layer, iw, ih));
      }
    }
    return widget;
  }
}
