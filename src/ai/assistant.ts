import { screenToWorld } from '../editor/camera';
import type { Editor } from '../editor/editor';
import { worldCorners } from '../model/geometry';
import { containerAtPoint } from '../model/hit';
import type { DesignDocument } from '../model/types';
import { AiUnavailableError, chat, getAiConfig, type AiConfig } from './client';
import { buildContext, resolveTarget, type AiContext, type AiTarget } from './context';
import { repairMessage, systemPrompt, userMessage } from './prompt';
import { interpret, streamedExplanation, type Proposal } from './proposal';
import { responseSchema } from './schema';

/**
 * The assistant: turns a request into a proposal on the canvas.
 *
 *   request → context (the selection and its screen) → provider (via the
 *   local server) → streamed reply → validation and policy → one repair
 *   attempt if needed → proposal shown on the canvas → accept (one undo step
 *   from the AI) or reject (nothing changed)
 */

export type AssistantStatus = 'idle' | 'thinking' | 'review' | 'error';

export interface AssistantState {
  status: AssistantStatus;
  /** AI settings, or null while loading or when the local server isn't there. */
  config: AiConfig | null;
  /** Why AI can't be used here (no local server), if so. */
  unavailable: string | null;
  request: string;
  /** What the AI says it is doing, streamed while it writes. */
  explanation: string;
  /** 'repairing' while a reply with problems is being fixed; 'waiting' for the user to finish an edit. */
  phase: 'writing' | 'repairing' | 'waiting' | null;
  summary: string;
  /** The proposal deletes a lot: accepting needs a second look. */
  needsConfirmation: boolean;
  removedCount: number;
  /** The reply proposed nothing (the explanation says why). */
  noChanges: boolean;
  error: string | null;
  /** Problems the AI's reply still had after its repair attempt. */
  problems: string[];
  targetLabel: string;
}

const IDLE: Omit<AssistantState, 'config' | 'unavailable'> = {
  status: 'idle',
  request: '',
  explanation: '',
  phase: null,
  summary: '',
  needsConfirmation: false,
  removedCount: 0,
  noChanges: false,
  error: null,
  problems: [],
  targetLabel: '',
};

/**
 * Whether the user is typing in a field outside the assistant (a property, a
 * layer name, the CSS editor). Its value is applied when they leave it, so a
 * proposal waits for that rather than make the edit wait.
 */
function typingInField(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el || el.closest('.assistant')) return false;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes((el as HTMLInputElement).type);
}

/** How much of the design to describe, in characters, given the model's context window. */
function contextBudget(config: AiConfig): number {
  if (config.provider === 'ollama') {
    const tokens = config.providers.ollama.contextSize ?? 8192;
    // About 2,500 tokens of instructions and up to 3,000 for the reply; ~3.5 characters per token.
    return Math.max(3000, Math.round((tokens - 5500) * 3.5));
  }
  return 60_000;
}

export class Assistant {
  private state: AssistantState = { ...IDLE, config: null, unavailable: null };
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  /** Set while the assistant itself accepts or rejects, to tell that apart from the design changing. */
  private settling = false;

  constructor(private readonly editor: Editor) {
    let docId = editor.getState().doc.id;
    editor.subscribe(() => {
      // Another project was opened: whatever was in progress belonged to the old one.
      const id = editor.getState().doc.id;
      if (id !== docId) {
        docId = id;
        this.controller?.abort();
        this.controller = null;
        if (this.state.status !== 'idle') this.set({ ...IDLE });
        return;
      }
      // Undo while reviewing rejects the proposal.
      if (this.state.status === 'review' && !this.state.noChanges && !editor.hasProposal && !this.settling) {
        this.set({ ...IDLE, request: this.state.request });
        editor.notify('AI changes rejected.');
      }
    });
  }

  getState = (): AssistantState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<AssistantState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  get ready(): boolean {
    const config = this.state.config;
    return !!config && config.provider !== 'off' && !!config.providers[config.provider].model;
  }

  /** Loads the AI settings from the local server. */
  async refresh(): Promise<void> {
    try {
      this.set({ config: await getAiConfig(), unavailable: null });
    } catch (error) {
      this.set({ config: null, unavailable: (error as Error).message });
    }
  }

  setConfig(config: AiConfig): void {
    this.set({ config, unavailable: null });
  }

  /** The screen in the middle of the view, for requests made with nothing selected. */
  private screenInView(doc: DesignDocument): string | null {
    const { camera } = this.editor.getState();
    const center = screenToWorld(camera, { x: this.editor.viewport.width / 2, y: this.editor.viewport.height / 2 });
    let id = containerAtPoint(doc, center);
    while (id !== doc.rootId && doc.nodes[id].parentId !== doc.rootId) id = doc.nodes[id].parentId!;
    if (id !== doc.rootId) return id;
    return doc.nodes[doc.rootId].children.find((c) => doc.nodes[c].type === 'frame') ?? null;
  }

  /** What a request would change right now, or why there is nothing to work on. */
  target(): AiTarget | { error: string } {
    const doc = this.editor.committedDoc;
    return resolveTarget(doc, this.editor.getState().selection, this.screenInView(doc));
  }

  /** Builds the context for the current selection, or explains why there is nothing to work on. */
  context(): AiContext | { error: string } {
    const doc = this.editor.committedDoc;
    const config = this.state.config;
    return buildContext(doc, this.editor.getState().selection, {
      maxChars: config ? contextBudget(config) : undefined,
      fallbackScreen: this.screenInView(doc),
    });
  }

