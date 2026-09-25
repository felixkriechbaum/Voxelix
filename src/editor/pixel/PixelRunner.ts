import { PixelData } from '@/core/pixel/PixelData';
import { EditRecorder, PixelHistory, type HistoryEntry } from '@/core/pixel/PixelHistory';
import { LayerStack, MASK_BLACK, MASK_WHITE, maskValue, type PixelLayer, type StackSnapshot } from '@/core/pixel/layers';
import { PixelSelection } from '@/core/pixel/selection';
import { transformPixels, type PixelTransform } from '@/core/pixel/ops/transform';
import { adjustPixels, type Adjustment } from '@/core/pixel/ops/adjust';
import { gradientColor, gradientT } from '@/core/pixel/ops/gradient';
import { createPixelTool } from '@/tools/pixel/tools';
import type { PixelRenderer } from '@/pixel/PixelRenderer';
import type { PixelTool, PixelToolContext, PixelToolId, PixelPointer, ToolOverlay } from '@/tools/pixel/types';
import { MAX_CORNER_RADIUS, type BlendMode, type StateId } from '@/core/pixel/types';
import type { PixelStore } from '@/stores/pixel';

/** Layer properties editable from the layers panel. */
export interface LayerProps {
  name?: string;
  visible?: boolean;
  opacity?: number;
  blend?: BlendMode;
  alphaLock?: boolean;
  clip?: boolean;
  maskEnabled?: boolean;
}

/** An RGBA image decoded from a file / the system clipboard. */
export interface ImportedImage {
  width: number;
  height: number;
  pixels: Uint32Array;
}

/** Gray mask value a colour paints into a layer mask: luminance scaled by alpha (so the eraser — transparent — hides). */
function maskFromColor(rgba: number): number {
  const a = (rgba >>> 24) / 255;
  const luma = 0.299 * (rgba & 0xff) + 0.587 * ((rgba >>> 8) & 0xff) + 0.114 * ((rgba >>> 16) & 0xff);
  return maskValue(luma * a);
}

/**
 * Bridges pointer input + the active PixelTool + undo history + the renderer
 * for one state image (a layer stack). Tools paint into `data` — the active
 * layer's pixels, or its mask while the store's `editMask` is on — and every
 * write is clipped to the selection.
 */
export class PixelRunner implements PixelToolContext {
  private tool: PixelTool;
  private rec = new EditRecorder();
  private batchLabel = '';
  private batchSelection: PixelSelection | null = null;
  /** keyed by `${widgetId}:${elementId}:${stateId}` — every state image has its own undo stack */
  private histories = new Map<string, PixelHistory>();
  private stack: LayerStack | null = null;
  private cursor: { x: number; y: number } | null = null;
  private sel: PixelSelection | null = null;
  private overlayState: ToolOverlay | null = null;
  /** layer-property edit in progress (an opacity slider drag) — one undo step once it's committed */
  private pendingProps: { stack: LayerStack; before: StackSnapshot } | null = null;
  /** live preview of an adjustment dialog: the buffer's pixels before it opened */
  private preview: { target: PixelData; original: Uint32Array } | null = null;
  private moveState: { snapshot: Uint32Array; sel: PixelSelection | null; box: { x: number; y: number; w: number; h: number } } | null = null;
  /**
   * In-memory only, lives for the session (this PixelRunner is created once
   * and persists across widget/state switches) — so copying from one state
   * and pasting into another (or a different widget) works. `mask` marks
   * which of the box's pixels were selected.
   */
  private clipboard: { x: number; y: number; w: number; h: number; pixels: Uint32Array; mask: Uint8Array } | null = null;
  /** when the in-app clipboard was last filled (performance.now()) — decides it vs. an image on the system clipboard */
  clipboardAt = -Infinity;

  constructor(
    private renderer: PixelRenderer,
    private store: PixelStore,
  ) {
    this.tool = createPixelTool(store.toolId);
    this.syncActive();
  }

  setTool(id: PixelToolId): void {
    this.tool.clearPreview(this);
    this.tool = createPixelTool(id);
  }

