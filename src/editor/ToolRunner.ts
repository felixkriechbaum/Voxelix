import { HistoryStore } from '@/core/history/History';
import { createTool, BoxTool } from '@/tools/tools';
import { VoxelData } from '@/core/voxel/VoxelData';
import { REMOVED } from '@/core/voxel/constants';
import { buildActiveRender, overlayWriteValue, resolveEffectiveData } from '@/core/project/resolve';
import type { Tool, ToolContext, ToolId, PointerInfo } from '@/tools/types';
import type { Selection } from '@/core/ops/selection';
import type { VoxelEdit } from '@/core/voxel/types';
import type { VoxelObject } from '@/core/project/VoxelObject';
import type { CursorBox } from '@/viewport/Gizmos';
import type { Viewport } from '@/viewport/Viewport';
import type { EditorStore } from '@/stores/editor';

interface ActiveCtx {
  object: VoxelObject;
  extend: boolean;
  /** grid tools read from (resolved view for extend, raw grid for normal) */
  readData: VoxelData;
  /** resolved base, only for extend */
  baseResolved: VoxelData | null;
}

/** Bridges pointer input + the active Tool + undo history + the viewport. */
export class ToolRunner implements ToolContext {
  private tool: Tool;
  private batch: VoxelEdit[] = [];
  private batchLabel = '';
  private histories = new HistoryStore();
  private ctx: ActiveCtx | null = null;
  private liveFlushQueued = false;

  constructor(
    private viewport: Viewport,
    private store: EditorStore,
  ) {
    this.tool = createTool(store.toolId);
    this.syncBoxMode();
    this.syncActive();
  }

  setTool(id: ToolId): void {
    this.tool.clearPreview(this);
    this.tool = createTool(id);
    this.syncBoxMode();
  }

  syncBoxMode(): void {
    if (this.tool instanceof BoxTool) this.tool.mode = this.store.boxMode;
  }

  /** Recompute the active-object context. Call on object switch / undo / external edits. */
  syncActive(): void {
    const object = this.store.activeObject();
    const project = this.store.project;
    if (!object || !project) {
      this.ctx = null;
      return;
    }
    if (object.kind === 'extend' && object.baseId) {
      const base = project.getById(object.baseId);
      const baseResolved = base
        ? resolveEffectiveData(base, project)
        : new VoxelData(object.data.sizeX, object.data.sizeY, object.data.sizeZ);
      this.ctx = { object, extend: true, baseResolved, readData: this.resolveRead(object, baseResolved) };
    } else {
      this.ctx = { object, extend: false, baseResolved: null, readData: object.data };
    }
  }

  private resolveRead(object: VoxelObject, baseResolved: VoxelData): VoxelData {
    const size: [number, number, number] = [
      Math.max(baseResolved.sizeX, object.data.sizeX),
      Math.max(baseResolved.sizeY, object.data.sizeY),
      Math.max(baseResolved.sizeZ, object.data.sizeZ),
    ];
    const read = new VoxelData(...size);
    baseResolved.forEachFilled((x, y, z, c) => read.set(x, y, z, c));
    object.data.forEachEntry((x, y, z, v) => {
      if (v === REMOVED) read.clear(x, y, z);
      else read.setRaw(x, y, z, v);
    });
    return read;
  }

  // ---- ToolContext -----------------------------------------------------
  get data(): VoxelData {
    if (!this.ctx) throw new Error('no active object');
    return this.ctx.readData;
  }

  get colorIndex(): number {
    return this.store.currentColor;
  }

  get buildPlane() {
    return this.store.buildPlane;
  }

  /** brush footprint in voxels: place / erase an N^3 block at once */
  get brushSize(): number {
    return Math.max(1, this.store.brushSize);
  }

  pick(clientX: number, clientY: number) {
    return this.viewport.pick(clientX, clientY, this.store.buildPlane, this.store.buildOffset);
  }

  pickOnPlane(clientX: number, clientY: number, axis: 0 | 1 | 2, planeCoord: number, cellValue: number) {
    return this.viewport.pickOnPlane(clientX, clientY, axis, planeCoord, cellValue);
  }

  begin(label: string): void {
    this.batch = [];
    this.batchLabel = label;
  }

