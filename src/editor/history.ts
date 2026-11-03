import type { Op } from '../model/ops';

export type ChangeSource = 'user' | 'ai' | 'system';

/**
 * One undoable step. Manual edits and (later) AI edits are both transactions,
 * which is what makes AI changes undoable exactly like manual ones.
 */
export interface Transaction {
  id: number;
  label: string;
  source: ChangeSource;
  ops: Op[];
  inverse: Op[];
  selectionBefore: readonly string[];
  selectionAfter: readonly string[];
  time: number;
  coalesceKey?: string;
}

const COALESCE_WINDOW_MS = 1000;

export class History {
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private nextId = 1;

  constructor(private readonly limit = 300) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get last(): Transaction | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  peekUndo(): Transaction | undefined {
    return this.last;
  }

  peekRedo(): Transaction | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  /**
   * Records a transaction. Rapid repeats of the same small edit (arrow-key
   * nudges, for instance) are merged into one step when they share a
   * `coalesceKey`, so undo does not have to be pressed twenty times.
   */
  push(tx: Omit<Transaction, 'id' | 'time'>, mergeIntoId?: number): Transaction {
    const now = Date.now();
    const last = this.last;
    const merge =
      last &&
      ((mergeIntoId !== undefined && last.id === mergeIntoId) ||
        (tx.coalesceKey &&
          last.coalesceKey === tx.coalesceKey &&
          now - last.time < COALESCE_WINDOW_MS &&
          this.redoStack.length === 0));

    this.redoStack = [];
    if (merge && last) {
      last.ops = [...last.ops, ...tx.ops];
      last.inverse = [...tx.inverse, ...last.inverse];
      last.selectionAfter = tx.selectionAfter;
      last.time = now;
      return last;
    }

    const entry: Transaction = { ...tx, id: this.nextId++, time: now };
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    return entry;
  }

  /** Removes the last transaction if it has the given id (used to discard an abandoned text layer). */
  dropLast(id: number): Transaction | undefined {
    if (this.last?.id !== id) return undefined;
    return this.undoStack.pop();
  }

  popUndo(): Transaction | undefined {
    const tx = this.undoStack.pop();
    if (tx) this.redoStack.push(tx);
    return tx;
  }

  popRedo(): Transaction | undefined {
    const tx = this.redoStack.pop();
    if (tx) this.undoStack.push(tx);
    return tx;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
