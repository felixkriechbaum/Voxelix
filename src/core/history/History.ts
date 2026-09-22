/** Anything an edit batch can be replayed against. */
export interface HistoryTarget<E> {
  applyEdit(edit: E, value: number): void;
}

export interface EditBatch<E> {
  label: string;
  edits: E[];
}

/** Undo/redo stack for a single object, storing per-cell diffs. */
export class History<E extends { prev: number; next: number }> {
  private undoStack: EditBatch<E>[] = [];
  private redoStack: EditBatch<E>[] = [];
  private limit = Infinity;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(batch: EditBatch<E>): void {
    if (batch.edits.length === 0) return;
    this.undoStack.push(batch);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(target: HistoryTarget<E>): EditBatch<E> | null {
    const batch = this.undoStack.pop();
    if (!batch) return null;
    for (let i = batch.edits.length - 1; i >= 0; i--) {
      const e = batch.edits[i];
      target.applyEdit(e, e.prev);
    }
    this.redoStack.push(batch);
    return batch;
  }

  redo(target: HistoryTarget<E>): EditBatch<E> | null {
    const batch = this.redoStack.pop();
    if (!batch) return null;
    for (const e of batch.edits) target.applyEdit(e, e.next);
    this.undoStack.push(batch);
    return batch;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

/** Keeps one History per object id; histories survive object switches. */
export class HistoryStore<E extends { prev: number; next: number }> {
  private map = new Map<string, History<E>>();

  for(objectId: string): History<E> {
    let h = this.map.get(objectId);
    if (!h) {
      h = new History<E>();
      this.map.set(objectId, h);
    }
    return h;
  }

  drop(objectId: string): void {
    this.map.delete(objectId);
  }
}
