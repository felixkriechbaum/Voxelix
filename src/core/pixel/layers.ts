import { PixelData, type PixelRect } from './PixelData';
import type { BlendMode, PixelLayerJson, PixelStackJson, PixelStackLayerJson } from './types';

export const BLEND_MODES: Array<{ id: BlendMode; label: string }> = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'add', label: 'Add' },
  { id: 'difference', label: 'Difference' },
];

/** Mask pixels are stored as opaque gray RGBA so every paint tool works on them unchanged; red = visibility. */
export function maskValue(v: number): number {
  const g = Math.max(0, Math.min(255, Math.round(v)));
  return ((255 << 24) | (g << 16) | (g << 8) | g) >>> 0;
}

export const MASK_WHITE = maskValue(255);
export const MASK_BLACK = maskValue(0);

export class PixelLayer {
  id: string;
  name: string;
  visible = true;
  /** 0..1 */
  opacity = 1;
  blend: BlendMode = 'normal';
  alphaLock = false;
  clip = false;
  data: PixelData;
  mask: PixelData | null = null;
  maskEnabled = true;

  constructor(name: string, data: PixelData, id?: string) {
    this.id = id ?? crypto.randomUUID();
    this.name = name;
    this.data = data;
  }

  /** Mask that actually affects the composite (null when absent or disabled). */
  get activeMask(): PixelData | null {
    return this.mask && this.maskEnabled ? this.mask : null;
  }

  snapshot(): LayerRecord {
    return {
      id: this.id,
      name: this.name,
      visible: this.visible,
      opacity: this.opacity,
      blend: this.blend,
      alphaLock: this.alphaLock,
      clip: this.clip,
      data: this.data,
      mask: this.mask,
      maskEnabled: this.maskEnabled,
    };
  }

  static fromRecord(r: LayerRecord): PixelLayer {
    const l = new PixelLayer(r.name, r.data, r.id);
    l.visible = r.visible;
    l.opacity = r.opacity;
    l.blend = r.blend;
    l.alphaLock = r.alphaLock;
    l.clip = r.clip;
    l.mask = r.mask;
    l.maskEnabled = r.maskEnabled;
    return l;
  }
}

/**
 * A layer's properties at one point in time. Pixel buffers are held by
 * reference: structural undo (add / delete / reorder / opacity / merge)
 * swaps records, while pixel edits are undone on the PixelData itself — so a
 * deleted-then-restored layer is the very same buffer later pixel undo
 * entries point at.
 */
export interface LayerRecord {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blend: BlendMode;
  readonly alphaLock: boolean;
  readonly clip: boolean;
  readonly data: PixelData;
  readonly mask: PixelData | null;
  readonly maskEnabled: boolean;
}

export interface StackSnapshot {
  readonly layers: readonly LayerRecord[];
  readonly activeId: string;
}

const BLEND_INDEX: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  add: 6,
  difference: 7,
};

function blendChannel(mode: number, cb: number, cs: number): number {
  switch (mode) {
    case 1:
      return (cb * cs) / 255;
    case 2:
      return cb + cs - (cb * cs) / 255;
    case 3:
      return cb < 128 ? (2 * cb * cs) / 255 : 255 - (2 * (255 - cb) * (255 - cs)) / 255;
    case 4:
      return cb < cs ? cb : cs;
    case 5:
      return cb > cs ? cb : cs;
    case 6:
      return cb + cs > 255 ? 255 : cb + cs;
    case 7:
      return cb > cs ? cb - cs : cs - cb;
    default:
      return cs;
  }
}

/**
 * Composites `layers` (bottom first) into `out` over `rect`, W3C
 * separable-blend style on straight alpha: the blend result is mixed in by
 * the backdrop's coverage, then source-over. Hidden layers are skipped; a
 * clipped layer is additionally scaled by the coverage of the nearest
 * unclipped layer below it (a clip group without a group buffer — exact for
 * Normal, close enough for the rest).
 */
