/**
 * Editor history (UX1-T8): undo/redo over immutable document snapshots with
 * transaction coalescing — one entry per gesture (drag = one step, scrub =
 * one step). Bounded stack; snapshots are cheap at schematic scale.
 */
import type { SchematicDoc } from "../schematic/types.ts";

const LIMIT = 200;

export class History {
  private undoStack: SchematicDoc[] = [];
  private redoStack: SchematicDoc[] = [];
  /** Keys allowed to coalesce with the top entry (continuous gestures). */
  private coalesceKey: string | null = null;

  constructor(initial: SchematicDoc) {
    this.undoStack = [initial];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 1;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Commit a new document state. `coalesce` merges with the previous entry
   * while the gesture key matches (e.g. "drag:i5", "scrub:R1.value").
   */
  commit(doc: SchematicDoc, coalesce?: string): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top === undefined || doc === top) return;
    const merge = coalesce !== undefined && coalesce === this.coalesceKey;
    this.coalesceKey = coalesce ?? null;
    if (!merge) {
      if (this.undoStack.length >= LIMIT) this.undoStack.shift();
      this.undoStack.push(doc);
      this.redoStack = [];
      return;
    }
    this.undoStack[this.undoStack.length - 1] = doc;
  }

  /** End a coalescing gesture — the next commit starts a fresh entry. */
  breakGesture(): void {
    this.coalesceKey = null;
  }

  undo(current: SchematicDoc): SchematicDoc {
    this.coalesceKey = null;
    if (!this.canUndo) return current;
    // The stack top IS the current state; pop it to redo and return the one
    // beneath.
    const cur = this.undoStack.pop();
    if (cur !== undefined) this.redoStack.push(cur);
    void current;
    return this.undoStack[this.undoStack.length - 1] ?? current;
  }

  redo(current: SchematicDoc): SchematicDoc {
    this.coalesceKey = null;
    const next = this.redoStack.pop();
    if (next === undefined) return current;
    this.undoStack.push(next);
    return next;
  }
}
