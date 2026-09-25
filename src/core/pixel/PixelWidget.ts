import { PixelData } from './PixelData';
import { LayerStack } from './layers';
import { specFor, type ElementSpec } from './widgets';
import { clampContentMargins, clampPatch } from './ninepatch';
import { defaultNinePatch } from './types';
import type {
  ContentMargins,
  NinePatch,
  PixelElementJson,
  PixelWidgetJson,
  StateId,
  WidgetType,
} from './types';

/**
 * One part of a widget — a ProgressBar's fill, a slider's grabber, a
 * button's box. Its states share one canvas size and one nine-patch, the
 * same way Godot expects e.g. every Button stylebox to line up.
 */
export class PixelElement {
  readonly id: string;
  width: number;
  height: number;
  patch: NinePatch;
  contentMargins: ContentMargins;
  /** each state is a layer stack; `stack.composite()` is the image it shows / exports */
  states: Map<StateId, LayerStack>;

  constructor(opts: {
    id: string;
    width: number;
    height: number;
    patch?: NinePatch;
    contentMargins?: ContentMargins;
    states?: Map<StateId, LayerStack>;
  }) {
    this.id = opts.id;
    this.width = Math.max(1, Math.round(opts.width));
    this.height = Math.max(1, Math.round(opts.height));
    this.patch = clampPatch(opts.patch ?? defaultNinePatch(), this.width, this.height);
    this.contentMargins = clampContentMargins(opts.contentMargins);
    this.states = opts.states ?? new Map();
  }

  static fromSpec(spec: ElementSpec): PixelElement {
    const [w, h] = spec.defaultSize;
    const el = new PixelElement({ id: spec.id, width: w, height: h });
    el.ensureStates(spec);
    return el;
  }

  /** Adds a blank canvas for any spec state this element doesn't have yet, in spec order. */
  ensureStates(spec: ElementSpec): void {
    const ordered = new Map<StateId, LayerStack>();
    for (const s of spec.states) ordered.set(s.id, this.states.get(s.id) ?? new LayerStack(this.width, this.height));
    // keep anything the spec doesn't know (a newer file) rather than dropping pixels
    for (const [id, data] of this.states) if (!ordered.has(id)) ordered.set(id, data);
    this.states = ordered;
  }

  /**
   * Resizes every state's canvas (every layer and mask), clamping the nine-patch so it never
   * overlaps the new, possibly smaller, bounds. A structural change: callers
   * drop this element's undo history, since a PixelEdit's flat index only
   * means something for the width it was recorded against.
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

  /** The layer stack a state paints into, created on demand. */
  stateStack(id: StateId): LayerStack {
    let stack = this.states.get(id);
    if (!stack) {
      stack = new LayerStack(this.width, this.height);
      this.states.set(id, stack);
    }
    return stack;
  }

  isPainted(id: StateId): boolean {
    return this.states.get(id)?.isEmpty() === false;
  }

  toJSON(): PixelElementJson {
    const states: PixelElementJson['states'] = {};
    for (const [id, data] of this.states) states[id] = data.toJSON();
    return {
      width: this.width,
      height: this.height,
      patch: this.patch,
      contentMargins: this.contentMargins,
      states,
    };
  }

  static fromJSON(id: string, json: PixelElementJson): PixelElement {
    const el = new PixelElement({
      id,
      width: json.width,
      height: json.height,
      patch: json.patch,
      contentMargins: json.contentMargins,
    });
    for (const [sid, stack] of Object.entries(json.states ?? {})) {
      el.states.set(sid, LayerStack.fromJSON(stack, el.width, el.height));
    }
    return el;
  }
}

export class PixelWidget {
  id: string;
  name: string;
  type: WidgetType;
  /** in spec order */
  elements: Map<string, PixelElement>;

  constructor(opts: { id?: string; name: string; type: WidgetType; elements?: Map<string, PixelElement> }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.type = opts.type;
    this.elements = opts.elements ?? new Map();
  }