export function compositeInto(layers: readonly PixelLayer[], width: number, out: Uint32Array, rect: PixelRect): void {
  const vis = layers.filter((l) => l.visible && l.opacity > 0);
  const n = vis.length;
  const px = vis.map((l) => l.data.pixels);
  const masks = vis.map((l) => l.activeMask?.pixels ?? null);
  const op = vis.map((l) => l.opacity);
  const mode = vis.map((l) => BLEND_INDEX[l.blend] ?? 0);
  // a clipped layer with nothing unclipped below it just draws normally
  const clip = vis.map((l, i) => l.clip && vis.slice(0, i).some((b) => !b.clip));

  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const row = y * width;
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = row + x;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let baseA = 0;
      for (let k = 0; k < n; k++) {
        const s = px[k][i];
        let sa = ((s >>> 24) / 255) * op[k];
        const m = masks[k];
        if (m) sa *= (m[i] & 0xff) / 255;
        if (clip[k]) sa *= baseA;
        else baseA = sa;
        if (sa <= 0) continue;
        let sr = s & 0xff;
        let sg = (s >>> 8) & 0xff;
        let sb = (s >>> 16) & 0xff;
        const md = mode[k];
        if (md !== 0 && a > 0) {
          sr = (1 - a) * sr + a * blendChannel(md, r, sr);
          sg = (1 - a) * sg + a * blendChannel(md, g, sg);
          sb = (1 - a) * sb + a * blendChannel(md, b, sb);
        }
        const ao = sa + a * (1 - sa);
        const kb = a * (1 - sa);
        r = (sa * sr + kb * r) / ao;
        g = (sa * sg + kb * g) / ao;
        b = (sa * sb + kb * b) / ao;
        a = ao;
      }
      if (a <= 0) {
        out[i] = 0;
        continue;
      }
      const A = Math.round(a * 255);
      out[i] = A === 0 ? 0 : ((A << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
    }
  }
}

/** Flattens layers into a fresh buffer. */
export function flattenLayers(layers: readonly PixelLayer[], width: number, height: number): Uint32Array {
  const out = new Uint32Array(width * height);
  compositeInto(layers, width, out, { x: 0, y: 0, w: width, h: height });
  return out;
}

/**
 * One state image: a stack of same-sized layers (bottom first) and a cached
 * composite. composite() is what everything downstream sees — renderer,
 * export, preview, onion skin — and it only recomputes the rect that changed
 * since the last call, tracked through each layer's PixelData revisions.
 */
export class LayerStack {
  readonly width: number;
  readonly height: number;
  layers: PixelLayer[];
  activeId: string;
  private comp: PixelData;
  private seen = new WeakMap<PixelData, number>();
  private structRev = 1;
  private compStruct = 0;
  /** true while composite() hands out a layer's own buffer (one plain layer — no copy, no compositing) */
  private aliased: PixelData | null = null;