  async ask(request: string): Promise<void> {
    const text = request.trim();
    if (!text || this.state.status === 'thinking') return;
    if (!this.ready) {
      this.set({ ...IDLE, status: 'error', error: 'Choose an AI provider and model in AI settings first.' });
      return;
    }
    if (this.editor.hasProposal) this.reject();
    const context = this.context();
    if ('error' in context) {
      this.set({ ...IDLE, status: 'error', request: text, error: context.error });
      return;
    }

    const controller = new AbortController();
    this.controller = controller;
    this.set({ ...IDLE, status: 'thinking', phase: 'writing', request: text, targetLabel: context.targetLabel });

    const system = systemPrompt();
    const schema = responseSchema();
    const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: userMessage(context, text) }];
    const onText = (soFar: string) => {
      const explanation = streamedExplanation(soFar);
      if (explanation !== null && explanation !== this.state.explanation) this.set({ explanation });
    };

    try {
      let reply = await chat({ system, messages, schema }, onText, controller.signal);
      if (controller.signal.aborted) return;
      let result = interpret(reply, this.editor.committedDoc, context);
      if (!result.ok) {
        // One repair attempt: show the model what was wrong, in its own terms.
        this.set({ phase: 'repairing', explanation: '' });
        messages.push({ role: 'assistant', content: reply }, { role: 'user', content: repairMessage(result.errors) });
        reply = await chat({ system, messages, schema }, onText, controller.signal);
        if (controller.signal.aborted) return;
        result = interpret(reply, this.editor.committedDoc, context);
      }
      if (result.ok) {
        // Never interrupt an edit: a drag, a scrub or text being typed finishes first.
        const before = this.editor.committedDoc;
        if (!this.editorIdle()) {
          this.set({ phase: 'waiting' });
          await this.whenEditorIdle(controller.signal);
          if (controller.signal.aborted) return;
        }
        // The design changed meanwhile: check the reply again against the design as it is now.
        if (this.editor.committedDoc !== before) result = interpret(reply, this.editor.committedDoc, context);
      }
      if (!result.ok) {
        this.set({
          status: 'error',
          phase: null,
          explanation: result.explanation ?? '',
          error: 'The AI’s changes didn’t fit the design, so nothing was changed. Try rephrasing, or a more capable model.',
          problems: result.errors,
        });
        return;
      }
      this.show(result.proposal, text);
    } catch (error) {
      if ((error as Error).name === 'AbortError' || controller.signal.aborted) return;
      this.set({
        status: 'error',
        phase: null,
        error: (error as Error).message,
        ...(error instanceof AiUnavailableError ? { unavailable: (error as Error).message } : {}),
      });
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  /** Nothing is being edited: no drag or scrub, no text being typed on the canvas or in a field. */
  private editorIdle(): boolean {
    return !this.editor.inGesture && !this.editor.getState().editingTextId && !typingInField();
  }

  /** Resolves once the editor is idle (or the request is stopped). */
  private whenEditorIdle(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (!signal.aborted && !this.editorIdle()) return;
        unsubscribe();
        if (typeof document !== 'undefined') document.removeEventListener('focusout', later);
        signal.removeEventListener('abort', check);
        resolve();
      };
      // Leaving a field commits its value first (on blur), then focus settles.
      const later = () => setTimeout(check, 0);
      const unsubscribe = this.editor.subscribe(check);
      if (typeof document !== 'undefined') document.addEventListener('focusout', later);
      signal.addEventListener('abort', check);
    });
  }

  private show(proposal: Proposal, request: string): void {
    const base = this.editor.committedDoc;
    const noChanges = proposal.ops.length === 0;
    if (!noChanges) {
      const removed = proposal.removed.filter((id) => base.nodes[id]).map((id) => ({ id, corners: worldCorners(base, id) }));
      const label = `AI: ${request.length > 48 ? `${request.slice(0, 47)}…` : request}`;
      const ok = this.editor.propose(proposal.ops, label, { changed: proposal.changed, created: proposal.created, removed });
      if (!ok) {
        this.set({ status: 'error', phase: null, error: 'The AI’s changes couldn’t be applied to the design.' });
        return;
      }
    }
    this.set({
      status: 'review',
      phase: null,
      explanation: proposal.explanation || (noChanges ? 'The AI didn’t propose any changes.' : ''),
      summary: proposal.summary,
      needsConfirmation: proposal.needsConfirmation,
      removedCount: proposal.removedCount,
      noChanges,
    });
  }

  /** Stops a request in progress. Nothing changes. */
  stop(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.state.status === 'thinking') this.set({ ...IDLE, request: this.state.request });
  }

  accept(): void {
    if (this.state.status !== 'review') return;
    this.settling = true;
    try {
      const tx = this.editor.acceptProposal();
      if (tx) this.editor.notify('AI changes applied. Undo with Ctrl+Z.');
    } finally {
      this.settling = false;
    }
    this.set({ ...IDLE });
  }

  reject(): void {
    this.settling = true;
    try {
      this.editor.discardProposal();
    } finally {
      this.settling = false;
    }
    this.set({ ...IDLE, request: this.state.request });
  }

  dismiss(): void {
    if (this.state.status === 'review') return this.reject();
    this.set({ ...IDLE, request: this.state.request });
  }
}
