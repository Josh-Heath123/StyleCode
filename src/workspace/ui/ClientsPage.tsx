import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../ui/Icon';
import { useDialogFocus } from '../../ui/useDialogFocus';
import { createCompany, listCompanies, type CompanySummary } from '../api';
import { isCompanyNameFree } from '../model/workspace';
import { formatWhen, Page, WorkspaceHeader } from './chrome';

/** The front door: every client, by name, and a way to add one (MVP story 1.1). */
export function ClientsPage() {
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setError(null);
    listCompanies()
      .then(setCompanies)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const count = companies?.length ?? 0;
  return (
    <>
      <WorkspaceHeader />
      <Page title="Clients" crumbs={[{ label: 'Clients' }]}>
        <div className="ws-toolbar">
          <p className="ws-lede">
            {companies === null
              ? ' '
              : count === 0
                ? 'Each client keeps its own projects, meetings, consent records and notes, in its own folder on this computer.'
                : `${count} ${count === 1 ? 'client' : 'clients'}, each kept in its own folder on this computer.`}
          </p>
          {count > 0 && (
            <button type="button" className="button primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} /> New client
            </button>
          )}
        </div>

        {error && (
          <div className="ws-alert" role="alert">
            <p>The clients couldn’t be listed. {error}</p>
            <button type="button" className="button" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {companies === null && !error && <p className="ws-muted">Loading clients…</p>}
        {companies?.length === 0 && (
          <div className="ws-empty">
            <h2>No clients yet</h2>
            <p>Add your first client to start keeping their meetings, consent and notes in one place.</p>
            <button type="button" className="button primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} /> New client
            </button>
          </div>
        )}
        {companies && companies.length > 0 && (
          <ul className="ws-list" aria-label="Clients">
            {companies.map((c) => (
              <li key={c.id}>
                <ClientRow company={c} />
              </li>
            ))}
          </ul>
        )}
      </Page>
      {adding && (
        <NewClientDialog existing={(companies ?? []).flatMap((c) => (c.name ? [c.name] : []))} onClose={() => setAdding(false)} />
      )}
    </>
  );
}

function ClientRow({ company: c }: { company: CompanySummary }) {
  const name = c.name ?? 'A client whose file can’t be read';
  const body = (
    <>
      <span className="ws-row-main">
        <span className="ws-row-title">{name}</span>
        <span className="ws-row-sub">{c.access === 'unreadable' ? `Folder ${c.id}` : c.industry || 'No industry given'}</span>
      </span>
      {c.access === 'read-only' && <span className="ws-badge">Has problems · opens read-only</span>}
      {c.access === 'unreadable' && <span className="ws-badge">Can’t be opened</span>}
      <span className="ws-row-meta">Changed {formatWhen(c.changedAt)}</span>
      {c.access !== 'unreadable' && <Icon name="chevronRight" size={14} className="ws-row-go" />}
    </>
  );
  // A file that can't be read at all has nothing to open; its row says so instead of leading nowhere.
  return c.access === 'unreadable' ? (
    <div className="ws-row is-static">{body}</div>
  ) : (
    <a className="ws-row" href={`#/c/${c.id}`}>
      {body}
    </a>
  );
}

/** Adds a client. Names are unique, ignoring case (MVP Q4); the server checks again against every client on disk. */
function NewClientDialog({ existing, onClose }: { existing: string[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useDialogFocus(dialogRef);
  // After useDialogFocus has noted what opened the dialog (autoFocus would move focus before it could),
  // so Escape gives focus back to the New client button.
  useEffect(() => nameRef.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Give the client a name.');
    if (!isCompanyNameFree(trimmed, existing)) return setError(`There is already a client called ${trimmed}.`);
    setBusy(true);
    try {
      const created = await createCompany({ name: trimmed, industry: industry.trim() });
      location.hash = `#/c/${created.workspace.company.id}`;
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={dialogRef}
        className="dialog glass ws-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-client-title"
        onSubmit={(e) => void submit(e)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="dialog-head">
          <span id="new-client-title">New client</span>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="ws-dialog-body">
          <label className="ws-field">
            <span className="ws-label">Name</span>
            <input
              className="ws-input"
              ref={nameRef}
              value={name}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'new-client-error' : undefined}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </label>
          <label className="ws-field">
            <span className="ws-label">
              Industry <span className="ws-optional">(optional)</span>
            </span>
            <input className="ws-input" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </label>
          {error && (
            <p className="ws-error" id="new-client-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="ws-dialog-foot">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            Add client
          </button>
        </div>
      </form>
    </div>
  );
}