  constructor(width: number, height: number, layers?: PixelLayer[], activeId?: string) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.layers = layers && layers.length ? layers : [new PixelLayer('Layer 1', new PixelData(this.width, this.height))];
    this.activeId = activeId && this.layers.some((l) => l.id === activeId) ? activeId : this.layers[this.layers.length - 1].id;
    this.comp = new PixelData(this.width, this.height);
  }

  static fromData(data: PixelData, name = 'Layer 1'): LayerStack {
    return new LayerStack(data.width, data.height, [new PixelLayer(name, data)]);
  }

  /** Call after any change to layer properties or order (not needed for pixel writes). */
  structureChanged(): void {
    this.structRev++;
  }

  get active(): PixelLayer {
    return this.layers.find((l) => l.id === this.activeId) ?? this.layers[this.layers.length - 1];
  }

  layer(id: string): PixelLayer | null {
    return this.layers.find((l) => l.id === id) ?? null;
  }

  indexOf(id: string): number {
    return this.layers.findIndex((l) => l.id === id);
  }

  private trivialLayer(): PixelLayer | null {
    const vis = this.layers.filter((l) => l.visible);
    if (vis.length !== 1) return null;
    const l = vis[0];
    return l.opacity >= 1 && !l.activeMask ? l : null;
  }

  composite(): PixelData {
    const trivial = this.trivialLayer();
    if (trivial) {
      this.aliased = trivial.data;
      return trivial.data;
    }
    let dirty: PixelRect | null = null;
    const full = this.compStruct !== this.structRev || this.aliased !== null;
    for (const l of this.layers) {
      for (const d of [l.data, l.mask]) {
        if (!d) continue;
        const since = this.seen.get(d) ?? 0;
        const r = full ? null : d.changedSince(since);
        this.seen.set(d, d.rev);
        if (r && l.visible) dirty = dirty ? union(dirty, r) : r;
      }
    }
    if (full) dirty = { x: 0, y: 0, w: this.width, h: this.height };
    this.aliased = null;
    this.compStruct = this.structRev;
    if (dirty) {
      compositeInto(this.layers, this.width, this.comp.pixels, dirty);
      this.comp.markChanged(dirty);
    }
    return this.comp;
  }

  isEmpty(): boolean {
    return this.composite().bounds() === null;
  }

  snapshot(): StackSnapshot {
    return { layers: this.layers.map((l) => l.snapshot()), activeId: this.activeId };
  }

  restore(s: StackSnapshot): void {
    this.layers = s.layers.map((r) => PixelLayer.fromRecord(r));
    this.activeId = s.activeId;
    this.structureChanged();
  }

  uniqueName(base: string): string {
    const names = new Set(this.layers.map((l) => l.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  nextLayerName(): string {
    for (let i = this.layers.length + 1; ; i++) if (!this.layers.some((l) => l.name === `Layer ${i}`)) return `Layer ${i}`;
  }

  /** Inserts above the active layer and makes it active. */
  addLayer(data?: PixelData, name?: string): PixelLayer {
    const layer = new PixelLayer(name ?? this.nextLayerName(), data ?? new PixelData(this.width, this.height));
    const at = this.indexOf(this.activeId);
    this.layers.splice(at < 0 ? this.layers.length : at + 1, 0, layer);
    this.activeId = layer.id;
    this.structureChanged();
    return layer;
  }

  duplicateLayer(id: string): PixelLayer | null {
    const src = this.layer(id);
    if (!src) return null;
    const copy = PixelLayer.fromRecord({ ...src.snapshot(), id: crypto.randomUUID(), data: src.data.clone(), mask: src.mask?.clone() ?? null });
    copy.name = this.uniqueName(`${src.name} copy`);
    this.layers.splice(this.indexOf(id) + 1, 0, copy);
    this.activeId = copy.id;
    this.structureChanged();
    return copy;
  }

  /** Never removes the last layer. */
  removeLayer(id: string): boolean {
    if (this.layers.length <= 1) return false;
    const at = this.indexOf(id);
    if (at < 0) return false;
    this.layers.splice(at, 1);
    if (this.activeId === id) this.activeId = this.layers[Math.max(0, at - 1)].id;
    this.structureChanged();
    return true;
  }

  /** dir +1 = up (towards the top of the stack). */
  moveLayer(id: string, dir: 1 | -1): boolean {
    const at = this.indexOf(id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= this.layers.length) return false;
    const [l] = this.layers.splice(at, 1);
    this.layers.splice(to, 0, l);
    this.structureChanged();
    return true;
  }

  /** Merges a layer into the one below it; the result is a plain Normal/100% layer with the lower layer's name. */
  mergeDown(id: string): boolean {
    const at = this.indexOf(id);
    if (at <= 0) return false;
    const lower = this.layers[at - 1];
    const upper = this.layers[at];
    const pair = [lower, upper].map((l) => {
      const c = PixelLayer.fromRecord(l.snapshot());
      c.visible = true;
      return c;
    });
    pair[0].blend = 'normal';
    pair[0].clip = false;
    const merged = new PixelLayer(lower.name, PixelData.fromPixels(this.width, this.height, flattenLayers(pair, this.width, this.height)));
    this.layers.splice(at - 1, 2, merged);
    this.activeId = merged.id;
    this.structureChanged();
    return true;
  }

  /** Collapses every visible layer into one; hidden layers are discarded (same as Photoshop's flatten). */
  flatten(): void {
    const merged = new PixelLayer('Layer 1', PixelData.fromPixels(this.width, this.height, flattenLayers(this.layers, this.width, this.height)));
    this.layers = [merged];
    this.activeId = merged.id;
    this.structureChanged();
  }

  /** Bakes a layer's mask into its alpha and drops the mask. */
  applyMask(id: string): boolean {
    const l = this.layer(id);
    if (!l?.mask) return false;
    const src = l.data.pixels;
    const m = l.mask.pixels;
    const out = new Uint32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const a = Math.round(((src[i] >>> 24) * (m[i] & 0xff)) / 255);
      out[i] = a === 0 ? 0 : ((a << 24) | (src[i] & 0xffffff)) >>> 0;
    }
    l.data = PixelData.fromPixels(this.width, this.height, out);
    l.mask = null;
    this.structureChanged();
    return true;
  }

  /** Deep copy (new layer ids, new buffers). */
  clone(): LayerStack {
    const layers = this.layers.map((l) =>
      PixelLayer.fromRecord({ ...l.snapshot(), id: crypto.randomUUID(), data: l.data.clone(), mask: l.mask?.clone() ?? null }),
    );
    const activeAt = this.indexOf(this.activeId);
    return new LayerStack(this.width, this.height, layers, layers[activeAt]?.id);
  }

  resize(w: number, h: number, anchor: 'topleft' | 'center'): LayerStack {
    const layers = this.layers.map((l) => {
      const c = PixelLayer.fromRecord({
        ...l.snapshot(),
        data: l.data.resize(w, h, anchor),
        mask: l.mask ? l.mask.resize(w, h, anchor, MASK_WHITE) : null,
      });
      return c;
    });
    return new LayerStack(w, h, layers, this.activeId);
  }

  toJSON(): PixelStackJson {
    return {
      layers: this.layers.map(
        (l): PixelStackLayerJson => ({
          id: l.id,
          name: l.name,
          visible: l.visible,
          opacity: l.opacity,
          blend: l.blend,
          ...(l.alphaLock ? { alphaLock: true } : {}),
          ...(l.clip ? { clip: true } : {}),
          data: l.data.toJSON(),
          ...(l.mask ? { mask: { ...l.mask.toJSON(), enabled: l.maskEnabled } } : {}),
        }),
      ),
      activeLayerId: this.activeId,
    };
  }

  /** Reads a v3 stack, or wraps a version ≤ 2 flat canvas as a single layer. */
  static fromJSON(json: PixelStackJson | PixelLayerJson, w: number, h: number): LayerStack {
    if (!('layers' in json)) return LayerStack.fromData(PixelData.fromJSON(json, w, h));
    const layers = json.layers.map((lj) => {
      const l = new PixelLayer(lj.name, PixelData.fromJSON(lj.data, w, h), lj.id);
      l.visible = lj.visible !== false;
      l.opacity = Number.isFinite(lj.opacity) ? Math.min(1, Math.max(0, lj.opacity)) : 1;
      l.blend = lj.blend in BLEND_INDEX ? lj.blend : 'normal';
      l.alphaLock = !!lj.alphaLock;
      l.clip = !!lj.clip;
      if (lj.mask) {
        l.mask = PixelData.fromJSON(lj.mask, w, h);
        l.maskEnabled = lj.mask.enabled !== false;
      }
      return l;
    });
    return new LayerStack(w, h, layers, json.activeLayerId);
  }
}

function union(a: PixelRect, b: PixelRect): PixelRect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
