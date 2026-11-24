import type { AiConfig } from './client';

/**
 * The engagement's record as the canvas AI is given it (Workspace Phase 4,
 * decisions 14 to 17). `src/ai` never imports the workspace: the app hands it
 * plain data, already checked against each session's consent, and the hooks
 * that make a local request take its turn.
 */

/** A confirmed finding the AI may use: its statement and kind only, never its quotes, evidence or notes. */
export interface RecordFinding {
  id: string;
  statement: string;
  /** The kind as a key ("design-preference"), as the model sees it. */
  kind: string;
  /** For the order: oldest first within each group. */
  createdAt: string;
}

/** What a request may use, checked again just before it is sent. */
export interface FindingsForRequest {
  findings: RecordFinding[];
  /** Why other findings were left out, in a sentence or two; null when none was. */
  leftOut: string | null;
}

/**
 * What a local request is waiting for before it starts (decision 17), as the workspace words it: its turn behind a
 * transcription or an AI run, or a hot graphics card cooling, which the consultant can choose not to wait for.
 */
export interface AiWait {
  message: string;
  cooling: boolean;
}

/**
 * This computer's heavy slot, as a canvas request takes it: on an engagement's design (decision 17) and, since
 * Workspace Phase 5 (decision 24), in the standalone editor too.
 */
export interface LocalTurn {
  /**
   * For a model on this computer: waits for the heavy slot and lets a hot graphics card cool, saying so through
   * `onWait`. Resolves with a function that lets the slot go. Rejects if `signal` aborts. For any other AI, resolves
   * at once.
   */
  takeTurn(
    config: AiConfig,
    options: { signal: AbortSignal; onWait: (wait: AiWait | null) => void; skipCooling: () => boolean },
  ): Promise<() => void>;
}

export interface RecordSource extends LocalTurn {
  /** The findings this request may use, for the AI set up now. Called before every request. */
  findings(config: AiConfig): FindingsForRequest;
  /** Where a finding opens on the record page, for "Drew on". */
  href(findingId: string): string;
}

/** Kinds most useful to a design first (decision 15); the rest after them. */
export const KIND_ORDER = [
  'design-preference',
  'functional-requirement',
  'non-functional-requirement',
  'expectation',
  'constraint',
  'business-requirement',
] as const;

const byAge = (a: RecordFinding, b: RecordFinding) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The order findings are offered in (decision 15): those linked to the layers in scope, then the others by kind
 * (KIND_ORDER, then every other kind together), oldest first within each group. Deterministic.
 */
export function orderFindings(findings: readonly RecordFinding[], linked: ReadonlySet<string>): RecordFinding[] {
  const rank = (f: RecordFinding) => {
    if (linked.has(f.id)) return 0;
    const at = (KIND_ORDER as readonly string[]).indexOf(f.kind);
    return at < 0 ? KIND_ORDER.length + 1 : at + 1;
  };
  return [...findings].sort((a, b) => rank(a) - rank(b) || byAge(a, b));
}