  write(x: number, y: number, z: number, value: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    if (!ctx.extend) {
      const prev = ctx.object.data.setRaw(x, y, z, value);
      if (prev !== value) {
        this.batch.push({ x, y, z, prev, next: value });
        this.liveFlush();
      }
      return;
    }

    const stored = overlayWriteValue(value, ctx.baseResolved!, x, y, z);
    const prev = ctx.object.data.setRaw(x, y, z, stored);
    if (prev !== stored) {
      this.batch.push({ x, y, z, prev, next: stored });
      this.liveFlush();
    }

    // keep the read view in lockstep
    if (stored === REMOVED) ctx.readData.clear(x, y, z);
    else if (stored === 0) ctx.readData.setRaw(x, y, z, ctx.baseResolved!.get(x, y, z));
    else ctx.readData.setRaw(x, y, z, stored);
  }

  /** Re-mesh mid-stroke so a drag shows its result live, not only on release. */
  private liveFlush(): void {
    if (this.liveFlushQueued) return;
    this.liveFlushQueued = true;
    requestAnimationFrame(() => {
      this.liveFlushQueued = false;
      if (this.batch.length > 0) this.afterEdit();
    });
  }

  commit(): void {
    if (this.batch.length > 0) {
      this.currentHistory().push({ label: this.batchLabel, edits: this.batch.slice() });
      this.store.bumpEdit();
    }
    this.batch = [];
    this.afterEdit();
  }

  cancel(): void {
    for (let i = this.batch.length - 1; i >= 0; i--) {
      const e = this.batch[i];
      this.ctx?.object.data.setRaw(e.x, e.y, e.z, e.prev);
    }
    this.batch = [];
    this.syncActive();
    this.afterEdit();
  }

  setCursor(box: CursorBox | null): void {
    this.viewport.setCursor(box);
  }

  pickColor(index: number): void {
    this.store.setColor(index);
  }

  get selection(): Selection | null {
    return this.store.selection;
  }

  setSelection(selection: Selection | null): void {
    this.store.setSelection(selection);
  }

  // ---- history --------------------------------------------------------
  private currentHistory() {
    return this.histories.for(this.store.activeObjectId ?? '_');
  }

  private afterEdit(): void {
    if (this.ctx?.extend) {
      const project = this.store.project!;
      const render = buildActiveRender(this.ctx.object, project);
      this.viewport.refreshEditable(render.editableData);
      // an erase over a base voxel stores a REMOVED marker — the locked base mesh
      // has to re-mesh too, or the "deleted" voxel stays visible until an object switch
      if (render.baseContext) this.viewport.refreshBase(render.baseContext);
    } else {
      this.viewport.flush();
    }
  }

  undo(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.currentHistory().undo(ctx.object.data)) {
      this.syncActive();
      this.afterEdit();
      this.store.bumpEdit();
    }
  }

  redo(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.currentHistory().redo(ctx.object.data)) {
      this.syncActive();
      this.afterEdit();
      this.store.bumpEdit();
    }
  }

  get canUndo() {
    return this.currentHistory().canUndo;
  }
  get canRedo() {
    return this.currentHistory().canRedo;
  }

  /**
   * Extend objects only: discard the whole overlay diff (colours + REMOVED
   * markers) so the object matches its base again. One undoable history batch.
   */
  resetOverlay(): boolean {
    const ctx = this.ctx;
    if (!ctx || !ctx.extend) return false;
    const edits: VoxelEdit[] = [];
    ctx.object.data.forEachEntry((x, y, z, v) => edits.push({ x, y, z, prev: v, next: 0 }));
    if (edits.length === 0) return false;
    for (const e of edits) ctx.object.data.setRaw(e.x, e.y, e.z, 0);
    this.currentHistory().push({ label: 'Reset extend', edits });
    this.store.bumpEdit();
    this.syncActive();
    this.afterEdit();
    return true;
  }

  /**
   * Run an external, non-pointer edit (shape dialog, context-menu ops) through
   * the same overlay-aware write path and history as a tool stroke.
   */
  runExternal(label: string, fn: (write: (x: number, y: number, z: number, value: number) => void) => void): void {
    this.begin(label);
    fn((x, y, z, value) => this.write(x, y, z, value));
    this.commit();
  }

  // ---- pointer plumbing ----------------------------------------------
  pointerDown(e: PointerEvent): void {
    if (!this.ctx || this.viewport.controls.navigating) return;
    this.tool.pointerDown(this, info(e));
  }

  pointerMove(e: PointerEvent): void {
    if (!this.ctx || this.viewport.controls.navigating) return;
    this.tool.pointerMove(this, info(e));
  }

  pointerUp(e: PointerEvent): void {
    if (!this.ctx) return;
    this.tool.pointerUp(this, info(e));
  }

  pointerLeave(): void {
    this.tool.clearPreview(this);
  }
}

function info(e: PointerEvent): PointerInfo {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    button: e.button,
    shiftKey: e.shiftKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
  };
}
