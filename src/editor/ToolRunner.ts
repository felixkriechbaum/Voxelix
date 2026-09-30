import { HistoryStore } from '@/core/history/History';
import { createTool, BoxTool } from '@/tools/tools';
import { VoxelData } from '@/core/voxel/VoxelData';
import { REMOVED } from '@/core/voxel/constants';
import {
  buildActiveRender,
  effectiveDetail,
  overlayWriteValue,
  resolveEffectiveData,
  hasModifiersInChain,
  someInChain,
} from '@/core/project/resolve';
import { anyMirror, mirrorBoxes, mirrorImages, type Vec3 } from '@/core/ops/mirror';
import type { Tool, ToolContext, ToolId, PointerInfo, MirrorMode } from '@/tools/types';
import type { Selection } from '@/core/ops/selection';
import type { VoxelEdit } from '@/core/voxel/types';
import type { VoxelObject } from '@/core/project/VoxelObject';
import type { CursorBox } from '@/viewport/Gizmos';
import type { Viewport } from '@/viewport/Viewport';
import type { ViewRay } from '@/core/ops/visibility';
import type { EditorStore } from '@/stores/editor';

interface ActiveCtx {
  object: VoxelObject;
  extend: boolean;
  /** grid tools read from (resolved view for extend, raw grid for normal) */
  readData: VoxelData;
  /** resolved base, only for extend */
  baseResolved: VoxelData | null;
}

/** Tools whose strokes follow the mirror planes (and get a mirrored ghost cursor). */
const MIRRORING_TOOLS: ReadonlySet<ToolId> = new Set(['place', 'erase', 'box', 'paint', 'bucket']);

/** Bridges pointer input + the active Tool + undo history + the viewport. */
export class ToolRunner implements ToolContext {
  private tool: Tool;
  private batch: VoxelEdit[] = [];
  private batchLabel = '';
  private batchMirror: MirrorMode = 'none';
  private histories = new HistoryStore<VoxelEdit>();
  private ctx: ActiveCtx | null = null;
  private liveFlushQueued = false;
  /** grid cells per voxel edge for the active object */
  private activeDetail = 1;

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
    this.activeDetail = effectiveDetail(object, project);
    if (object.kind === 'extend' && object.baseId) {
      const base = project.getById(object.baseId);
      const baseResolved = base
        ? resolveEffectiveData(base, project)
        : new VoxelData(object.data.sizeX, object.data.sizeY, object.data.sizeZ);
      this.ctx = { object, extend: true, baseResolved, readData: resolveEffectiveData(object, project) };
    } else {
      this.ctx = { object, extend: false, baseResolved: null, readData: object.data };
    }
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

  get bucketMode() {
    return this.store.bucketMode;
  }

  get xray(): boolean {
    return this.store.xray;
  }

  viewRay(): ViewRay {
    return this.viewport.viewRay();
  }

  /** brush footprint in grid cells: a voxel (detail cells) divided by the chosen fraction */
  get brushSize(): number {
    const frac = Math.min(this.activeDetail, Math.max(1, this.store.voxelFraction));
    return Math.max(1, Math.round(this.activeDetail / frac));
  }

  pick(clientX: number, clientY: number) {
    return this.viewport.pick(clientX, clientY, this.store.buildPlane, this.store.buildOffset);
  }

  pickOnPlane(clientX: number, clientY: number, axis: 0 | 1 | 2, planeCoord: number, cellValue: number) {
    return this.viewport.pickOnPlane(clientX, clientY, axis, planeCoord, cellValue);
  }

  begin(label: string, mirror: MirrorMode = 'none'): void {
    this.batch = [];
    this.batchLabel = label;
    this.batchMirror = mirror;
  }

  /** The grid size the mirror planes are centred in (the resolved read view). */
  private mirrorSize(): Vec3 | null {
    const d = this.ctx?.readData;
    return d ? [d.sizeX, d.sizeY, d.sizeZ] : null;
  }

  write(x: number, y: number, z: number, value: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const size = this.batchMirror !== 'none' && anyMirror(this.store.mirror) ? this.mirrorSize() : null;
    // decide the mirrored targets before the primary write can change solidity
    const images = size
      ? mirrorImages([x, y, z], size, this.store.mirror).filter(
          ([mx, my, mz]) => this.batchMirror !== 'recolour' || ctx.readData.isSolid(mx, my, mz),
        )
      : [];
    this.writeOne(ctx, x, y, z, value);
    for (const [mx, my, mz] of images) this.writeOne(ctx, mx, my, mz, value);
  }

  /** One cell through the overlay-aware path, recorded in the open batch. */
  private writeOne(ctx: ActiveCtx, x: number, y: number, z: number, value: number): void {
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
      if (this.batch.length > 0) this.afterEdit(true);
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
    this.viewport.setCursor(box, box ? this.mirrorCursors(box) : []);
  }

