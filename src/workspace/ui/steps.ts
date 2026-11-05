import type { CompanyWorkspace } from '../model/types';
import type { Result } from '../model/util';
import type { WorkspaceSession } from '../session';

/** Now, as stored. */
export const now = () => new Date().toISOString();

/**
 * Applies a model function as one undoable step. Returns null when it was
 * applied (or changed nothing), or the reason the model refused it, for the
 * form to show.
 */
export function step(
  session: WorkspaceSession,
  label: string,
  change: (ws: CompanyWorkspace) => Result<CompanyWorkspace>,
  options: { permanent?: boolean } = {},
): string | null {
  const result = change(session.getState().workspace);
  if (!result.ok) return result.error;
  session.apply(label, () => result.value, options);
  return null;
}
