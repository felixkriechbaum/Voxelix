import type { PixelData } from './PixelData';
import type { LayerStack, StackSnapshot } from './layers';
import type { PixelSelection } from './selection';

/** A pixel batch on one buffer (a layer's pixels or its mask): the first `prev` and last `next` per touched index. */
export interface PixelEntry {
  kind: 'pixels';
  label: string;
  target: PixelData;
  idx: Uint32Array;
  prev: Uint32Array;
  next: Uint32Array;
  /** set when the batch also moved / replaced the selection (move tool, transforms, paste) */
  selection?: { before: PixelSelection | null; after: PixelSelection | null };
}

/** A structural change to a layer stack (add / delete / reorder / properties / merge), stored as before/after snapshots. */
export interface StackEntry {
  kind: 'stack';
  label: string;
  stack: LayerStack;
  before: StackSnapshot;
  after: StackSnapshot;
}

export type HistoryEntry = PixelEntry | StackEntry;

const MAX_ENTRIES = 300;
/** rough per-canvas budget; the oldest steps are dropped beyond it */
const MAX_BYTES = 192 * 1024 * 1024;

function entryBytes(e: HistoryEntry): number {
  return e.kind === 'pixels' ? e.idx.length * 12 : 256;
}

/**
 * Undo/redo for one state image. Separate from core/history's per-cell
 * History: pixel batches here are typed arrays (a full-canvas fill on a
 * 1024² texture is a million writes) and layer operations need their own
 * snapshot entries.
 */
export class PixelHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private bytes = 0;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(e: HistoryEntry): void {
    if (e.kind === 'pixels' && e.idx.length === 0 && !e.selection) return;
    this.undoStack.push(e);
    this.bytes += entryBytes(e);
    this.redoStack.length = 0;
    while (this.undoStack.length > 1 && (this.undoStack.length > MAX_ENTRIES || this.bytes > MAX_BYTES)) {
      this.bytes -= entryBytes(this.undoStack.shift()!);
    }
  }

  undo(): HistoryEntry | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.bytes -= entryBytes(e);
    if (e.kind === 'pixels') {
      for (let k = 0; k < e.idx.length; k++) e.target.setRaw(e.idx[k], e.prev[k]);
    } else {
      e.stack.restore(e.before);
    }
    this.redoStack.push(e);
    return e;
  }

  redo(): HistoryEntry | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    if (e.kind === 'pixels') {
      for (let k = 0; k < e.idx.length; k++) e.target.setRaw(e.idx[k], e.next[k]);
    } else {
      e.stack.restore(e.after);
    }
    this.undoStack.push(e);
    this.bytes += entryBytes(e);
    return e;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.bytes = 0;
  }
}

/**
 * Collects one batch of writes against a buffer, keeping only the first
 * previous value per pixel (a stroke crosses the same pixel many times) so
 * undo restores exactly what was there and the entry stays compact.
 */
export class EditRecorder {
  private target: PixelData | null = null;
  private slot = new Int32Array(0);
  private idx = new Uint32Array(1024);
  private prev = new Uint32Array(1024);
  private n = 0;

  get active(): PixelData | null {
    return this.target;
  }

  get size(): number {
    return this.n;
  }

  begin(target: PixelData): void {
    this.target = target;
    const len = target.width * target.height;
    if (this.slot.length !== len) this.slot = new Int32Array(len).fill(-1);
    else for (let k = 0; k < this.n; k++) this.slot[this.idx[k]] = -1;
    this.n = 0;
  }

  /** Call before overwriting pixel `i`, with its current value. */
  record(i: number, prev: number): void {
    if (this.slot[i] >= 0) return;
    if (this.n === this.idx.length) {
      const idx = new Uint32Array(this.n * 2);
      idx.set(this.idx);
      this.idx = idx;
      const prv = new Uint32Array(this.n * 2);
      prv.set(this.prev);
      this.prev = prv;
    }
    this.slot[i] = this.n;
    this.idx[this.n] = i;
    this.prev[this.n] = prev;
    this.n++;
  }

  /** Puts every touched pixel back and empties the batch. */
  revert(): void {
    const t = this.target;
    if (t) for (let k = this.n - 1; k >= 0; k--) t.setRaw(this.idx[k], this.prev[k]);
    for (let k = 0; k < this.n; k++) this.slot[this.idx[k]] = -1;
    this.n = 0;
  }

  /** The finished batch — pixels whose final value equals their first one are dropped. */
  finish(): { target: PixelData; idx: Uint32Array; prev: Uint32Array; next: Uint32Array } | null {
    const t = this.target;
    if (!t) return null;
    const px = t.pixels;
    let m = 0;
    for (let k = 0; k < this.n; k++) if (px[this.idx[k]] !== this.prev[k]) m++;
    const idx = new Uint32Array(m);
    const prev = new Uint32Array(m);
    const next = new Uint32Array(m);
    let o = 0;
    for (let k = 0; k < this.n; k++) {
      const i = this.idx[k];
      this.slot[i] = -1;
      if (px[i] === this.prev[k]) continue;
      idx[o] = i;
      prev[o] = this.prev[k];
      next[o] = px[i];
      o++;
    }
    this.n = 0;
    this.target = null;
    return { target: t, idx, prev, next };
  }
}
