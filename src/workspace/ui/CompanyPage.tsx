import { useEffect, useState, useSyncExternalStore } from 'react';
import { isTypingTarget } from '../../canvas/Canvas';
import { Icon } from '../../ui/Icon';
import { listCompanies } from '../api';
import type { CompanyWorkspace, Engagement } from '../model/types';
import { editCompany, isCompanyNameFree, type ProfileField } from '../model/workspace';
import type { WorkspaceSession } from '../session';
import { formatDay, Page, WorkspaceHeader } from './chrome';
import { useCompanySession } from './useCompanySession';

const PROFILE: { field: ProfileField; label: string; multiline?: boolean; step: string }[] = [
  { field: 'name', label: 'Name', step: 'Rename the client' },
  { field: 'industry', label: 'Industry', step: 'Change the industry' },
  { field: 'description', label: 'What they do', multiline: true, step: 'Change what they do' },
  { field: 'existingSystems', label: 'Existing systems', multiline: true, step: 'Change the existing systems' },
  { field: 'notes', label: 'Notes', multiline: true, step: 'Change the notes' },
];

/** A client: its profile and its engagements (MVP stories 1.1 and 1.2). */
export function CompanyPage({ companyId }: { companyId: string }) {
  const [load, reload] = useCompanySession(companyId);
  if (load.state === 'open') return <OpenCompany session={load.session} onReload={reload} />;
  return (
    <>
      <WorkspaceHeader />
      <Page title={load.state === 'loading' ? 'Opening the client…' : 'This client can’t be opened'} crumbs={crumbs(null)}>
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

const crumbs = (name: string | null) => [{ label: 'Clients', href: '#/' }, { label: name ?? 'Client' }];

function useSession(session: WorkspaceSession) {
  return useSyncExternalStore(session.subscribe, session.getState);
}

function OpenCompany({ session, onReload }: { session: WorkspaceSession; onReload: () => void }) {
  const state = useSession(session);
  const { workspace, access, problems } = state;
  const readOnly = access !== 'editable';

  // Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) undo and redo the client's changes, except while typing,
  // where they belong to the text field.
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

  return (
    <>
      <WorkspaceHeader>
        <SaveControls session={session} />
      </WorkspaceHeader>
      <Page title={workspace.company.name} crumbs={crumbs(workspace.company.name)}>
        {workspace.company.industry && <p className="ws-lede">{workspace.company.industry}</p>}
        {readOnly && (
          <section className="ws-alert" aria-labelledby="read-only-title">
            <h2 id="read-only-title">This client opens read-only</h2>
            <p>
              Its file has {problems.length === 1 ? 'a problem' : `${problems.length} problems`}, so StyleCode shows what it can
              but won’t change or save it. Nothing in the file has been altered.
            </p>
            <ul>
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </section>
        )}
        {state.status === 'error' && <SaveProblem session={session} error={state.error} onReload={onReload} />}
        <div className="ws-columns">
          <section className="ws-card" aria-labelledby="profile-title">
            <h2 id="profile-title">Profile</h2>
            {PROFILE.map((p) => (
              <ProfileInput key={p.field} session={session} workspace={workspace} readOnly={readOnly} {...p} />
            ))}
          </section>
          <section className="ws-card" aria-labelledby="engagements-title">
            <h2 id="engagements-title">Engagements</h2>
            <Engagements workspace={workspace} />
          </section>
        </div>
      </Page>
    </>
  );
}

const STATUS_TEXT = { saved: 'Saved', pending: 'Saving…', saving: 'Saving…', error: 'Not saved' } as const;

/** The save status, and undo and redo for this client, in the top bar. */
function SaveControls({ session }: { session: WorkspaceSession }) {
  const state = useSession(session);
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
      <button type="button" className="button" onClick={() => void session.retry()}>
        Try again
      </button>
      <button type="button" className="button" onClick={reload}>
        Reload from disk
      </button>
    </div>
  );
}

/**
 * One profile field. What is typed is applied as one undoable step when the
 * field is left or Enter is pressed (Escape puts it back). The name must stay
 * unique among the clients.
 */
function ProfileInput({
  session,
  workspace,
  readOnly,
  field,
  label,
  multiline,
  step,
}: {
  session: WorkspaceSession;
  workspace: CompanyWorkspace;
  readOnly: boolean;
  field: ProfileField;
  label: string;
  multiline?: boolean;
  step: string;
}) {
  const value = workspace.company[field];
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  // Undo and redo change the value from outside.
  useEffect(() => setDraft(value), [value]);

  const commit = async () => {
    if (draft === value) return setError(null);
    if (field === 'name') {
      const name = draft.trim();
      if (!name) return setError('A client needs a name.');
      if (name.toLocaleLowerCase() !== value.trim().toLocaleLowerCase()) {
        try {
          const others = (await listCompanies()).flatMap((c) => (c.name && c.id !== workspace.company.id ? [c.name] : []));
          if (!isCompanyNameFree(name, others)) return setError(`There is already a client called ${name}.`);
        } catch (e) {
          return setError((e as Error).message);
        }
      }
    }
    setError(null);
    session.apply(step, (ws) => {
      const result = editCompany(ws, { [field]: draft }, new Date().toISOString());
      return result.ok ? result.value : ws;
    });
  };

  const id = `profile-${field}`;
  const common = {
    id,
    className: 'ws-input',
    value: draft,
    readOnly,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
    onBlur: () => void commit(),
  };
  return (
    <div className="ws-field">
      <label className="ws-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          {...common}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(value);
              setError(null);
            }
          }}
        />
      ) : (
        <input
          {...common}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit();
            if (e.key === 'Escape') {
              setDraft(value);
              setError(null);
            }
          }}
        />
      )}
      {error && (
        <p className="ws-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The client's engagements. Creating and opening them comes with their pages (WP6). */
function Engagements({ workspace }: { workspace: CompanyWorkspace }) {
  const engagements = Object.values(workspace.engagements).sort(
    (a, b) => Number(b.status.state === 'active') - Number(a.status.state === 'active') || a.name.localeCompare(b.name),
  );
  if (!engagements.length) return <p className="ws-muted">No engagements yet.</p>;
  const sessionsOf = (e: Engagement) => Object.values(workspace.sessions).filter((s) => s.engagementId === e.id).length;
  return (
    <ul className="ws-list is-compact" aria-label="Engagements">
      {engagements.map((e) => {
        const sessions = sessionsOf(e);
        return (
          <li key={e.id} className="ws-row is-static">
            <span className="ws-row-main">
              <span className="ws-row-title">{e.name}</span>
              {e.goal && <span className="ws-row-sub">{e.goal}</span>}
            </span>
            <span className="ws-row-meta">
              {sessions} {sessions === 1 ? 'meeting' : 'meetings'}
            </span>
            <span className={`ws-badge${e.status.state === 'active' ? ' is-active' : ''}`}>
              {e.status.state === 'active' ? 'Active' : `Ended ${formatDay(e.status.endedOn)}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
