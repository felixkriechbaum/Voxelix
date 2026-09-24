import { blitPixelData } from './blit';
import { paintNinePatch } from './NinePatchPainter';
import { minDrawSize, resolveContentMargins } from '@/core/pixel/ninepatch';
import { specFor, stateLabel } from '@/core/pixel/widgets';
import type { PixelData } from '@/core/pixel/PixelData';
import type { PixelElement, PixelWidget } from '@/core/pixel/PixelWidget';
import type { ContentMargins, StateId } from '@/core/pixel/types';

/**
 * Draws a whole widget the way its Godot control lays out its theme items —
 * a ProgressBar's fill stretched to the value, a slider's grabber centred on
 * it, a scrollbar's arrows either side of its track — so a margin mistake
 * shows here instead of in-engine. The layout rules are ports of the
 * controls' NOTIFICATION_DRAW code (Godot 4), simplified where they depend on
 * things the preview doesn't have (fonts, real item lists).
 */

export interface PreviewInput {
  hover: boolean;
  pressed: boolean;
  focused: boolean;
  disabled: boolean;
  /** toggle widgets */
  checked: boolean;
  /** CheckBox: draw the radio icons instead of the check icons */
  radio: boolean;
  /** range widgets, 0..1 */
  value: number;
  /** tabs / lists: which entry is selected */
  selected: number;
  /** pointer position in widget pixels, for per-part hover (scrollbar arrows, tabs, list rows) */
  pointer: { x: number; y: number } | null;
}

export interface PreviewText {
  text: string;
  size: number;
  color: string;
  showContent: boolean;
}