  static createNew(name: string, type: WidgetType): PixelWidget {
    const widget = new PixelWidget({ name, type });
    widget.ensureElements();
    return widget;
  }

  /** Fills in any element/state the spec defines but this widget lacks, and puts them in spec order. */
  ensureElements(): void {
    const ordered = new Map<string, PixelElement>();
    for (const es of specFor(this.type).elements) {
      const el = this.elements.get(es.id) ?? PixelElement.fromSpec(es);
      el.ensureStates(es);
      ordered.set(es.id, el);
    }
    for (const [id, el] of this.elements) if (!ordered.has(id)) ordered.set(id, el);
    this.elements = ordered;
  }

  element(id: string): PixelElement | null {
    return this.elements.get(id) ?? null;
  }

  /** First element in spec order — what a freshly selected widget opens on. */
  firstElementId(): string {
    return this.elements.keys().next().value ?? 'box';
  }

  /**
   * The canvas that actually shows for a state: the state itself if it has
   * pixels, else the first painted state along its spec `from` chain (hover
   * → normal). null when nothing on that chain is painted.
   */
  resolveState(elementId: string, stateId: StateId): { id: StateId; data: PixelData; stack: LayerStack } | null {
    const el = this.elements.get(elementId);
    if (!el) return null;
    const es = specFor(this.type).elements.find((e) => e.id === elementId);
    const seen = new Set<StateId>();
    let cur: StateId | undefined = stateId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const stack = el.states.get(cur);
      if (stack) {
        const data = stack.composite();
        if (data.bounds() !== null) return { id: cur, data, stack };
      }
      cur = es?.states.find((s) => s.id === cur)?.from;
    }
    return null;
  }

  toJSON(): PixelWidgetJson {
    const elements: Record<string, PixelElementJson> = {};
    for (const [id, el] of this.elements) elements[id] = el.toJSON();
    return { id: this.id, name: this.name, type: this.type, elements };
  }

  static fromJSON(json: PixelWidgetJson): PixelWidget {
    const widget = new PixelWidget({ id: json.id, name: json.name, type: json.type });
    if (json.elements) {
      for (const [id, ej] of Object.entries(json.elements)) widget.elements.set(id, PixelElement.fromJSON(id, ej));
    } else {
      migrateV1(widget, json);
    }
    widget.ensureElements();
    return widget;
  }
}

/**
 * Version-1 widgets were one canvas with a flat state list (+ loose icons).
 * The spec's `legacy` entry says which element that canvas becomes and which
 * states were misnamed back then (a Panel's 'normal' is Godot's 'panel', a
 * ProgressBar's 'normal' its 'background', a LineEdit has 'read_only', not
 * 'disabled'). Icons map onto the element of the same id.
 */
function migrateV1(widget: PixelWidget, json: PixelWidgetJson): void {
  const spec = specFor(widget.type);
  const target = spec.legacy?.element ?? spec.elements[0]?.id ?? 'box';
  const rename = spec.legacy?.rename ?? {};
  const w = json.width ?? 1;
  const h = json.height ?? 1;
  const el = new PixelElement({ id: target, width: w, height: h, patch: json.patch, contentMargins: json.contentMargins });
  for (const [sid, layer] of Object.entries(json.states ?? {})) {
    el.states.set(rename[sid] ?? sid, LayerStack.fromData(PixelData.fromJSON(layer, w, h)));
  }
  widget.elements.set(target, el);

  for (const [iconId, layer] of Object.entries(json.icons ?? {})) {
    const es = spec.elements.find((e) => e.id === iconId);
    const [iw, ih] = es?.defaultSize ?? [w, h];
    const iconEl = new PixelElement({ id: iconId, width: iw, height: ih });
    iconEl.states.set(es?.states[0]?.id ?? iconId, LayerStack.fromData(PixelData.fromJSON(layer, iw, ih)));
    widget.elements.set(iconId, iconEl);
  }
}
