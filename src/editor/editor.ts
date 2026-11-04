import { hasNode } from '../model/document';
import { applyOps, OpError, type Op } from '../model/ops';
import type { DesignDocument, Point, Rect } from '../model/types';
import type { Camera } from './camera';
import { History, type ChangeSource, type Transaction } from './history';

export type Tool = 'move' | 'hand' | 'frame' | 'rect' | 'ellipse' | 'text';

export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** snap: an alignment guide; insert: where a layer will land in an auto-layout frame. */
  kind: 'snap' | 'insert';
}

/** What the canvas shows about a change proposed by the AI and waiting for review. */
export interface ProposalView {
  changed: readonly string[];
  created: readonly string[];
  /** Layers that would be deleted, with their outline (world space) from before. */
  removed: readonly { id: string; corners: readonly Point[] }[];
}

export interface EditorState {
  doc: DesignDocument;
  selection: readonly string[];
  hoverId: string | null;
  tool: Tool;
  camera: Camera;
  editingTextId: string | null;
  /** Marquee rectangle in world space while dragging one. */
  marquee: Rect | null;
  /** Container highlighted as the drop or draw target during a gesture. */
  dropTargetId: string | null;
  /** Smart guides and insertion lines to draw during a gesture, in world space. */
  guides: readonly Guide[];
  /** True while a drag gesture is in progress (hides hover feedback, etc.). */
  gesturing: boolean;
  /** Incremented on every history change so the UI can refresh undo/redo state. */
  historyVersion: number;
  /** Short message shown in the status area (e.g. a rejected operation). */
  notice: { id: number; text: string; tone: 'info' | 'error' } | null;
  /** An AI proposal being reviewed: `doc` shows it, the document before it is kept aside. */
  proposal: ProposalView | null;
}

interface PendingProposal {
  base: DesignDocument;
  ops: Op[];
  inverse: Op[];
  label: string;
  selectionBefore: readonly string[];
}

/**
 * Derives extra operations after a batch is applied, before it is recorded.
 * Used to keep auto-sizing text boxes in sync with their content.
 */
export type Normalizer = (doc: DesignDocument, touched: ReadonlySet<string>, base: DesignDocument) => Op[];

export interface ApplyOptions {
  label: string;
  source?: ChangeSource;
  /** Selection after the change. Defaults to the current selection. */
  selection?: readonly string[];
  coalesceKey?: string;
  /** Merge into this transaction if it is still the most recent one. */
  mergeInto?: number;
}

interface Gesture {
  base: DesignDocument;
  selectionBefore: readonly string[];
  ops: Op[];
}

type Listener = () => void;

/**
 * The editor store: the document plus all editing state, with a tiny
 * subscribe/getState API that React binds to through useSyncExternalStore.
 *
 * Every document change goes through `apply` (one-shot edits) or the gesture
 * API (continuous drags, which preview from a fixed base and record a single
 * undo step when they end).
 */
export class Editor {
  private state: EditorState;
  private readonly listeners = new Set<Listener>();
  private gesture: Gesture | null = null;
  private pending: PendingProposal | null = null;
  private noticeId = 0;
  readonly history = new History();
  normalizer: Normalizer | null = null;
  /** Size of the canvas viewport in CSS pixels, kept up to date by the canvas. */
  viewport = { width: 0, height: 0 };
  /** Text layers created by the text tool whose creation can still be merged or discarded: node id → transaction id. */
  readonly pendingText = new Map<string, number>();

  constructor(doc: DesignDocument, camera: Camera = { x: 0, y: 0, zoom: 1 }) {
    this.state = {
      doc,
      selection: [],
      hoverId: null,
      tool: 'move',
      camera,
      editingTextId: null,
      marquee: null,
      dropTargetId: null,
      guides: [],
      gesturing: false,
      historyVersion: 0,
      notice: null,
      proposal: null,
    };
  }