export interface PreviewResult {
  /** what the live box is showing, e.g. 'hover' or 'grabber highlight' */
  label: string;
  warnings: string[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CONTENT_OUTLINE = 'rgba(0, 190, 255, 0.9)';
const CONTENT_OUTLINE_OVERFLOW = 'rgba(255, 70, 70, 0.95)';
const PLACEHOLDER_STROKE = 'rgba(128, 128, 128, 0.7)';
/** Godot's default h_separation between a button's icon and its text */
const ICON_SEPARATION = 4;
/** OptionButton's default arrow_margin */
const ARROW_MARGIN = 4;
/** portion of a scrollbar the preview's grabber covers */
const SCROLL_PAGE = 0.3;

function textFont(sizePx: number): string {
  return `${sizePx}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Text width in widget pixels (unzoomed). */
export function measureText(text: string, size: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx || !text) return 0;
  measureCtx.font = textFont(size);
  return measureCtx.measureText(text).width;
}

function contains(r: Rect, p: { x: number; y: number } | null): boolean {
  return !!p && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

/** Offscreen canvases holding each PixelData's pixels, reblitted once per paint pass. */
class ImageCache {
  private canvases = new WeakMap<PixelData, { canvas: HTMLCanvasElement; pass: number }>();
  pass = 0;

  get(data: PixelData): HTMLCanvasElement {
    let entry = this.canvases.get(data);
    if (!entry) {
      entry = { canvas: document.createElement('canvas'), pass: -1 };
      this.canvases.set(data, entry);
    }
    if (entry.pass !== this.pass) {
      const c = entry.canvas;
      if (c.width !== data.width || c.height !== data.height) {
        c.width = data.width;
        c.height = data.height;
      }
      const ctx = c.getContext('2d');
      if (ctx) blitPixelData(ctx, data);
      entry.pass = this.pass;
    }
    return entry.canvas;
  }
}

const cache = new ImageCache();

/** Call once before a batch of paintWidgetPreview calls so edited pixels get reblitted. */
export function beginPreviewPass(): void {
  cache.pass++;
}

class Painter {
  readonly warnings: string[] = [];
  label = '';

  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly widget: PixelWidget,
    readonly zoom: number,
    readonly text: PreviewText,
  ) {}

  el(id: string): PixelElement | null {
    return this.widget.element(id);
  }

  /** The image a state actually shows (itself, or what it falls back to), or null. */
  image(elementId: string, stateId: StateId): PixelData | null {
    return this.widget.resolveState(elementId, stateId)?.data ?? null;
  }

  has(elementId: string, stateId: StateId): boolean {
    return this.image(elementId, stateId) !== null;
  }

  /** Godot's StyleBox content margins (-1 resolved to the texture margin). */
  margins(elementId: string): ContentMargins {
    const el = this.el(elementId);
    return el ? resolveContentMargins(el.patch, el.contentMargins) : { left: 0, top: 0, right: 0, bottom: 0 };
  }

  /** StyleBox::get_minimum_size — the content margins, which is all Godot counts for a StyleBoxTexture. */
  minSize(elementId: string): { w: number; h: number } {
    const m = this.margins(elementId);
    return { w: m.left + m.right, h: m.top + m.bottom };
  }

  iconSize(elementId: string, stateId: StateId): { w: number; h: number } {
    const img = this.image(elementId, stateId);
    return img ? { w: img.width, h: img.height } : { w: 0, h: 0 };
  }

  /** Nine-patched stylebox draw. Returns false if nothing is painted for it. */
  style(elementId: string, stateId: StateId, r: Rect): boolean {
    const el = this.el(elementId);
    const img = this.image(elementId, stateId);
    if (!el || !img || r.w <= 0 || r.h <= 0) return false;
    paintNinePatch(this.ctx, cache.get(img), { w: img.width, h: img.height }, el.patch, r, this.zoom);
    return true;
  }

  /** Texture drawn at its own size (Godot icons never stretch). */
  icon(elementId: string, stateId: StateId, x: number, y: number): boolean {
    const img = this.image(elementId, stateId);
    if (!img) return false;
    const z = this.zoom;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(cache.get(img), Math.round(x) * z, Math.round(y) * z, img.width * z, img.height * z);
    return true;
  }

  write(str: string, r: Rect, align: 'left' | 'center' | 'right' = 'center', valign: 'middle' | 'top' = 'middle') {
    if (!str) return;
    const ctx = this.ctx;
    const z = this.zoom;
    ctx.save();
    ctx.font = textFont(this.text.size * z);
    ctx.fillStyle = this.text.color;
    ctx.textAlign = align;
    ctx.textBaseline = valign;
    const x = align === 'left' ? r.x : align === 'right' ? r.x + r.w : r.x + r.w / 2;
    const y = valign === 'top' ? r.y : r.y + r.h / 2;
    ctx.fillText(str, x * z, y * z);
    ctx.restore();
  }

  outline(r: Rect, overflow: boolean) {
    if (!this.text.showContent || r.w <= 0 || r.h <= 0) return;
    const ctx = this.ctx;
    const z = this.zoom;
    ctx.save();
    ctx.strokeStyle = overflow ? CONTENT_OUTLINE_OVERFLOW : CONTENT_OUTLINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    // +0.5 puts the 1px line on pixel centres (crisp), inset so it sits inside the rect
    ctx.strokeRect(r.x * z + 0.5, r.y * z + 0.5, r.w * z - 1, r.h * z - 1);
    ctx.restore();
  }

  placeholder(r: Rect) {
    const ctx = this.ctx;
    const z = this.zoom;
    ctx.save();
    ctx.strokeStyle = PLACEHOLDER_STROKE;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(r.x * z + 0.5, r.y * z + 0.5, r.w * z - 1, r.h * z - 1);
    ctx.restore();
  }

  /** content rect of a stylebox drawn into `r` */
  content(elementId: string, r: Rect): Rect {
    const m = this.margins(elementId);
    return { x: r.x + m.left, y: r.y + m.top, w: r.w - m.left - m.right, h: r.h - m.top - m.bottom };
  }

  warnPatch(elementId: string, r: Rect) {
    const el = this.el(elementId);
    if (!el) return;
    const min = minDrawSize(el.patch);
    if (r.w < min.w || r.h < min.h) this.warnings.push('Smaller than the patch borders — Godot scales the whole patch down');
  }

  /** Does the sample text fit the content rect? Warns with the size Godot would grow to. */
  checkText(elementId: string, r: Rect, extraW = 0): boolean {
    const t = this.text.text;
    if (!t) return false;
    const m = this.margins(elementId);
    const needW = Math.ceil(measureText(t, this.text.size)) + m.left + m.right + extraW;
    const needH = this.text.size + m.top + m.bottom;
    if (r.w < needW || r.h < needH) {
      this.warnings.push(`Text needs ${needW}×${needH} — Godot grows the control's minimum size to fit`);
      return true;
    }
    return false;
  }
}

