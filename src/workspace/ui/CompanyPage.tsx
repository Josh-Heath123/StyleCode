import { useState } from 'react';
import { Icon } from '../../ui/Icon';
import { deleteCompany, listCompanies } from '../api';
import { createEngagement } from '../model/entities';
import type { CompanyWorkspace, EngagementStatus } from '../model/types';
import { editCompany, isCompanyNameFree, type ProfileField } from '../model/workspace';
import { today } from '../time';
import { ClientFrame, type ClientView } from './ClientFrame';
import { count, formatDay, formatWhen, Id, Page } from './chrome';
import { DeleteDialog, DialogField, FormDialog, TextField } from './fields';
import { FilesCard } from './FilesCard';
import { StatusField } from './status';
import { NOT_APPLIED, now, step } from './steps';
import { closeCompany } from './useCompanySession';

const PROFILE: { field: ProfileField; label: string; multiline?: boolean; step: string }[] = [
  { field: 'name', label: 'Name', step: 'Rename the client' },
  { field: 'industry', label: 'Industry', step: 'Change the industry' },
  { field: 'description', label: 'What they do', multiline: true, step: 'Change what they do' },
  { field: 'existingSystems', label: 'Existing systems', multiline: true, step: 'Change the existing systems' },
  { field: 'notes', label: 'Notes', multiline: true, step: 'Change the notes' },
];

/** A client: its engagements, and its profile (MVP stories 1.2 to 1.4, 2.1). */
export function CompanyPage({ companyId }: { companyId: string }) {
  return <ClientFrame companyId={companyId}>{(view) => <Company view={view} />}</ClientFrame>;
}

function Company({ view }: { view: ClientView }) {
  const { workspace, readOnly, notices } = view;
  const { company } = workspace;
  const [dialog, setDialog] = useState<'engagement' | 'delete' | null>(null);
  return (
    <>
      <Page
        title={company.name}
        crumbs={[{ label: 'Clients', href: '#/' }, { label: company.name }]}
        lede={company.industry || undefined}
        notices={notices}
      >
        <div className="ws-columns">
          <div className="ws-stack">
            <section className="ws-card" aria-labelledby="engagements-title">
              <div className="ws-card-head">
                <h2 id="engagements-title">Engagements</h2>
                {!readOnly && Object.keys(workspace.engagements).length > 0 && (
                  <button type="button" className="button primary" onClick={() => setDialog('engagement')}>
                    <Icon name="plus" size={14} /> New engagement
                  </button>
                )}
              </div>
              <Engagements workspace={workspace} readOnly={readOnly} onAdd={() => setDialog('engagement')} />
            </section>
            <FilesCard view={view} owner={{ kind: 'company' }} />
          </div>
          <section className="ws-card" aria-labelledby="profile-title">
            <h2 id="profile-title">Profile</h2>
            {PROFILE.map((p) => (
              <TextField
                key={p.field}
                label={p.label}
                value={company[p.field]}
                multiline={p.multiline}
                readOnly={readOnly}
                onCommit={(value) => commitProfile(view, p.field, p.step, value)}
              />
            ))}
            <p className="ws-help">Profile changed {formatWhen(company.updatedAt)}</p>
            <div className="ws-card-foot">
              <button type="button" className="button danger" onClick={() => setDialog('delete')}>
                <Icon name="trash" size={14} /> Delete client…
              </button>
            </div>
          </section>
        </div>
      </Page>
      {dialog === 'engagement' && <NewEngagementDialog view={view} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteClientDialog view={view} onClose={() => setDialog(null)} />}
    </>
  );
}

/** A profile change; a new name must not be another client's (MVP Q4). */
async function commitProfile(view: ClientView, field: ProfileField, label: string, value: string): Promise<string | null> {
  const { session, workspace } = view;
  if (field === 'name') {
    const name = value.trim();
    if (!name) return 'A client needs a name.';
    if (name.toLocaleLowerCase() !== workspace.company.name.trim().toLocaleLowerCase()) {
      try {
        const others = (await listCompanies()).flatMap((c) => (c.name && c.id !== workspace.company.id ? [c.name] : []));
        if (!isCompanyNameFree(name, others)) return `There is already a client called ${name}.`;
      } catch (e) {
        return (e as Error).message;
      }
    }
  }
  return step(session, label, (ws) => editCompany(ws, { [field]: value }, now()));
}

