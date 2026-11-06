import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { isTypingTarget } from '../../canvas/Canvas';
import { Icon } from '../../ui/Icon';
import type { CompanyWorkspace } from '../model/types';
import type { Problem } from '../model/validate';
import type { WorkspaceSession, WorkspaceSessionState } from '../session';
import { clientFolder, Id, Page, useWorkspaceInfo, WorkspaceHeader } from './chrome';
import { useCompanySession } from './useCompanySession';

export interface ClientView {
  session: WorkspaceSession;
  state: WorkspaceSessionState;
  workspace: CompanyWorkspace;
  readOnly: boolean;
  /** Banners for under the page's title: read-only, a failed save. */
  notices: ReactNode;
}

/**
 * Everything a client's pages share: opening the client, the save status
 * with undo and redo in the top bar (and Ctrl+Z, Ctrl+Shift+Z), and the
 * banners for a read-only client or a save that failed.
 */
export function ClientFrame({ companyId, children }: { companyId: string; children: (view: ClientView) => ReactNode }) {
  const [load, reload] = useCompanySession(companyId);
  if (load.state === 'open') return <OpenClient session={load.session} onReload={reload} render={children} />;
  return (
    <>
      <WorkspaceHeader />
      <Page
        title={load.state === 'loading' ? 'Opening the client…' : 'This client can’t be opened'}
        crumbs={[{ label: 'Clients', href: '#/' }, { label: 'Client' }]}
      >
        {load.state === 'failed' && (
          <div className="ws-alert" role="alert">
            <p>{load.status === 404 ? 'There is no client here. It may have been deleted.' : load.error}</p>
            <a className="button" href="#/">
              Back to clients
            </a>
            {load.status !== 404 && (
              <button type="button" className="button" onClick={reload}>
                Try again
              </button>
            )}
          </div>
        )}
      </Page>
    </>
  );
}