/** Button-family base state, same priority Godot's BaseButton resolves them in. */
function buttonState(p: Painter, element: string, input: PreviewInput, toggled = false): StateId {
  if (input.disabled) return 'disabled';
  if (input.pressed || toggled) {
    if (toggled && input.hover && !input.pressed && p.has(element, 'hover_pressed')) return 'hover_pressed';
    return 'pressed';
  }
  if (input.hover) return 'hover';
  return 'normal';
}

function paintButton(p: Painter, box: Rect, input: PreviewInput) {
  const state = buttonState(p, 'box', input);
  p.label = state;
  p.warnPatch('box', box);
  if (!p.style('box', state, box)) p.placeholder(box);
  if (input.focused && !input.disabled && p.style('box', 'focus', box)) p.label += ' + focus';

  let content = p.content('box', box);
  const isOption = p.widget.type === 'optionbutton';
  let arrowW = 0;
  if (isOption) {
    const a = p.iconSize('arrow', 'arrow');
    if (a.w) {
      arrowW = a.w + ARROW_MARGIN;
      p.icon('arrow', 'arrow', box.w - a.w - ARROW_MARGIN, Math.floor((box.h - a.h) / 2));
      content = { ...content, w: content.w - arrowW };
    }
  }
  const overflow = p.checkText('box', box, arrowW);
  p.write(p.text.text, content, isOption ? 'left' : 'center');
  p.outline(content, overflow);
}

function paintToggle(p: Painter, box: Rect, input: PreviewInput) {
  const isSwitch = p.widget.type === 'checkbutton';
  const bgState = buttonState(p, 'box', input, input.checked);
  p.style('box', bgState, box);
  if (input.focused && !input.disabled) p.style('box', 'focus', box);

  const iconEl = isSwitch ? 'switch' : input.radio ? 'radio' : 'check';
  const prefix = !isSwitch && input.radio ? 'radio_' : '';
  const iconState = `${prefix}${input.checked ? 'checked' : 'unchecked'}${input.disabled ? '_disabled' : ''}`;
  p.label = stateLabel(iconState);

  const m = p.margins('box');
  const size = p.iconSize(iconEl, iconState);
  const iy = Math.floor((box.h - size.h) / 2);
  const content = p.content('box', box);
  if (size.w) {
    if (isSwitch) {
      p.icon(iconEl, iconState, box.w - size.w - m.right, iy);
      p.write(p.text.text, { ...content, w: content.w - size.w - ICON_SEPARATION }, 'left');
    } else {
      p.icon(iconEl, iconState, m.left, iy);
      const tx = m.left + size.w + ICON_SEPARATION;
      p.write(p.text.text, { x: tx, y: content.y, w: content.w - size.w - ICON_SEPARATION, h: content.h }, 'left');
    }
  } else {
    p.placeholder({ x: isSwitch ? box.w - 12 - m.right : m.left, y: Math.floor((box.h - 12) / 2), w: 12, h: 12 });
    p.write(p.text.text, { ...content, x: content.x + (isSwitch ? 0 : 12 + ICON_SEPARATION) }, 'left');
  }
  const overflow = p.checkText('box', box, (size.w || 12) + ICON_SEPARATION);
  p.outline(content, overflow);
}

function paintField(p: Painter, box: Rect, input: PreviewInput) {
  const element = specFor(p.widget.type).elements[0].id;
  const multiline = p.widget.type === 'textedit' || p.widget.type === 'richtextlabel';
  const state = input.disabled && p.el(element)?.states.has('read_only') ? 'read_only' : 'normal';
  p.label = stateLabel(state);
  p.warnPatch(element, box);
  if (!p.style(element, state, box)) p.placeholder(box);
  if (input.focused && !input.disabled && p.style(element, 'focus', box)) p.label += ' + focus';

  let content = p.content(element, box);
  if (p.widget.type === 'lineedit') {
    const c = p.iconSize('clear', 'clear');
    if (c.w) {
      const m = p.margins(element);
      p.icon('clear', 'clear', box.w - m.right - c.w, Math.floor((box.h - c.h) / 2));
      content = { ...content, w: content.w - c.w };
    }
  }
  const overflow = !multiline && p.checkText(element, box);
  p.write(p.text.text, content, 'left', multiline ? 'top' : 'middle');
  p.outline(content, overflow);
}

