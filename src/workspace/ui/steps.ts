import type { CompanyWorkspace } from '../model/types';
import type { Result } from '../model/util';
import type { WorkspaceSession } from '../session';

/** Now, as stored. */
export const now = () => new Date().toISOString();

/**
 * Applies a model function as one undoable step. Returns null when it was
 * applied (or changed nothing), or why it wasn't: the model refused it, the
 * client is read-only, or its session has closed. Never null for a change
 * that didn't happen, so a form never closes as if it had saved.
 */
export function step(
  session: WorkspaceSession,
  label: string,
  change: (ws: CompanyWorkspace) => Result<CompanyWorkspace>,
  options: { permanent?: boolean; final?: boolean } = {},
): string | null {
  if (session.readOnly) return 'This client is read-only, so nothing can be changed.';
  if (session.closed) return 'This client was closed. Reload the page to open it again.';
  const result = change(session.getState().workspace);
  if (!result.ok) return result.error;
  session.apply(label, () => result.value, options);
  return null;
}

/** Shown when a change wasn't applied because the client is read-only or its session closed. */
export const NOT_APPLIED = 'This change couldn’t be made: the client is read-only, or was closed. Reload the page.';

/**
 * A permanent step (a deletion): applied, then saved straight away. If the
 * save fails, the step is rolled back, since nothing changed on disk, and the
 * reason is thrown for the dialog to show, so a deletion never looks done
 * before it is.
 */
export async function permanentStep(
  session: WorkspaceSession,
  label: string,
  change: (ws: CompanyWorkspace) => Result<CompanyWorkspace>,
): Promise<void> {
  const before = session.getState().workspace;
  const problem = step(session, label, change, { permanent: true });
  if (problem) throw new Error(problem);
  await session.saveNow();
  const state = session.getState();
  if (state.status !== 'error') return;
  const reason = state.error ?? 'the change couldn’t be saved.';
  session.rollBack(before);
  throw new Error(`Not saved: ${reason}`);
}

/**
 * A final step (one that clears the undo history, such as a consent
 * amendment, a withdrawal or attaching a file): applied, then saved straight
 * away, rolled back if the save fails, as `permanentStep` does. Returns null
 * once saved, or why it wasn't, so a form never says it is done before it is.
 */
export async function finalStep(
  session: WorkspaceSession,
  label: string,
  change: (ws: CompanyWorkspace) => Result<CompanyWorkspace>,
): Promise<string | null> {
  const before = session.getState().workspace;
  const problem = step(session, label, change, { final: true });
  if (problem) return problem;
  await session.saveNow();
  const state = session.getState();
  if (state.status !== 'error') return null;
  session.rollBack(before);
  return `Not saved: ${state.error ?? 'the change couldn’t be saved.'}`;
}
