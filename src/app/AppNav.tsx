import { Icon } from '../ui/Icon';

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
      {workspaceHref === null && (
        <span className="app-nav-note">Client work needs StyleCode running on your computer (npm start).</span>
      )}
    </nav>
  );
}