function paintSpinBox(p: Painter, box: Rect) {
  p.label = 'updown';
  p.placeholder(box);
  const s = p.iconSize('updown', 'updown');
  if (s.w) p.icon('updown', 'updown', box.w - s.w, Math.floor((box.h - s.h) / 2));
  p.write('42', { x: 3, y: 0, w: box.w - s.w - 3, h: box.h }, 'left');
}

function paintPanel(p: Painter, box: Rect) {
  p.label = 'panel';
  p.warnPatch('panel', box);
  if (!p.style('panel', 'panel', box)) p.placeholder(box);
  const content = p.content('panel', box);
  p.write(p.text.text, content, 'left', p.widget.type === 'tooltip' ? 'middle' : 'top');
  p.outline(content, false);
}

function paintProgress(p: Painter, box: Rect, input: PreviewInput) {
  p.label = `${Math.round(input.value * 100)}%`;
  p.warnPatch('background', box);
  if (!p.style('background', 'background', box)) p.placeholder(box);
  // ProgressBar::_notification: the fill never shrinks below its own minimum
  // width and isn't drawn at all until the value covers at least one pixel past it
  const mp = p.minSize('fill').w;
  const px = Math.round(input.value * (box.w - mp));
  if (px > 0) p.style('fill', 'fill', { x: 0, y: 0, w: px + mp, h: box.h });
  p.write(p.label, box, 'center');
}

function paintTextureProgress(p: Painter, box: Rect, input: PreviewInput) {
  p.label = `${Math.round(input.value * 100)}% (nine_patch_stretch)`;
  if (!p.style('under', 'under', box)) p.placeholder(box);
  const fillW = Math.round(input.value * box.w);
  if (fillW > 0) {
    const ctx = p.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, fillW * p.zoom, box.h * p.zoom);
    ctx.clip();
    p.style('progress', 'progress', box);
    ctx.restore();
  }
  p.style('over', 'over', box);
}

function grabberState(input: PreviewInput): StateId {
  if (input.disabled) return 'grabber_disabled';
  return input.hover || input.focused || input.pressed ? 'grabber_highlight' : 'grabber';
}

/** Where along the track a pointer puts the value — shared by the preview's drag handling. */
export function sliderValueAt(widget: PixelWidget, box: { w: number; h: number }, pointer: { x: number; y: number }): number {
  const img = widget.resolveState('grabber', 'grabber')?.data;
  const vertical = widget.type === 'vslider';
  const gw = img?.width ?? 0;
  const gh = img?.height ?? 0;
  if (vertical) {
    const area = box.h - gh;
    return area > 0 ? clamp01((box.h - pointer.y - gh / 2) / area) : 0;
  }
  const area = box.w - gw;
  return area > 0 ? clamp01((pointer.x - gw / 2) / area) : 0;
}

function paintSlider(p: Painter, box: Rect, input: PreviewInput, vertical: boolean) {
  const gState = grabberState(input);
  const highlighted = !input.disabled && (input.hover || input.focused || input.pressed);
  const areaState = highlighted ? 'grabber_area_highlight' : 'grabber_area';
  p.label = stateLabel(gState);
  const g = p.iconSize('grabber', gState);
  const ratio = clamp01(input.value);
  const min = p.minSize('slider');

  if (!vertical) {
    // HSlider draws the track exactly as tall as the stylebox's minimum
    // height — i.e. its top+bottom content margins, NOT the texture height
    const th = min.h;
    const ty = Math.floor((box.h - th) / 2);
    const area = box.w - g.w;
    if (th === 0 && p.has('slider', 'slider')) p.warnings.push('Track is 0px thick in Godot — give it top/bottom content (or nine-patch) margins');
    p.style('slider', 'slider', { x: 0, y: ty, w: box.w, h: th });
    p.style('grabber_area', areaState, { x: 0, y: ty, w: Math.round(area * ratio + g.w / 2), h: th });
    if (!p.icon('grabber', gState, ratio * area, Math.floor(box.h / 2 - g.h / 2))) {
      p.placeholder({ x: Math.round(ratio * (box.w - 6)), y: Math.floor(box.h / 2 - 5), w: 6, h: 10 });
    }
  } else {
    const tw = min.w;
    const tx = Math.floor((box.w - tw) / 2);
    const area = box.h - g.h;
    if (tw === 0 && p.has('slider', 'slider')) p.warnings.push('Track is 0px thick in Godot — give it left/right content (or nine-patch) margins');
    p.style('slider', 'slider', { x: tx, y: 0, w: tw, h: box.h });
    const filled = Math.round(area * ratio + g.h / 2);
    p.style('grabber_area', areaState, { x: tx, y: box.h - filled, w: tw, h: filled });
    if (!p.icon('grabber', gState, Math.floor(box.w / 2 - g.w / 2), box.h - ratio * area - g.h)) {
      p.placeholder({ x: Math.floor(box.w / 2 - 5), y: Math.round(box.h - 6 - ratio * (box.h - 6)), w: 10, h: 6 });
    }
  }
}