/** The client's engagements, newest first (MVP 2.1). */
function Engagements({ workspace, readOnly, onAdd }: { workspace: CompanyWorkspace; readOnly: boolean; onAdd: () => void }) {
  const engagements = Object.values(workspace.engagements).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name),
  );
  if (!engagements.length) {
    return (
      <div className="ws-empty is-small">
        <p>
          No engagements yet. An engagement is one piece of work for this client, such as a new ordering system. Its sessions,
          consent records and notes are kept inside it.
        </p>
        {!readOnly && (
          <button type="button" className="button primary" onClick={onAdd}>
            <Icon name="plus" size={14} /> New engagement
          </button>
        )}
      </div>
    );
  }
  const sessions = (id: string) => Object.values(workspace.sessions).filter((s) => s.engagementId === id).length;
  return (
    <ul className="ws-list is-compact" aria-label="Engagements">
      {engagements.map((e) => (
        <li key={e.id}>
          <a className="ws-row" href={`#/c/${workspace.company.id}/e/${e.id}`}>
            <span className="ws-row-main">
              <span className="ws-row-title">{e.name}</span>
              {e.goal && <span className="ws-row-sub">{e.goal}</span>}
            </span>
            <span className="ws-row-meta">{count(sessions(e.id), 'session')}</span>
            <span className={`ws-badge${e.status.state === 'active' ? ' is-active' : ''}`}>
              {e.status.state === 'active' ? 'Active' : `Ended ${formatDay(e.status.endedOn)}`}
            </span>
            <Icon name="chevronRight" size={14} className="ws-row-go" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function NewEngagementDialog({ view, onClose }: { view: ClientView; onClose: () => void }) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [status, setStatus] = useState<EngagementStatus>({ state: 'active' });
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title="New engagement"
      submitLabel="Add engagement"
      error={error}
      onClose={onClose}
      onSubmit={() => {
        const result = createEngagement(view.workspace, { name, goal, status }, now());
        if (!result.ok) return setError(result.error);
        if (!view.session.apply('Add an engagement', () => result.value.workspace)) return setError(NOT_APPLIED);
        location.hash = `#/c/${view.workspace.company.id}/e/${result.value.id}`;
      }}
    >
      <DialogField label="Name">
        {(id) => <input id={id} className="ws-input" value={name} onChange={(e) => setName(e.target.value)} />}
      </DialogField>
      <DialogField label="Goal" optional>
        {(id) => <textarea id={id} className="ws-input" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} />}
      </DialogField>
      <StatusField status={status} onChange={(s) => (setStatus(s), null)} defaultEnd={today()} />
    </FormDialog>
  );
}

/** Deleting a client: type its name; the server checks it again (MVP 1.4). */
function DeleteClientDialog({ view, onClose }: { view: ClientView; onClose: () => void }) {
  const ws = view.workspace;
  const n = (map: Record<string, unknown>) => Object.keys(map).length;
  return (
    <DeleteDialog
      title="Delete client…"
      typeToConfirm={ws.company.name}
      onClose={onClose}
      onDelete={async () => {
        // The folder this page was opened from: for a copied folder, the id inside its file is the original's.
        const folderId = view.session.companyId;
        // The server checks the name in the file on disk: save a waiting rename first, and send the saved name.
        await view.session.saveNow();
        await deleteCompany(folderId, view.session.saved.company.name);
        closeCompany(folderId);
        location.hash = '#/';
      }}
      what={
        <>
          <p>
            This deletes <strong>{ws.company.name}</strong> (folder <Id>{view.session.companyId}</Id>) and everything in it:{' '}
            {count(n(ws.engagements), 'engagement')}, {count(n(ws.sessions), 'session')},{' '}
            {count(n(ws.consents), 'consent record')}, {count(n(ws.notes), 'note')}, {count(n(ws.findings), 'finding')} and{' '}
            {count(n(ws.files), 'file')}. The folder is removed from the data folder.
          </p>
          <p>
            <strong>This can’t be undone.</strong> Backups and exports you made earlier aren’t affected.
          </p>
        </>
      }
    />
  );
}
