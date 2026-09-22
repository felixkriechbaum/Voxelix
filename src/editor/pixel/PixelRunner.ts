import { HistoryStore } from '@/core/history/History';
import { PixelData, type PixelEdit } from '@/core/pixel/PixelData';
import { createPixelTool } from '@/tools/pixel/tools';
import type { PixelRenderer } from '@/pixel/PixelRenderer';
import type { PixelTool, PixelToolContext, PixelToolId, PixelPointer, PixelRectSel } from '@/tools/pixel/types';
import type { StateId } from '@/core/pixel/types';
import type { PixelStore } from '@/stores/pixel';

/** Bridges pointer input + the active PixelTool + undo history + the renderer, for one widget/state canvas. */
export class PixelRunner implements PixelToolContext {
  private tool: PixelTool;
  private batch: PixelEdit[] = [];
  private batchLabel = '';
  /** keyed by `${widgetId}:${stateId}` — switching state is a different undo stack */
  private histories = new HistoryStore<PixelEdit>();
  private activeData: PixelData | null = null;
  private cursor: { x: number; y: number } | null = null;
  private selectionBox: PixelRectSel | null = null;

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

  /** Recompute the active canvas. Call on widget/state switch or undo/redo. */
  syncActive(): void {
    const widget = this.store.activeWidget();
    if (!widget) {
      this.activeData = null;
      return;
    }
    this.activeData = widget.stateData(this.store.activeStateId);
    this.renderer.setSource(this.activeData);
  }

  // ---- PixelToolContext -------------------------------------------------
  get data(): PixelData {
    if (!this.activeData) throw new Error('no active widget');
    return this.activeData;
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
  get contiguous(): boolean {
    return this.store.contiguous;
  }
  get selection(): PixelRectSel | null {
    return this.selectionBox;
  }

  cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    return this.renderer.toCell(clientX, clientY, this.store.zoom);
  }

  begin(label: string): void {
    this.batch = [];
    this.batchLabel = label;
  }

  write(x: number, y: number, rgba: number): void {
    const data = this.activeData;
    if (!data) return;
    const i = data.index(x, y);
    if (i < 0) return;
    const prev = data.get(x, y);
    const next = rgba >>> 0;
    if (prev === next) return;
    data.setRaw(i, next);
    this.batch.push({ i, prev, next });
  }

  commit(): void {
    if (this.batch.length > 0) {
      this.currentHistory().push({ label: this.batchLabel, edits: this.batch.slice() });
      this.store.bumpEdit();
    }
    this.batch = [];
  }

  cancel(): void {
    const data = this.activeData;
    if (data) for (let i = this.batch.length - 1; i >= 0; i--) data.applyEdit(this.batch[i], this.batch[i].prev);
    this.batch = [];
  }

  setSelection(r: PixelRectSel | null): void {
    this.selectionBox = r;
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

  /** Small PNG data URL of the active widget's active state, for autosave thumbnails. */
  captureThumbnail(): string {
    return this.renderer.captureThumbnail();
  }

  /**
   * Replace the active state's canvas with another state's pixels, as one
   * undoable batch — painting hover/pressed/disabled/focus from a blank
   * canvas every time is the tedious part of "a complete button", and this
   * gives a starting point to tweak from instead. No-op (returns false) if
   * the source state doesn't exist or is the state you're already on.
   */
  copyStateFrom(sourceId: StateId): boolean {
    const widget = this.store.activeWidget();
    const data = this.activeData;
    if (!widget || !data) return false;
    const source = widget.states.get(sourceId);
    if (!source || source === data) return false;
    this.begin(`Copy from ${sourceId}`);
    for (let y = 0; y < data.height; y++) {
      for (let x = 0; x < data.width; x++) this.write(x, y, source.get(x, y));
    }
    this.commit();
    return true;
  }

  /** Erases (sets transparent) every pixel inside the current selection, as one undo step. No-op if there is none. */
  eraseSelection(): boolean {
    const sel = this.selectionBox;
    if (!sel || !this.activeData) return false;
    this.begin('Erase selection');
    for (let y = sel.y; y < sel.y + sel.h; y++) {
      for (let x = sel.x; x < sel.x + sel.w; x++) this.write(x, y, 0);
    }
    const changed = this.batch.length > 0;
    this.commit();
    return changed;
  }

  // ---- history ------------------------------------------------------
  private historyKey(): string {
    return `${this.store.activeWidgetId ?? '_'}:${this.store.activeStateId}`;
  }
  private currentHistory() {
    return this.histories.for(this.historyKey());
  }

  /** Drop every undo stack belonging to a widget (all its states) — its canvases no longer exist. */
  forgetHistory(widgetId: string): void {
    const widget = this.store.project?.getById(widgetId);
    const states = widget ? [...widget.states.keys()] : ['normal'];
    for (const s of states) this.histories.drop(`${widgetId}:${s}`);
  }

  undo(): void {
    const data = this.activeData;
    if (!data) return;
    if (this.currentHistory().undo(data)) {
      this.store.bumpEdit();
    }
  }

  redo(): void {
    const data = this.activeData;
    if (!data) return;
    if (this.currentHistory().redo(data)) {
      this.store.bumpEdit();
    }
  }

  get canUndo() {
    return this.currentHistory().canUndo;
  }
  get canRedo() {
    return this.currentHistory().canRedo;
  }

  // ---- pointer plumbing ----------------------------------------------
  pointerDown(e: PointerEvent): void {
    if (!this.activeData) return;
    this.tool.pointerDown(this, info(e));
  }
  pointerMove(e: PointerEvent): void {
    if (!this.activeData) return;
    this.tool.pointerMove(this, info(e));
  }
  pointerUp(e: PointerEvent): void {
    if (!this.activeData) return;
    this.tool.pointerUp(this, info(e));
  }
  pointerLeave(): void {
    this.tool.clearPreview(this);
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