interface ScrollGeometry {
  decr: Rect;
  incr: Rect;
  track: Rect;
  grabber: Rect;
  /** grabber travel, in px */
  travel: number;
  /** track start + bg margin, where the grabber's travel begins */
  start: number;
}

function scrollGeometry(widget: PixelWidget, box: Rect, value: number): ScrollGeometry {
  const vertical = widget.type === 'vscrollbar';
  const size = (el: string, st: StateId) => {
    const img = widget.resolveState(el, st)?.data;
    return img ? { w: img.width, h: img.height } : { w: 0, h: 0 };
  };
  const d = size('decrement', 'decrement');
  const i = size('increment', 'increment');
  const trackEl = widget.element('scroll');
  const m = trackEl ? resolveContentMargins(trackEl.patch, trackEl.contentMargins) : { left: 0, top: 0, right: 0, bottom: 0 };
  const grabEl = widget.element('grabber');
  const gm = grabEl ? resolveContentMargins(grabEl.patch, grabEl.contentMargins) : { left: 0, top: 0, right: 0, bottom: 0 };
  if (!vertical) {
    const areaW = box.w - d.w - i.w;
    const inner = areaW - m.left - m.right;
    const gsize = Math.max(Math.round(inner * SCROLL_PAGE), gm.left + gm.right);
    const travel = Math.max(0, inner - gsize);
    const start = d.w + m.left;
    return {
      decr: { x: 0, y: 0, w: d.w, h: d.h },
      incr: { x: d.w + areaW, y: 0, w: i.w, h: i.h },
      track: { x: d.w, y: 0, w: areaW, h: box.h },
      grabber: { x: start + Math.round(clamp01(value) * travel), y: 0, w: gsize, h: box.h },
      travel,
      start,
    };
  }
  const areaH = box.h - d.h - i.h;
  const inner = areaH - m.top - m.bottom;
  const gsize = Math.max(Math.round(inner * SCROLL_PAGE), gm.top + gm.bottom);
  const travel = Math.max(0, inner - gsize);
  const start = d.h + m.top;
  return {
    decr: { x: 0, y: 0, w: d.w, h: d.h },
    incr: { x: 0, y: d.h + areaH, w: i.w, h: i.h },
    track: { x: 0, y: d.h, w: box.w, h: areaH },
    grabber: { x: 0, y: start + Math.round(clamp01(value) * travel), w: box.w, h: gsize },
    travel,
    start,
  };
}

/** Value a pointer drags a scrollbar grabber to (grabber centred on the pointer). */
export function scrollValueAt(widget: PixelWidget, box: { w: number; h: number }, pointer: { x: number; y: number }): number {
  const g = scrollGeometry(widget, { x: 0, y: 0, ...box }, 0);
  if (g.travel <= 0) return 0;
  const pos = widget.type === 'vscrollbar' ? pointer.y - g.grabber.h / 2 : pointer.x - g.grabber.w / 2;
  return clamp01((pos - g.start) / g.travel);
}

