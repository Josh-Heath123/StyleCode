import { Icon } from '../ui/Icon';
import { useRuns, type Run } from '../workspace/ui/extraction/runs';

/**
 * Top-level navigation between the consulting workspace and the design
 * editor (Phase 1 brief, decision 4). Where the workspace server isn't
 * running, there is no Clients link: one line says what it needs instead.
 */
export function AppNav({
  current,
  workspaceHref,
}: {
  current: 'workspace' | 'editor';
  /** Where "Clients" leads (the last workspace page), or null when the workspace isn't available. */
  workspaceHref: string | null;
}) {
  return (
    <nav className="app-nav" aria-label="StyleCode">
      {workspaceHref !== null && (
        <a className="app-nav-link" href={workspaceHref} aria-current={current === 'workspace' ? 'page' : undefined}>
          <Icon name="people" size={14} /> Clients
        </a>
      )}
      <a className="app-nav-link" href="#/editor" aria-current={current === 'editor' ? 'page' : undefined}>
        <Icon name="frame" size={14} /> Design editor
      </a>
      <AiRuns />
      {workspaceHref === null && (
        <span className="app-nav-note">Client work needs StyleCode running on your computer (npm start).</span>
      )}
    </nav>
  );
}

/** What the AI is reading, or has finished, so the consultant can work elsewhere meanwhile (Phase 2, WP7). */
function AiRuns() {
  const runs = useRuns();
  return (
    <>
      {runs.map((run) => (
        <a key={`${run.companyId}/${run.sessionId}`} className="app-nav-link app-nav-run" href={run.href}>
          <Icon name="sparkle" size={14} /> {runText(run)}
        </a>
      ))}
    </>
  );
}

function runText(run: Run): string {
  const title = `“${run.sessionTitle}”`;
  if (run.state === 'running')
    return run.parts > 1 ? `The AI is reading ${title}: part ${run.part} of ${run.parts}` : `The AI is reading ${title}`;
  if (run.state === 'finished' && !run.error) return `The AI has finished ${title}`;
  return run.state === 'stopped' ? `The AI stopped on ${title}` : `The AI couldn’t finish ${title}`;
}