  /**
   * Recompute the active stack. Call on widget/state switch or resize (undo/
   * redo don't need this — they act on the already-active stack in place).
   *
   * Also drops the selection: it's coordinates on one specific canvas, and
   * carrying it over to a different widget/state — or the same one after a
   * resize moved everything around — would leave it pointing at a stale,
   * possibly out-of-bounds region. The clipboard is untouched, so copy-on-one-
   * state-paste-on-another still works.
   */
  syncActive(): void {
    this.endPreview(false);
    const element = this.store.activeElement();
    this.setSelection(null);
    this.stack = element ? element.stateStack(this.store.activeStateId) : null;
    this.syncMaskMode();
    this.store.bumpLayers();
  }

  /** Mask editing / viewing only makes sense while the active layer has a mask. */
  private syncMaskMode(): void {
    const hasMask = !!this.stack?.active.mask;
    if (!hasMask) {
      if (this.store.editMask) this.store.editMask = false;
      if (this.store.viewMask) this.store.viewMask = false;
    }
  }

  /** The image the canvas should show: the merged layers, or the active mask in mask view. */
  displaySource(): PixelData | null {
    const stack = this.stack;
    if (!stack) return null;
    if (this.store.viewMask && stack.active.mask) return stack.active.mask;
    return stack.composite();
  }

  get activeStack(): LayerStack | null {
    return this.stack;
  }

  get editingMask(): boolean {
    return this.store.editMask && !!this.stack?.active.mask;
  }

  // ---- PixelToolContext -------------------------------------------------
  get data(): PixelData {
    const stack = this.stack;
    if (!stack) throw new Error('no active widget');
    const layer = stack.active;
    return this.store.editMask && layer.mask ? layer.mask : layer.data;
  }
  get composite(): PixelData {
    if (!this.stack) throw new Error('no active widget');
    return this.editingMask ? this.data : this.stack.composite();
  }
  get primary(): number {
    return this.store.primaryColor;
  }
  get secondary(): number {
    return this.store.secondaryColor;
  }
  get brushSize(): number {
    return Math.max(1, Math.round(this.store.brushSize));
  }
  get brushShape() {
    return this.store.brushShape;
  }
  get cornerRadius(): number {
    return Math.max(0, Math.min(MAX_CORNER_RADIUS, Math.round(this.store.cornerRadius) || 0));
  }
  get contiguous(): boolean {
    return this.store.contiguous;
  }
  get tolerance(): number {
    return Math.max(0, Math.min(255, Math.round(this.store.tolerance)));
  }
  get gradientKind() {
    return this.store.gradientKind;
  }
  get gradientStyle() {
    return this.store.gradientStyle;
  }
  get selection(): PixelSelection | null {
    return this.sel;
  }
  get overlay(): ToolOverlay | null {
    return this.overlayState;
  }

  cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    return this.renderer.toCell(clientX, clientY);
  }

  pointAt(clientX: number, clientY: number): { x: number; y: number } {
    return this.renderer.toPoint(clientX, clientY);
  }

  begin(label: string): void {
    if (!this.stack) return;
    this.rec.begin(this.data);
    this.batchLabel = label;
    this.batchSelection = this.sel;
  }

  write(x: number, y: number, rgba: number): void {
    const data = this.rec.active;
    if (!data || !this.stack) return;
    const i = data.index(x, y);
    if (i < 0) return;
    if (this.sel && !this.sel.mask[i]) return;
    const prev = data.pixels[i];
    let next = rgba >>> 0;
    if (data !== this.stack.active.data) {
      next = maskFromColor(next);
    } else if (this.stack.active.alphaLock) {
      const pa = prev >>> 24;
      if (pa === 0 || next >>> 24 === 0) return;
      next = ((pa << 24) | (next & 0xffffff)) >>> 0;
    }
    if (prev === next) return;
    this.rec.record(i, prev);
    data.setRaw(i, next);
  }

  commit(): void {
    const res = this.rec.finish();
    if (!res) return;
    const selChanged = this.sel !== this.batchSelection;
    if (res.idx.length > 0 || selChanged) {
      this.currentHistory().push({
        kind: 'pixels',
        label: this.batchLabel,
        ...res,
        ...(selChanged ? { selection: { before: this.batchSelection, after: this.sel } } : {}),
      });
      this.store.bumpEdit();
    }
  }

  cancel(): void {
    this.rec.revert();
    this.rec.finish();
    if (this.sel !== this.batchSelection) this.setSelection(this.batchSelection);
  }

  setSelection(sel: PixelSelection | null): void {
    this.sel = sel && !sel.isEmpty() ? sel : null;
    this.store.bumpSelection();
  }

  pickColor(rgba: number, slot: 'primary' | 'secondary'): void {
    if (slot === 'primary') this.store.setPrimary(rgba);
    else this.store.setSecondary(rgba);
  }

  setCursor(cell: { x: number; y: number } | null): void {
    this.cursor = cell;
  }

  getCursor(): { x: number; y: number } | null {
    return this.cursor;
  }

  setOverlay(o: ToolOverlay | null): void {
    this.overlayState = o ? { points: o.points.slice(), closed: o.closed } : null;
  }

  /** Small PNG data URL of the canvas being edited, for autosave thumbnails. */
  captureThumbnail(): string {
    return this.renderer.captureThumbnail(this.stack?.composite() ?? null);
  }

  /**
   * Replaces a whole buffer's pixels as one undo step (transforms,
   * adjustments, paste) — bypasses selection clipping and alpha lock, since
   * those ops already decided exactly which pixels change.
   */
  private applyBuffer(label: string, target: PixelData, next: Uint32Array, sel?: PixelSelection | null): boolean {
    this.rec.begin(target);
    this.batchLabel = label;
    this.batchSelection = this.sel;
    const px = target.pixels;
    for (let i = 0; i < px.length; i++) {
      if (px[i] !== next[i]) {
        this.rec.record(i, px[i]);
        target.setRaw(i, next[i]);
      }
    }
    if (sel !== undefined) this.setSelection(sel);
    const changed = this.rec.size > 0;
    this.commit();
    return changed;
  }

  // ---- move tool ------------------------------------------------------
  moveBegin(): boolean {
    if (!this.stack) return false;
    const data = this.data;
    const box = this.sel?.bounds() ?? { x: 0, y: 0, w: data.width, h: data.height };
    this.moveState = { snapshot: data.pixels.slice(), sel: this.sel, box };
    this.begin('Move');
    return true;
  }

  moveTo(dx: number, dy: number): void {
    const m = this.moveState;
    const data = this.rec.active;
    if (!m || !data) return;
    this.rec.revert();
    const { pixels, selection } = transformPixels(m.snapshot, data.width, data.height, m.sel?.mask ?? null, m.box, { kind: 'translate', dx, dy });
    const px = data.pixels;
    for (let i = 0; i < px.length; i++) {
      if (px[i] !== pixels[i]) {
        this.rec.record(i, px[i]);
        data.setRaw(i, pixels[i]);
      }
    }
    if (m.sel && selection) {
      this.sel = new PixelSelection(data.width, data.height, selection);
      this.store.bumpSelection();
    }
  }

  moveEnd(): void {
    if (!this.moveState) return;
    this.moveState = null;
    this.commit();
  }

  // ---- gradient ---------------------------------------------------------
  fillGradient(from: { x: number; y: number }, to: { x: number; y: number }, reverse: boolean): void {
    if (!this.stack) return;
    const data = this.data;
    const c0 = reverse ? this.secondary : this.primary;
    const c1 = reverse ? this.primary : this.secondary;
    const box = this.sel?.bounds() ?? { x: 0, y: 0, w: data.width, h: data.height };
    this.begin('Gradient');
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        const t = gradientT(this.gradientKind, from.x, from.y, to.x, to.y, x + 0.5, y + 0.5);
        this.write(x, y, gradientColor(this.gradientStyle, c0, c1, t, x, y));
      }
    }
    this.commit();
  }

  // ---- selection commands --------------------------------------------
  selectAll(): void {
    if (!this.stack) return;
    this.setSelection(PixelSelection.all(this.stack.width, this.stack.height));
  }

  invertSelection(): void {
    if (!this.stack) return;
    this.setSelection(this.sel ? this.sel.invert() : null);
  }

  /** Selects the active layer's opaque pixels (Photoshop's Ctrl+click on a layer thumbnail). */
  selectLayerAlpha(): void {
    const stack = this.stack;
    if (!stack) return;
    const l = stack.active;
    this.setSelection(PixelSelection.fromPixels(stack.width, stack.height, l.data.pixels, (v) => v >>> 24 !== 0));
  }

  /** Selects where the active layer's mask is at least half white. */
  selectFromMask(): void {
    const stack = this.stack;
    const mask = stack?.active.mask;
    if (!stack || !mask) return;
    this.setSelection(PixelSelection.fromPixels(stack.width, stack.height, mask.pixels, (v) => (v & 0xff) >= 128));
  }

  /** Erases (sets transparent / hides, on a mask) every selected pixel, as one undo step. */
  eraseSelection(): boolean {
    const sel = this.sel;
    if (!sel || !this.stack) return false;
    return this.fillSelectionWith(0, 'Erase selection');
  }

  fillSelection(slot: 'primary' | 'secondary'): boolean {
    if (!this.stack) return false;
    return this.fillSelectionWith(slot === 'primary' ? this.primary : this.secondary, 'Fill selection');
  }

  private fillSelectionWith(rgba: number, label: string): boolean {
    const data = this.data;
    const box = this.sel?.bounds() ?? { x: 0, y: 0, w: data.width, h: data.height };
    this.begin(label);
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) this.write(x, y, rgba);
    const changed = this.rec.size > 0;
    this.commit();
    return changed;
  }

  /** Snapshots the selected pixels (the whole canvas when nothing is selected) — from the active buffer, or all layers merged. */
  copySelection(merged = false): boolean {
    const stack = this.stack;
    if (!stack) return false;
    const src = merged ? this.composite : this.data;
    const sel = this.sel;
    const box = sel?.bounds() ?? { x: 0, y: 0, w: src.width, h: src.height };
    const pixels = new Uint32Array(box.w * box.h);
    const mask = new Uint8Array(box.w * box.h);
    for (let y = 0; y < box.h; y++) {
      for (let x = 0; x < box.w; x++) {
        const i = box.x + x + (box.y + y) * src.width;
        if (sel && !sel.mask[i]) continue;
        pixels[y * box.w + x] = src.pixels[i];
        mask[y * box.w + x] = 1;
      }
    }
    this.clipboard = { ...box, pixels, mask };
    this.clipboardAt = performance.now();
    this.store.bumpSelection();
    return true;
  }

  /** Copy, then erase the selection — one extra undo step (the erase), same as any other cut. */
  cutSelection(): boolean {
    if (!this.sel || !this.copySelection()) return false;
    this.eraseSelection();
    return true;
  }

  get canPaste(): boolean {
    return this.clipboard !== null;
  }

  /**
   * Stamps the clipboard back where it was copied from — into the active
   * buffer, or as a new layer — and selects the pasted shape, ready to move.
   * Anything that falls outside a differently-sized canvas is dropped.
   */
  pasteSelection(asNewLayer = false): boolean {
    const clip = this.clipboard;
    const stack = this.stack;
    if (!clip || !stack) return false;
    const { width: w, height: h } = stack;
    const shape = new PixelSelection(w, h);
    const place = (out: Uint32Array) => {
      for (let y = 0; y < clip.h; y++) {
        const ty = clip.y + y;
        if (ty < 0 || ty >= h) continue;
        for (let x = 0; x < clip.w; x++) {
          const tx = clip.x + x;
          if (tx < 0 || tx >= w || !clip.mask[y * clip.w + x]) continue;
          out[tx + ty * w] = clip.pixels[y * clip.w + x];
          shape.mask[tx + ty * w] = 1;
        }
      }
    };
    if (asNewLayer) {
      const px = new Uint32Array(w * h);
      place(px);
      this.stackOp('Paste as layer', (s) => void s.addLayer(PixelData.fromPixels(w, h, px), s.uniqueName('Pasted')));
      this.setSelection(shape);
      return true;
    }
    const target = this.data;
    const next = target.pixels.slice();
    place(next);
    if (this.editingMask) for (let i = 0; i < next.length; i++) if (shape.mask[i]) next[i] = maskFromColor(next[i]);
    this.applyBuffer('Paste', target, next, shape);
    return true;
  }

  /**
   * Nudges the selection (and the pixels under it) by (dx, dy), one undo step
   * — or the whole layer when nothing is selected. A selection is never
   * pushed partly off the canvas: that would silently crop whatever slid past
   * the edge.
   */
  moveSelection(dx: number, dy: number): boolean {
    if (!this.stack || (dx === 0 && dy === 0)) return false;
    const b = this.sel?.bounds();
    if (b && (b.x + dx < 0 || b.y + dy < 0 || b.x + b.w + dx > this.stack.width || b.y + b.h + dy > this.stack.height)) return false;
    return this.transform({ kind: 'translate', dx, dy });
  }

  /** Flip / rotate / scale / translate the selected pixels (or the whole active buffer), one undo step. */
  transform(t: PixelTransform): boolean {
    const stack = this.stack;
    if (!stack) return false;
    const data = this.data;
    const box = this.sel?.bounds() ?? { x: 0, y: 0, w: data.width, h: data.height };
    const res = transformPixels(data.pixels, data.width, data.height, this.sel?.mask ?? null, box, t);
    const nextSel = res.selection ? new PixelSelection(data.width, data.height, res.selection) : undefined;
    return this.applyBuffer(transformLabel(t), data, res.pixels, nextSel);
  }

  // ---- adjustments (live preview) ---------------------------------------
  /** Starts a live adjustment preview on the active buffer. */
  beginPreview(): void {
    if (!this.stack || this.preview) return;
    const target = this.data;
    this.preview = { target, original: target.pixels.slice() };
  }

  /** Shows the adjustment applied to the preview's original pixels (selected ones only). */
  previewAdjustment(adj: Adjustment): void {
    const p = this.preview;
    if (!p) return;
    p.target.setAll(adjustPixels(p.original, this.sel?.mask ?? null, adj));
  }

  /** Commit keeps what the preview shows as one undo step; otherwise the original pixels come back. */
  endPreview(commit: boolean, label = 'Adjust'): void {
    const p = this.preview;
    if (!p) return;
    this.preview = null;
    const shown = p.target.pixels.slice();
    p.target.setAll(p.original);
    if (commit) this.applyBuffer(label, p.target, shown);
  }

  /** One-shot adjustment without a dialog (invert, desaturate). */
  adjust(adj: Adjustment, label: string): boolean {
    if (!this.stack) return false;
    const data = this.data;
    return this.applyBuffer(label, data, adjustPixels(data.pixels, this.sel?.mask ?? null, adj));
  }

  // ---- layers -----------------------------------------------------------
  /** Runs a structural change on the active stack as one undoable step. `fn` returning false means "nothing happened". */
  stackOp(label: string, fn: (stack: LayerStack) => boolean | void): boolean {
    const stack = this.stack;
    if (!stack) return false;
    this.commitLayerProps();
    const before = stack.snapshot();
    if (fn(stack) === false) return false;
    stack.structureChanged();
    this.currentHistory().push({ kind: 'stack', label, stack, before, after: stack.snapshot() });
    this.afterStackChange();
    return true;
  }

  private afterStackChange(): void {
    this.syncMaskMode();
    this.store.bumpLayers();
    this.store.bumpEdit();
  }

  setActiveLayer(id: string, editMask = false): void {
    const stack = this.stack;
    const layer = stack?.layer(id);
    if (!stack || !layer) return;
    this.commitLayerProps();
    stack.activeId = id;
    this.store.editMask = editMask && !!layer.mask;
    this.syncMaskMode();
    this.store.bumpLayers();
  }

  addLayer(): void {
    this.stackOp('New layer', (s) => void s.addLayer());
  }

  duplicateLayer(id: string): void {
    this.stackOp('Duplicate layer', (s) => s.duplicateLayer(id) !== null);
  }

  removeLayer(id: string): void {
    this.stackOp('Delete layer', (s) => s.removeLayer(id));
  }

  moveLayer(id: string, dir: 1 | -1): void {
    this.stackOp(dir > 0 ? 'Move layer up' : 'Move layer down', (s) => s.moveLayer(id, dir));
  }

  mergeDown(id: string): void {
    this.stackOp('Merge down', (s) => s.mergeDown(id));
  }

  flatten(): void {
    this.stackOp('Flatten', (s) => {
      if (s.layers.length <= 1) return false;
      s.flatten();
    });
  }

  /**
   * Live-edit layer properties. With `commit` false (a slider being dragged)
   * the change shows immediately but only becomes an undo step on the next
   * committing call — one step per drag instead of one per input event.
   */
  setLayerProps(id: string, props: LayerProps, commit = true): void {
    const stack = this.stack;
    const layer = stack?.layer(id);
    if (!stack || !layer) return;
    if (!this.pendingProps || this.pendingProps.stack !== stack) {
      this.commitLayerProps();
      this.pendingProps = { stack, before: stack.snapshot() };
    }
    if (props.name !== undefined) layer.name = props.name.trim() || layer.name;
    if (props.visible !== undefined) layer.visible = props.visible;
    if (props.opacity !== undefined) layer.opacity = Math.min(1, Math.max(0, props.opacity));
    if (props.blend !== undefined) layer.blend = props.blend;
    if (props.alphaLock !== undefined) layer.alphaLock = props.alphaLock;
    if (props.clip !== undefined) layer.clip = props.clip;
    if (props.maskEnabled !== undefined) layer.maskEnabled = props.maskEnabled;
    stack.structureChanged();
    this.store.bumpLayers();
    if (commit) this.commitLayerProps();
  }

  private commitLayerProps(): void {
    const p = this.pendingProps;
    if (!p) return;
    this.pendingProps = null;
    this.currentHistory().push({ kind: 'stack', label: 'Layer properties', stack: p.stack, before: p.before, after: p.stack.snapshot() });
    this.store.bumpEdit();
  }

  /**
   * Adds a mask to a layer: from the selection when there is one (selected =
   * visible, like Photoshop's "Reveal Selection"), else all white. Switches
   * painting to the mask.
   */
  addMask(id: string): void {
    const stack = this.stack;
    const layer = stack?.layer(id);
    if (!stack || !layer || layer.mask) return;
    const sel = this.sel;
    const mask = new PixelData(stack.width, stack.height);
    if (sel) {
      const px = new Uint32Array(stack.width * stack.height);
      for (let i = 0; i < px.length; i++) px[i] = sel.mask[i] ? MASK_WHITE : MASK_BLACK;
      mask.setAll(px);
    } else {
      mask.fill(MASK_WHITE);
    }
    this.stackOp('Add mask', (s) => {
      const l = s.layer(id);
      if (!l) return false;
      l.mask = mask;
      l.maskEnabled = true;
      s.activeId = id;
    });
    if (sel) this.setSelection(null);
    this.store.editMask = true;
    this.store.bumpLayers();
  }

  removeMask(id: string): void {
    this.stackOp('Delete mask', (s) => {
      const l = s.layer(id);
      if (!l?.mask) return false;
      l.mask = null;
    });
  }

  applyMask(id: string): void {
    this.stackOp('Apply mask', (s) => s.applyMask(id));
  }

  /** Imports an image as a new layer, centred. Returns false when it's bigger than the canvas (the caller decides whether to grow it first). */
  importLayer(img: ImportedImage, name: string): boolean {
    const stack = this.stack;
    if (!stack) return false;
    const { width: w, height: h } = stack;
    if (img.width > w || img.height > h) return false;
    const px = new Uint32Array(w * h);
    const ox = Math.floor((w - img.width) / 2);
    const oy = Math.floor((h - img.height) / 2);
    for (let y = 0; y < img.height; y++) {
      px.set(img.pixels.subarray(y * img.width, (y + 1) * img.width), ox + (y + oy) * w);
    }
    this.store.editMask = false;
    return this.stackOp('Import image', (s) => void s.addLayer(PixelData.fromPixels(w, h, px), s.uniqueName(name)));
  }

  /**
   * Replace the active state's layers with a copy of another state's — a
   * starting point to tweak hover/pressed/disabled from instead of a blank
   * canvas. One undo step. No-op (false) for a missing source or itself.
   */
  copyStateFrom(sourceId: StateId): boolean {
    const element = this.store.activeElement();
    const source = element?.states.get(sourceId);
    if (!source || source === this.stack) return false;
    const copy = source.clone();
    return this.stackOp(`Copy from ${sourceId}`, (s) => {
      s.layers = copy.layers;
      s.activeId = copy.activeId;
    });
  }

  // ---- history ------------------------------------------------------
  private historyKey(): string {
    return `${this.store.activeWidgetId ?? '_'}:${this.store.activeElementId}:${this.store.activeStateId}`;
  }
  private currentHistory(): PixelHistory {
    const key = this.historyKey();
    let h = this.histories.get(key);
    if (!h) {
      h = new PixelHistory();
      this.histories.set(key, h);
    }
    return h;
  }

  /** Drop the undo stacks of a widget's canvases (all elements, or just one) — they no longer exist / mean the same pixels. */
  forgetHistory(widgetId: string, elementId?: string): void {
    const widget = this.store.project?.getById(widgetId);
    if (!widget) return;
    for (const [eid, el] of widget.elements) {
      if (elementId !== undefined && eid !== elementId) continue;
      for (const s of el.states.keys()) this.histories.delete(`${widgetId}:${eid}:${s}`);
    }
  }

  private afterHistory(e: HistoryEntry | null, dir: 'undo' | 'redo'): void {
    if (!e) return;
    if (e.kind === 'pixels' && e.selection) {
      this.sel = dir === 'undo' ? e.selection.before : e.selection.after;
      this.store.bumpSelection();
    }
    if (e.kind === 'stack') this.syncMaskMode();
    this.store.bumpLayers();
    this.store.bumpEdit();
  }

  undo(): void {
    if (!this.stack || this.rec.active) return;
    this.endPreview(false);
    this.commitLayerProps();
    this.afterHistory(this.currentHistory().undo(), 'undo');
  }

  redo(): void {
    if (!this.stack || this.rec.active) return;
    this.endPreview(false);
    this.commitLayerProps();
    this.afterHistory(this.currentHistory().redo(), 'redo');
  }

  get canUndo() {
    return this.currentHistory().canUndo || this.pendingProps !== null;
  }
  get canRedo() {
    return this.currentHistory().canRedo;
  }

  // ---- pointer plumbing ----------------------------------------------
  pointerDown(e: PointerEvent): void {
    // an adjustment preview is showing — painting now would get folded into (or lost by) it
    if (!this.stack || this.preview) return;
    this.commitLayerProps();
    this.tool.pointerDown(this, info(e));
  }
  pointerMove(e: PointerEvent): void {
    if (!this.stack) return;
    this.tool.pointerMove(this, info(e));
  }
  pointerUp(e: PointerEvent): void {
    if (!this.stack) return;
    this.tool.pointerUp(this, info(e));
  }
  pointerLeave(): void {
    this.tool.clearPreview(this);
  }

  /** The active layer (for panels). */
  activeLayer(): PixelLayer | null {
    return this.stack?.active ?? null;
  }
}

function transformLabel(t: PixelTransform): string {
  switch (t.kind) {
    case 'flipH':
      return 'Flip horizontal';
    case 'flipV':
      return 'Flip vertical';
    case 'rotCW':
      return 'Rotate 90° CW';
    case 'rotCCW':
      return 'Rotate 90° CCW';
    case 'rot180':
      return 'Rotate 180°';
    case 'scale':
      return 'Scale';
    case 'translate':
      return 'Move';
  }
}

function info(e: PointerEvent): PixelPointer {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    button: e.button,
    shiftKey: e.shiftKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    detail: e.detail,
  };
}