function paintScroll(p: Painter, box: Rect, input: PreviewInput) {
  const g = scrollGeometry(p.widget, box, input.value);
  const part = (r: Rect, id: 'decrement' | 'increment'): StateId => {
    if (!contains(r, input.pointer)) return id;
    return input.pressed ? `${id}_pressed` : `${id}_highlight`;
  };
  const dState = part(g.decr, 'decrement');
  const iState = part(g.incr, 'increment');
  const overGrabber = contains(g.grabber, input.pointer);
  const gState = overGrabber ? (input.pressed ? 'grabber_pressed' : 'grabber_highlight') : 'grabber';

  p.icon('decrement', dState, g.decr.x, g.decr.y);
  if (!p.style('scroll', input.focused ? 'scroll_focus' : 'scroll', g.track)) p.placeholder(g.track);
  p.icon('increment', iState, g.incr.x, g.incr.y);
  if (!p.style('grabber', gState, g.grabber)) p.placeholder(g.grabber);

  const shown = [dState, iState].find((s) => s.includes('_')) ?? (overGrabber ? gState : input.focused ? 'scroll_focus' : 'scroll');
  p.label = stateLabel(shown);
}

const TAB_NAMES = ['Tab 1', 'Tab 2', 'Tab 3'];

/** Tab rects along the top of the box, TabBar-style: each as wide as its text plus content margins. */
export function tabRects(widget: PixelWidget, textSize: number, names = TAB_NAMES): Rect[] {
  const el = widget.element('tab');
  const m = el ? resolveContentMargins(el.patch, el.contentMargins) : { left: 2, top: 2, right: 2, bottom: 2 };
  const h = textSize + m.top + m.bottom;
  let x = 0;
  return names.map((n) => {
    const w = Math.ceil(measureText(n, textSize)) + m.left + m.right;
    const r = { x, y: 0, w, h };
    x += w;
    return r;
  });
}

function paintTabs(p: Painter, box: Rect, input: PreviewInput) {
  const names = [p.text.text || TAB_NAMES[0], TAB_NAMES[1], TAB_NAMES[2]];
  const tabs = tabRects(p.widget, p.text.size, names);
  const th = tabs[0]?.h ?? 0;
  const isContainer = p.widget.type === 'tabcontainer';
  const selected = Math.min(Math.max(0, input.selected), tabs.length - 1);

  if (isContainer) {
    p.style('tabbar_background', 'tabbar_background', { x: 0, y: 0, w: box.w, h: th });
    const panel = { x: 0, y: th, w: box.w, h: box.h - th };
    if (!p.style('panel', 'panel', panel)) p.placeholder(panel);
    const content = p.content('panel', panel);
    p.outline(content, false);
  }
  const stateOf = (i: number): StateId => {
    if (i === selected) return 'tab_selected';
    if (input.disabled && i === tabs.length - 1) return 'tab_disabled';
    if (contains(tabs[i], input.pointer)) return 'tab_hovered';
    return 'tab_unselected';
  };
  // selected tab last, so its art can overlap its neighbours like Godot draws it
  const order = tabs.map((_, i) => i).filter((i) => i !== selected);
  order.push(selected);
  for (const i of order) {
    const r = tabs[i];
    const st = stateOf(i);
    if (!p.style('tab', st, r)) p.placeholder(r);
    if (i === selected && input.focused) p.style('tab', 'tab_focus', r);
    p.write(names[i], p.content('tab', r), 'center');
  }
  if (tabs.length && tabs[tabs.length - 1].x + tabs[tabs.length - 1].w > box.w) {
    p.warnings.push('Tabs are wider than the box — Godot would show scroll arrows');
  }
  const hovered = tabs.findIndex((r, i) => i !== selected && contains(r, input.pointer));
  p.label = stateLabel(hovered >= 0 ? stateOf(hovered) : 'tab_selected');
}

interface ListRow {
  text: string;
  separator?: boolean;
  check?: 'check' | 'radio';
  checked?: boolean;
  submenu?: boolean;
  arrow?: 'open' | 'collapsed';
  indent?: number;
}

function listRows(type: string, sample: string): ListRow[] {
  if (type === 'popupmenu') {
    return [
      { text: sample || 'Item' },
      { text: 'Checked', check: 'check', checked: true },
      { text: '', separator: true },
      { text: 'Option', check: 'radio', checked: true },
      { text: 'Submenu', submenu: true },
    ];
  }
  if (type === 'tree') {
    return [
      { text: sample || 'Root', arrow: 'open' },
      { text: 'Child', indent: 1, check: 'check', checked: true },
      { text: 'Folder', indent: 1, arrow: 'collapsed' },
    ];
  }
  return [{ text: sample || 'Item 1' }, { text: 'Item 2' }, { text: 'Item 3' }];
}