function OpenClient({
  session,
  onReload,
  render,
}: {
  session: WorkspaceSession;
  onReload: () => void;
  render: (view: ClientView) => ReactNode;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const readOnly = state.access !== 'editable';

  // Undo and redo the client's changes, except while typing, where they belong to the text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTypingTarget(e.target)) return;
      if ((e.target as Element | null)?.closest?.('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) session.undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') session.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  const notices = (
    <>
      {readOnly && <ReadOnlyBanner folderId={session.companyId} workspace={state.workspace} problems={state.problems} />}
      {state.status === 'error' && <SaveProblem session={session} error={state.error} onReload={onReload} />}
    </>
  );
  return (
    <>
      <WorkspaceHeader>
        <SaveControls state={state} session={session} />
      </WorkspaceHeader>
      {render({ session, state, workspace: state.workspace, readOnly, notices })}
    </>
  );
}

const STATUS_TEXT = { saved: 'Saved', pending: 'Saving…', saving: 'Saving…', error: 'Not saved' } as const;

/** The save status, and undo and redo for this client, in the top bar. */
function SaveControls({ state, session }: { state: WorkspaceSessionState; session: WorkspaceSession }) {
  if (state.access !== 'editable') return <span className="save-status ws-readonly-status">Read-only</span>;
  return (
    <>
      <span className="save-status" role="status">
        <span className="save-status-text" data-status={state.status}>
          {STATUS_TEXT[state.status]}
        </span>
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={state.undoLabel ? `Undo ${state.undoLabel}` : 'Nothing to undo'}
        data-tip={state.undoLabel ? `Undo: ${state.undoLabel.toLowerCase()}  Ctrl+Z` : 'Nothing to undo'}
        disabled={!state.undoLabel}
        onClick={() => session.undo()}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={state.redoLabel ? `Redo ${state.redoLabel}` : 'Nothing to redo'}
        data-tip={state.redoLabel ? `Redo: ${state.redoLabel.toLowerCase()}  Ctrl+Shift+Z` : 'Nothing to redo'}
        data-tip-side="left"
        disabled={!state.redoLabel}
        onClick={() => session.redo()}
      >
        <Icon name="redo" />
      </button>
      <span className="topbar-divider" />
    </>
  );
}

/** A save that failed: why, and the ways forward. */
function SaveProblem({ session, error, onReload }: { session: WorkspaceSession; error: string | null; onReload: () => void }) {
  const reload = () => {
    if (window.confirm('Reload this client from disk? The changes made here that weren’t saved will be lost.')) onReload();
  };
  return (
    <div className="ws-alert" role="alert">
      <p>
        <strong>Your latest changes aren’t saved.</strong> {error}
      </p>
      {session.getState().retryable && (
        <button type="button" className="button" onClick={() => void session.retry()}>
          Try again
        </button>
      )}
      <button type="button" className="button" onClick={reload}>
        Reload from disk
      </button>
    </div>
  );
}

/**
 * A client whose file has problems: what each one is, and what to do about
 * it. StyleCode never repairs the file itself (DOMAIN-MODEL.md), so the way
 * out is always something the consultant does to the folder.
 */
function ReadOnlyBanner({
  folderId,
  workspace,
  problems,
}: {
  folderId: string;
  workspace: CompanyWorkspace;
  problems: Problem[];
}) {
  const info = useWorkspaceInfo();
  const folder = clientFolder(info, folderId);
  return (
    <section className="ws-alert is-caution" aria-labelledby="read-only-title">
      <h2 id="read-only-title">This client opens read-only</h2>
      <p>
        Its file has {problems.length === 1 ? 'a problem' : `${problems.length} problems`}, so StyleCode shows what it can but
        won’t change or save it. Nothing in the file has been altered. Its folder is <Id>{folder}</Id>.
      </p>
      <ul className="ws-problems">
        {problems.map((p, i) => (
          <li key={i}>{problemAndFix(p, folderId, workspace.company.id)}</li>
        ))}
      </ul>
    </section>
  );
}

function problemAndFix(p: Problem, folderId: string, fileId: unknown): ReactNode {
  if (p.code === 'company.folder') {
    const owner = String(fileId);
    return (
      <>
        <p>
          The folder is named <Id>{folderId}</Id>, but the file inside it belongs to the client <Id>{owner}</Id>.
        </p>
        <p className="ws-fix">
          <strong>What to do:</strong> if you renamed the folder, rename it back to <Id>{owner}</Id>. If it is a copy of that
          client’s folder, remove the copy: <strong>Delete client…</strong> on this page removes this folder, <Id>{folderId}</Id>,
          and leaves the original alone.
        </p>
      </>
    );
  }
  return (
    <>
      <p>
        {p.message}
        {p.where.id && (
          <>
            {' '}
            (<Id>{p.where.id}</Id>)
          </>
        )}
      </p>
      <p className="ws-fix">
        <strong>What to do:</strong> restore the client’s folder from a backup, or go back to the version before the last save:
        keep a copy of <Id>workspace.json</Id>, then rename <Id>workspace.previous.json</Id> to <Id>workspace.json</Id>.
      </p>
    </>
  );
}

/** A link to something that isn't there (deleted, or never was), with the way back. */
export function Missing({ view, what, back }: { view: ClientView; what: string; back?: { href: string; label: string } }) {
  const company = view.workspace.company;
  // Links use the folder the page was opened from: for a copied folder, the id in its file is the original's.
  const folder = view.session.companyId;
  const to = back ?? { href: `#/c/${folder}`, label: `Back to ${company.name}` };
  return (
    <Page
      title={`There is no ${what} here`}
      crumbs={[
        { label: 'Clients', href: '#/' },
        { label: company.name, href: `#/c/${folder}` },
      ]}
    >
      <div className="ws-alert" role="alert">
        <p>It may have been deleted.</p>
        <a className="button" href={to.href}>
          {to.label}
        </a>
      </div>
    </Page>
  );
}
