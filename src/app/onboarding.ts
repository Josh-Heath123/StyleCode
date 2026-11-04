import type { Editor } from '../editor/editor';

/**
 * First-run guidance: a welcome screen, then a short checklist of things to
 * try that ticks itself off as you do them. Progress is a convenience kept in
 * this browser (localStorage); without it, onboarding simply starts over.
 */

export const STEPS = [
  { id: 'draw', title: 'Draw a frame', hint: 'Press F, then drag on the canvas. Each top-level frame becomes a page.' },
  { id: 'layout', title: 'Tidy it into rows and columns', hint: 'Select a frame with layers in it and press Shift+A.' },
  { id: 'code', title: 'Look at the code', hint: 'Open the Code tab on the right, then click a line to find its layer.' },
  { id: 'preview', title: 'Preview at phone width', hint: 'Press Preview in the top bar and pick Mobile.' },
  { id: 'note', title: 'Leave a note for the AI', hint: 'Press N and click a layer. Notes stay out of the code.' },
  { id: 'ai', title: 'Ask the AI for a change', hint: 'Select something and press /. Works with a free local model.' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

interface OnboardingState {
  /** The welcome screen has been seen. */
  welcomed: boolean;
  checklistOpen: boolean;
  done: Partial<Record<StepId, boolean>>;
}

const KEY = 'stylecode.onboarding';
const DEFAULT: OnboardingState = { welcomed: false, checklistOpen: false, done: {} };

function load(): OnboardingState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      welcomed: parsed.welcomed === true,
      checklistOpen: parsed.checklistOpen === true,
      done: parsed.done && typeof parsed.done === 'object' ? parsed.done : {},
    };
  } catch {
    return DEFAULT;
  }
}

/** History labels that complete a step. */
const LABEL_STEPS: Record<string, StepId> = {
  'Add frame': 'draw',
  'Add auto layout': 'layout',
  'Grid layout': 'layout',
  'Add note': 'note',
};

export class Onboarding {
  private state: OnboardingState = load();
  private readonly listeners = new Set<() => void>();

  getState = (): OnboardingState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<OnboardingState>): void {
    this.state = { ...this.state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // Storage may be unavailable (private mode): onboarding still works for this visit.
    }
    for (const listener of this.listeners) listener();
  }

  /** Watches the editor for the steps that are edits. */
  watch(editor: Editor): () => void {
    let version = editor.getState().historyVersion;
    return editor.subscribe(() => {
      const next = editor.getState().historyVersion;
      if (next === version) return;
      version = next;
      const label = editor.history.peekUndo()?.label;
      if (label && LABEL_STEPS[label]) this.complete(LABEL_STEPS[label]);
    });
  }

  complete(step: StepId): void {
    if (this.state.done[step]) return;
    this.set({ done: { ...this.state.done, [step]: true } });
  }

  finishWelcome(openChecklist: boolean): void {
    this.set({ welcomed: true, checklistOpen: openChecklist });
  }

  showWelcome(): void {
    this.set({ welcomed: false });
  }

  setChecklistOpen(open: boolean): void {
    this.set({ checklistOpen: open });
  }

  /** Starts the checklist again from the beginning. */
  restart(): void {
    this.set({ done: {}, checklistOpen: true });
  }
}