  /** Ghost copies of the cursor at its mirror positions, for tools that mirror. */
  private mirrorCursors(box: CursorBox): CursorBox[] {
    const size = this.mirrorSize();
    if (!size || !anyMirror(this.store.mirror) || !MIRRORING_TOOLS.has(this.tool.id)) return [];
    const min: Vec3 = [box.min.x, box.min.y, box.min.z];
    const max: Vec3 = [box.max.x, box.max.y, box.max.z];
    return mirrorBoxes(min, max, size, this.store.mirror).map(([mn, mx]) => ({
      min: box.min.clone().set(...mn),
      max: box.max.clone().set(...mx),
      color: box.color,
    }));
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
  /** One undo stack per part — switching parts never undoes into the wrong grid. */
  private currentHistory() {
    const obj = this.ctx?.object;
    return this.histories.for(obj ? `${obj.id}/${obj.activePartId}` : '_');
  }

  /** Drop an object's undo stacks (all its parts) — their diffs no longer line up with the grid. */
  forgetHistory(objectId: string): void {
    this.histories.drop(objectId);
  }

  /** `live`: mid-stroke — skip regenerating a smoothed result, too slow per frame; the cage shows the stroke. */
  private afterEdit(live = false): void {
    if (this.ctx?.extend) {
      const project = this.store.project!;
      // the base's modifiers act on the overlay too (see resolveParts) — a
      // smoothed or un-voxeled base is too slow to regenerate per frame, so
      // mid-stroke only the lockstep read view moves and it catches up on commit
      const modifiers = hasModifiersInChain(this.ctx.object, project);
      if (live && modifiers && someInChain(this.ctx.object, project, (p) => p.isSmoothed)) return;
      const render = buildActiveRender(this.ctx.object, project);
      this.viewport.refreshEditable(render.editableData);
      // an erase over a base voxel stores a REMOVED marker — the locked base mesh
      // has to re-mesh too, or the "deleted" voxel stays visible until an object switch
      if (render.baseContext) this.viewport.refreshBase(render.baseContext);
      if (!live) {
        this.viewport.refreshSmooth(render.smooth, render.detail);
        // modifier copies of what was just drawn only exist in a fresh resolve
        if (modifiers) this.ctx.readData = resolveEffectiveData(this.ctx.object, project);
      }
    } else if (this.ctx?.object.activePart.hasActiveModifiers && !(live && this.ctx.object.activePart.isSmoothed)) {
      // the part's array copies are generated from it — regenerate them live
      this.viewport.flush();
      const render = buildActiveRender(this.ctx.object, this.store.project!);
      if (render.baseContext) this.viewport.refreshBase(render.baseContext);
      // only the part being edited changed — the other smooth surfaces stay as they are
      const own = `${this.ctx.object.id}/${this.ctx.object.activePartId}`;
      this.viewport.refreshSmooth(render.smooth.filter((l) => l.key === own), render.detail);
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
    if (!ctx || !ctx.extend || !this.hasLinkedBase(ctx)) return false;
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
   * Extend overlays only: drop the overlay's own entry at these cells so they
   * inherit from the base again. Writing 0 instead would store a REMOVED marker
   * — an explicit deletion — so this needs its own path. One undoable batch.
   */
  revertToBase(cells: Array<[number, number, number]>, label = 'Revert to base'): boolean {
    const ctx = this.ctx;
    if (!ctx || !ctx.extend || !this.hasLinkedBase(ctx)) return false;
    const edits: VoxelEdit[] = [];
    for (const [x, y, z] of cells) {
      const prev = ctx.object.data.get(x, y, z);
      if (prev === 0) continue; // nothing of ours here — already inherited
      ctx.object.data.setRaw(x, y, z, 0);
      edits.push({ x, y, z, prev, next: 0 });
      ctx.readData.setRaw(x, y, z, ctx.baseResolved!.get(x, y, z));
    }
    if (edits.length === 0) return false;
    this.currentHistory().push({ label, edits });
    this.store.bumpEdit();
    this.afterEdit();
    return true;
  }

  private hasLinkedBase(ctx: ActiveCtx): boolean {
    return !!ctx.object.baseId && !!this.store.project?.getById(ctx.object.baseId);
  }

  /**
   * Run an external, non-pointer edit (shape dialog, context-menu ops) through
   * the same overlay-aware write path and history as a tool stroke.
   */
  runExternal(
    label: string,
    fn: (write: (x: number, y: number, z: number, value: number) => void) => void,
    mirror: MirrorMode = 'none',
  ): void {
    this.begin(label, mirror);
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
    detail: e.detail,
  };
}