/** Row rects inside a list's panel — shared with the pointer handling so clicks select the row under them. */
export function listRowRects(widget: PixelWidget, box: { w: number; h: number }, textSize: number, sample: string): Rect[] {
  const panel = widget.element('panel');
  const m = panel ? resolveContentMargins(panel.patch, panel.contentMargins) : { left: 0, top: 0, right: 0, bottom: 0 };
  const rows = listRows(widget.type, sample);
  const sep = widget.element('separator');
  const sepH = sep ? resolveContentMargins(sep.patch, sep.contentMargins) : null;
  const rowH = textSize + 4;
  let y = m.top;
  return rows.map((row) => {
    const h = row.separator ? Math.max(4, (sepH?.top ?? 0) + (sepH?.bottom ?? 0)) : rowH;
    const r = { x: m.left, y, w: box.w - m.left - m.right, h };
    y += h;
    return r;
  });
}

function paintList(p: Painter, box: Rect, input: PreviewInput) {
  const type = p.widget.type;
  p.warnPatch('panel', box);
  if (!p.style('panel', 'panel', box)) p.placeholder(box);
  if (input.focused && type !== 'popupmenu') p.style('panel', 'focus', box);

  const rows = listRows(type, p.text.text);
  const rects = listRowRects(p.widget, box, p.text.size, p.text.text);
  const selected = type === 'popupmenu' ? -1 : Math.min(Math.max(0, input.selected), rows.length - 1);
  let label = type === 'popupmenu' ? 'panel' : input.focused ? 'selected_focus' : 'selected';

  rows.forEach((row, i) => {
    const r = rects[i];
    if (row.separator) {
      const sh = p.minSize('separator').h;
      if (!p.style('separator', 'separator', { x: r.x, y: r.y + Math.floor((r.h - sh) / 2), w: r.w, h: sh }) && sh === 0) {
        p.warnings.push('Separator is 0px thick in Godot — give it top/bottom content margins');
      }
      return;
    }
    const hovered = contains(r, input.pointer);
    if (type === 'popupmenu') {
      if (hovered) {
        p.style('hover', 'hover', r);
        label = 'hover';
      }
    } else if (i === selected) {
      p.style('item', input.focused ? 'selected_focus' : 'selected', r);
      if (type === 'tree') p.style('item', input.focused ? 'cursor' : 'cursor_unfocused', r);
    } else if (hovered && type === 'itemlist') {
      p.style('item', 'hovered', r);
      label = 'hovered';
    }

    let x = r.x + 2 + (row.indent ?? 0) * 8;
    const iconAt = (el: string, st: StateId) => {
      const s = p.iconSize(el, st);
      if (s.w && p.icon(el, st, x, r.y + Math.floor((r.h - s.h) / 2))) x += s.w + 2;
    };
    if (row.arrow) iconAt('arrow', row.arrow === 'open' ? 'arrow' : 'arrow_collapsed');
    if (row.check === 'check') iconAt('check', row.checked ? 'checked' : 'unchecked');
    if (row.check === 'radio') iconAt('radio', row.checked ? 'radio_checked' : 'radio_unchecked');
    p.write(row.text, { x, y: r.y, w: r.w - (x - r.x), h: r.h }, 'left');
    if (row.submenu) {
      const s = p.iconSize('submenu', 'submenu');
      if (s.w) p.icon('submenu', 'submenu', r.x + r.w - s.w - 2, r.y + Math.floor((r.h - s.h) / 2));
    }
  });
  const last = rects[rects.length - 1];
  if (last && last.y + last.h > box.h) p.warnings.push('Rows overflow the box — make it taller to see them all');
  p.label = stateLabel(label);
}

function closeRect(p: Painter, box: Rect): Rect {
  const s = p.iconSize('close', 'close');
  const m = p.margins('border');
  const y = Math.max(0, Math.floor((m.top - s.h) / 2));
  return { x: box.w - s.w - Math.max(2, y), y, w: s.w, h: s.h };
}

