import type { VoxelData } from '@/core/voxel/VoxelData';
import type { VoxelEdit } from '@/core/voxel/types';

export interface EditBatch {
  label: string;
  edits: VoxelEdit[];
}

/** Undo/redo stack for a single object, storing per-voxel diffs. */
export class History {
  private undoStack: EditBatch[] = [];
  private redoStack: EditBatch[] = [];
  private limit = Infinity;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(batch: EditBatch): void {
    if (batch.edits.length === 0) return;
    this.undoStack.push(batch);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(data: VoxelData): EditBatch | null {
    const batch = this.undoStack.pop();
    if (!batch) return null;
    for (let i = batch.edits.length - 1; i >= 0; i--) {
      const e = batch.edits[i];
      data.setRaw(e.x, e.y, e.z, e.prev);
    }
    this.redoStack.push(batch);
    return batch;
  }

  redo(data: VoxelData): EditBatch | null {
    const batch = this.redoStack.pop();
    if (!batch) return null;
    for (const e of batch.edits) data.setRaw(e.x, e.y, e.z, e.next);
    this.undoStack.push(batch);
    return batch;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

/** Keeps one History per object id; histories survive object switches. */
export class HistoryStore {
  private map = new Map<string, History>();

  for(objectId: string): History {
    let h = this.map.get(objectId);
    if (!h) {
      h = new History();
      this.map.set(objectId, h);
    }
    return h;
  }

  drop(objectId: string): void {
    this.map.delete(objectId);
  }
}