  getState = (): EditorState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(partial: Partial<EditorState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  // -------------------------------------------------------------------------
  // UI state
  // -------------------------------------------------------------------------

  setTool(tool: Tool): void {
    if (this.state.tool !== tool) this.set({ tool });
  }

  setCamera(camera: Camera): void {
    this.set({ camera });
  }

  setHover(hoverId: string | null): void {
    if (this.state.hoverId !== hoverId) this.set({ hoverId });
  }

  select(ids: readonly string[]): void {
    const selection = this.validSelection(this.state.doc, ids);
    if (selection !== this.state.selection) this.set({ selection });
  }

  setMarquee(marquee: Rect | null): void {
    this.set({ marquee });
  }

  setGuides(guides: readonly Guide[]): void {
    if (guides.length === 0 && this.state.guides.length === 0) return;
    this.set({ guides });
  }

  setDropTarget(dropTargetId: string | null): void {
    if (this.state.dropTargetId !== dropTargetId) this.set({ dropTargetId });
  }

  setEditingText(editingTextId: string | null): void {
    if (editingTextId && this.blockedByProposal()) return;
    if (this.state.editingTextId !== editingTextId) this.set({ editingTextId });
  }

  notify(text: string, tone: 'info' | 'error' = 'info'): void {
    this.set({ notice: { id: ++this.noticeId, text, tone } });
  }

  clearNotice(id: number): void {
    if (this.state.notice?.id === id) this.set({ notice: null });
  }

  // -------------------------------------------------------------------------
  // Document changes
  // -------------------------------------------------------------------------

  /** Applies a batch, runs the normaliser and returns the full result. Throws OpError. */
  private run(base: DesignDocument, ops: readonly Op[]) {
    let result = applyOps(base, ops);
    let all = [...ops];
    if (this.normalizer) {
      const extra = this.normalizer(result.doc, result.touched, base);
      if (extra.length) {
        all = [...all, ...extra];
        result = applyOps(base, all);
      }
    }
    return { ...result, ops: all };
  }

  /**
   * Filters a selection to layers that exist. Returns the current selection
   * array itself when nothing changed, so subscribers keyed on selection
   * identity do not re-render on every drag frame.
   */
  private validSelection(doc: DesignDocument, ids: readonly string[]): readonly string[] {
    const valid = ids.filter((id) => hasNode(doc, id) && id !== doc.rootId);
    const current = this.state.selection;
    return valid.length === current.length && valid.every((id, i) => id === current[i]) ? current : valid;
  }

  /**
   * Applies and records a change. Returns the transaction, or null if the
   * batch was empty or invalid (in which case nothing changes and a notice
   * explains why).
   */
  apply(ops: readonly Op[], options: ApplyOptions): Transaction | null {
    if (ops.length === 0) return null;
    if (this.blockedByProposal()) return null;
    if (this.gesture) this.cancelGesture();
    try {
      const result = this.run(this.state.doc, ops);
      if (result.inverse.length === 0) return null;
      const selectionBefore = this.state.selection;
      const selection = this.validSelection(result.doc, options.selection ?? this.state.selection);
      const tx = this.history.push(
        {
          label: options.label,
          source: options.source ?? 'user',
          ops: result.ops,
          inverse: result.inverse,
          selectionBefore,
          selectionAfter: selection,
          coalesceKey: options.coalesceKey,
        },
        options.mergeInto,
      );
      this.set({ doc: result.doc, selection, historyVersion: this.state.historyVersion + 1 });
      return tx;
    } catch (error) {
      if (error instanceof OpError) {
        this.notify(error.message, 'error');
        return null;
      }
      throw error;
    }
  }

  /** Starts a continuous edit. Previews are applied on top of the document as it was now. */
  beginGesture(): void {
    if (this.blockedByProposal()) return;
    if (this.gesture) this.cancelGesture();
    this.gesture = { base: this.state.doc, selectionBefore: this.state.selection, ops: [] };
    this.set({ gesturing: true });
  }

  get inGesture(): boolean {
    return this.gesture !== null;
  }

  /**
   * Resolves once no gesture is in progress and no AI proposal is under
   * review. Work that finishes in the background (an image done loading)
   * waits for this before applying, so it never cancels a drag or a scrub the
   * user is in the middle of, and lands after a proposal is accepted or rejected.
   */
  whenIdle(): Promise<void> {
    return this.when(() => !this.gesture && !this.pending);
  }

  private when(ready: () => boolean): Promise<void> {
    if (ready()) return Promise.resolve();
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(() => {
        if (!ready()) return;
        unsubscribe();
        resolve();
      });
    });
  }

  /** Replaces the gesture's pending operations and shows the result. */
  previewGesture(ops: readonly Op[], selection?: readonly string[]): void {
    const gesture = this.gesture;
    if (!gesture) return;
    try {
      const result = this.run(gesture.base, ops);
      gesture.ops = [...ops];
      this.set({
        doc: result.doc,
        selection: selection ? this.validSelection(result.doc, selection) : this.validSelection(result.doc, this.state.selection),
      });
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      // An invalid intermediate state is simply not shown.
    }
  }

  /** Ends the gesture and records it as one undo step. */
  commitGesture(label: string, selection?: readonly string[]): Transaction | null {
    const gesture = this.gesture;
    if (!gesture) {
      // The gesture was already cancelled; make sure no feedback is left behind.
      if (this.state.gesturing || this.state.marquee || this.state.dropTargetId || this.state.guides.length) {
        this.set({ gesturing: false, marquee: null, dropTargetId: null, guides: [] });
      }
      return null;
    }
    this.gesture = null;
    const finalSelection = selection ?? this.state.selection;
    if (gesture.ops.length === 0) {
      this.set({
        doc: gesture.base,
        gesturing: false,
        marquee: null,
        dropTargetId: null,
        guides: [],
        selection: this.validSelection(gesture.base, finalSelection),
      });
      return null;
    }
    try {
      const result = this.run(gesture.base, gesture.ops);
      const sel = this.validSelection(result.doc, finalSelection);
      if (result.inverse.length === 0) {
        this.set({ doc: gesture.base, gesturing: false, marquee: null, dropTargetId: null, guides: [], selection: sel });
        return null;
      }
      const tx = this.history.push({
        label,
        source: 'user',
        ops: result.ops,
        inverse: result.inverse,
        selectionBefore: gesture.selectionBefore,
        selectionAfter: sel,
      });
      this.set({
        doc: result.doc,
        selection: sel,
        gesturing: false,
        marquee: null,
        dropTargetId: null,
        guides: [],
        historyVersion: this.state.historyVersion + 1,
      });
      return tx;
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      this.set({ doc: gesture.base, gesturing: false, marquee: null, dropTargetId: null, guides: [] });
      this.notify(error.message, 'error');
      return null;
    }
  }

  cancelGesture(): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (!gesture) {
      if (this.state.gesturing || this.state.marquee || this.state.dropTargetId || this.state.guides.length) {
        this.set({ gesturing: false, marquee: null, dropTargetId: null, guides: [] });
      }
      return;
    }
    this.set({
      doc: gesture.base,
      selection: this.validSelection(gesture.base, gesture.selectionBefore),
      gesturing: false,
      marquee: null,
      dropTargetId: null,
      guides: [],
    });
  }

  /** Discards the most recent transaction entirely, if it has the given id. */
  discardTransaction(id: number): boolean {
    const tx = this.history.peekUndo();
    if (!tx || tx.id !== id) return false;
    const result = applyOps(this.state.doc, tx.inverse);
    this.history.dropLast(id);
    this.set({
      doc: result.doc,
      selection: this.validSelection(result.doc, tx.selectionBefore),
      historyVersion: this.state.historyVersion + 1,
    });
    return true;
  }

  undo(): void {
    if (this.gesture) this.cancelGesture();
    if (this.pending) return this.discardProposal();
    const tx = this.history.popUndo();
    if (!tx) return;
    const result = applyOps(this.state.doc, tx.inverse);
    this.set({
      doc: result.doc,
      selection: this.validSelection(result.doc, tx.selectionBefore),
      editingTextId: null,
      historyVersion: this.state.historyVersion + 1,
    });
  }

  redo(): void {
    if (this.gesture) this.cancelGesture();
    if (this.blockedByProposal()) return;
    const tx = this.history.popRedo();
    if (!tx) return;
    const result = applyOps(this.state.doc, tx.ops);
    this.set({
      doc: result.doc,
      selection: this.validSelection(result.doc, tx.selectionAfter),
      editingTextId: null,
      historyVersion: this.state.historyVersion + 1,
    });
  }

  /**
   * Swaps in a different document (opening a project). Clears history and
   * editing state, and re-fits auto-sizing text and auto-layout, since fonts
   * can measure slightly differently on another machine.
   */
  loadDocument(doc: DesignDocument, camera?: Camera): void {
    this.gesture = null;
    this.pending = null;
    this.history.clear();
    this.pendingText.clear();
    let loaded = doc;
    if (this.normalizer) {
      const everything = new Set(Object.keys(doc.nodes));
      try {
        const extra = this.normalizer(doc, everything, doc);
        if (extra.length) loaded = applyOps(doc, extra).doc;
      } catch (error) {
        if (!(error instanceof OpError)) throw error;
      }
    }
    this.set({
      doc: loaded,
      selection: [],
      hoverId: null,
      editingTextId: null,
      marquee: null,
      dropTargetId: null,
      guides: [],
      gesturing: false,
      proposal: null,
      camera: camera ?? this.state.camera,
      historyVersion: this.state.historyVersion + 1,
    });
  }

  /** Renames the document. Not an undoable design change. */
  renameDocument(name: string): void {
    const trimmed = name.trim().slice(0, 200);
    if (!trimmed || trimmed === this.state.doc.name) return;
    if (this.pending) this.pending.base = { ...this.pending.base, name: trimmed };
    this.set({ doc: { ...this.state.doc, name: trimmed } });
  }

  // -------------------------------------------------------------------------
  // AI proposals
  // -------------------------------------------------------------------------

  /**
   * While an AI proposal is under review the design is read-only: selecting,
   * panning and zooming still work, but an edit would be made on top of
   * changes that aren't recorded yet. Undo rejects the proposal.
   */
  private blockedByProposal(): boolean {
    if (!this.pending) return false;
    this.notify('Accept or reject the AI’s changes first: Enter accepts, Esc rejects.');
    return true;
  }

  /**
   * Shows proposed changes on the canvas without recording them. Accepting
   * records them as one undo step from the AI; rejecting (or any other edit)
   * puts the design back as it was. Returns false if the changes are invalid.
   */
  propose(ops: readonly Op[], label: string, view: ProposalView): boolean {
    if (this.gesture) this.cancelGesture();
    if (this.pending) this.discardProposal();
    try {
      const base = this.state.doc;
      const result = this.run(base, ops);
      this.pending = { base, ops: result.ops, inverse: result.inverse, label, selectionBefore: this.state.selection };
      this.set({
        doc: result.doc,
        proposal: view,
        editingTextId: null,
        selection: this.validSelection(result.doc, this.state.selection),
      });
      return true;
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      this.notify(error.message, 'error');
      return false;
    }
  }

  get hasProposal(): boolean {
    return this.pending !== null;
  }

  /** Records the proposal as one undo step, marked as coming from the AI. */
  acceptProposal(selection?: readonly string[]): Transaction | null {
    const pending = this.pending;
    if (!pending) return null;
    this.pending = null;
    const selectionAfter = this.validSelection(this.state.doc, selection ?? this.state.selection);
    if (pending.inverse.length === 0) {
      this.set({ proposal: null, selection: selectionAfter });
      return null;
    }
    const tx = this.history.push({
      label: pending.label,
      source: 'ai',
      ops: pending.ops,
      inverse: pending.inverse,
      selectionBefore: pending.selectionBefore,
      selectionAfter,
    });
    this.set({ proposal: null, selection: selectionAfter, historyVersion: this.state.historyVersion + 1 });
    return tx;
  }

  /** Puts the design back as it was before the proposal. */
  discardProposal(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    // Keep what is selected now; if the proposal removed it all, go back to what was selected before.
    const current = this.validSelection(pending.base, this.state.selection);
    const selection = current.length ? current : this.validSelection(pending.base, pending.selectionBefore);
    this.set({ doc: pending.base, proposal: null, selection });
  }

  /** The design as recorded: without a proposal under review or a drag in progress. */
  get committedDoc(): DesignDocument {
    return this.pending?.base ?? this.gesture?.base ?? this.state.doc;
  }
}