function paintWindow(p: Painter, box: Rect, input: PreviewInput) {
  const state = input.disabled ? 'embedded_unfocused_border' : 'embedded_border';
  p.label = stateLabel(state);
  p.warnPatch('border', box);
  if (!p.style('border', state, box)) p.placeholder(box);
  const c = closeRect(p, box);
  const closeState = contains(c, input.pointer) && input.pressed ? 'close_pressed' : 'close';
  if (c.w) p.icon('close', closeState, c.x, c.y);
  const m = p.margins('border');
  p.write(p.text.text, { x: 3, y: 0, w: box.w - 6 - c.w, h: Math.max(m.top, p.text.size + 2) }, 'left');
  p.outline(p.content('border', box), false);
}

function paintSeparator(p: Painter, box: Rect, vertical: boolean) {
  p.label = 'separator';
  const min = p.minSize('separator');
  const thick = vertical ? min.w : min.h;
  if (thick === 0 && p.has('separator', 'separator')) {
    p.warnings.push(`Line is 0px thick in Godot — give it ${vertical ? 'left/right' : 'top/bottom'} content margins`);
  }
  const r = vertical
    ? { x: Math.floor((box.w - thick) / 2), y: 0, w: thick, h: box.h }
    : { x: 0, y: Math.floor((box.h - thick) / 2), w: box.w, h: thick };
  if (!p.style('separator', 'separator', r)) p.placeholder(box);
}

function paintImage(p: Painter, box: Rect) {
  p.label = 'image';
  const id = specFor(p.widget.type).elements[0].id;
  const st = p.el(id)?.states.keys().next().value ?? 'normal';
  p.warnPatch(id, box);
  if (!p.style(id, st, box)) p.placeholder(box);
}

/** Which extra, non-interactive copy the preview shows next to the live one ('disabled', 'read only', …), if any. */
export function disabledSlotLabel(widget: PixelWidget): string | null {
  switch (specFor(widget.type).preview) {
    case 'button':
      return widget.element('box')?.states.has('disabled') ? 'disabled' : null;
    case 'toggle':
    case 'hslider':
    case 'vslider':
    case 'tabs':
      return 'disabled';
    case 'field':
      return widget.element(specFor(widget.type).elements[0].id)?.states.has('read_only') ? 'read only' : null;
    case 'window':
      return 'unfocused';
    default:
      return null;
  }
}

/**
 * Paints `widget` into `ctx`, sized `box` widget pixels at `zoom`. The
 * canvas must already be box.w*zoom × box.h*zoom and cleared.
 */
export function paintWidgetPreview(
  ctx: CanvasRenderingContext2D,
  widget: PixelWidget,
  size: { w: number; h: number },
  zoom: number,
  input: PreviewInput,
  text: PreviewText,
): PreviewResult {
  const p = new Painter(ctx, widget, zoom, text);
  const box: Rect = { x: 0, y: 0, w: size.w, h: size.h };
  ctx.imageSmoothingEnabled = false;
  switch (specFor(widget.type).preview) {
    case 'button':
      paintButton(p, box, input);
      break;
    case 'toggle':
      paintToggle(p, box, input);
      break;
    case 'field':
      paintField(p, box, input);
      break;
    case 'spinbox':
      paintSpinBox(p, box);
      break;
    case 'panel':
      paintPanel(p, box);
      break;
    case 'progress':
      paintProgress(p, box, input);
      break;
    case 'textureprogress':
      paintTextureProgress(p, box, input);
      break;
    case 'hslider':
      paintSlider(p, box, input, false);
      break;
    case 'vslider':
      paintSlider(p, box, input, true);
      break;
    case 'hscroll':
    case 'vscroll':
      paintScroll(p, box, input);
      break;
    case 'tabs':
      paintTabs(p, box, input);
      break;
    case 'list':
      paintList(p, box, input);
      break;
    case 'window':
      paintWindow(p, box, input);
      break;
    case 'hseparator':
      paintSeparator(p, box, false);
      break;
    case 'vseparator':
      paintSeparator(p, box, true);
      break;
    case 'image':
      paintImage(p, box);
      break;
  }
  return { label: p.label, warnings: p.warnings };
}
