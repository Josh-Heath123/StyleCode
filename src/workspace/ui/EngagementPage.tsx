import { useState } from 'react';
import { Icon } from '../../ui/Icon';
import { consentSummary, createSession, editEngagement } from '../model/entities';
import { recordGroups, removeEngagement } from '../model/findings';
import { RecordSummary } from './RecordPage';
import type { CompanyWorkspace, Engagement } from '../model/types';
import { get } from '../model/util';
import { fromLocalInput, nowToTheMinute, toLocalInput, today } from '../time';
import { ClientFrame, Missing, type ClientView } from './ClientFrame';
import { count, formatWhen, Page } from './chrome';
import { DeleteDialog, DialogField, FormDialog, TextField } from './fields';
import { FilesCard } from './FilesCard';
import { StatusField } from './status';
import { NOT_APPLIED, now, step } from './steps';

/** An engagement: its sessions, and its name, goal and status (MVP 2.1 to 2.3). */
export function EngagementPage({ companyId, engagementId }: { companyId: string; engagementId: string }) {
  return (
    <ClientFrame companyId={companyId}>
      {(view) => {
        const engagement = get(view.workspace.engagements, engagementId);
        return engagement ? <EngagementView view={view} engagement={engagement} /> : <Missing view={view} what="engagement" />;
      }}
    </ClientFrame>
  );
}

const CONSENT_TEXT = {
  'not filled in': 'Consent not filled in',
  'not confirmed': 'Consent not confirmed',
  given: 'Consent given',
  'given with limits': 'Consent given with limits',
  declined: 'Consent declined',
  withdrawn: 'Consent withdrawn',
} as const;

function EngagementView({ view, engagement }: { view: ClientView; engagement: Engagement }) {
  const { workspace, readOnly, session, notices } = view;
  const companyHref = `#/c/${workspace.company.id}`;
  const [dialog, setDialog] = useState<'session' | 'delete' | null>(null);
  const sessions = Object.values(workspace.sessions)
    .filter((s) => s.engagementId === engagement.id)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
  const edit = (label: string, changes: Parameters<typeof editEngagement>[2]) =>
    step(session, label, (ws) => editEngagement(ws, engagement.id, changes, now()));

  return (
    <>
      <Page
        title={engagement.name}
        crumbs={[
          { label: 'Clients', href: '#/' },
          { label: workspace.company.name, href: companyHref },
          { label: engagement.name },
        ]}
        lede={engagement.goal || undefined}
        notices={notices}
      >
        <section className="ws-consent" aria-labelledby="record-line" data-state="confirmed">
          <div className="ws-consent-text">
            <h2 id="record-line">Record</h2>
            <p>
              <RecordSummary groups={recordGroups(workspace, engagement.id)} />
            </p>
          </div>
          <div className="ws-consent-actions">
            <a className="button" href={`${companyHref}/e/${engagement.id}/record`}>
              Open the record
            </a>
          </div>
        </section>
        <div className="ws-columns">
          <div className="ws-stack">
            <section className="ws-card" aria-labelledby="sessions-title">
              <div className="ws-card-head">
                <h2 id="sessions-title">Sessions</h2>
                {!readOnly && sessions.length > 0 && (
                  <button type="button" className="button primary" onClick={() => setDialog('session')}>
                    <Icon name="plus" size={14} /> New session
                  </button>
                )}
              </div>
              {sessions.length === 0 ? (
                <div className="ws-empty is-small">
                  <p>No sessions yet. Add one for each meeting with the client, before or after it happens.</p>
                  {!readOnly && (
                    <button type="button" className="button primary" onClick={() => setDialog('session')}>
                      <Icon name="plus" size={14} /> New session
                    </button>
                  )}
                </div>
              ) : (
                <ul className="ws-list is-compact" aria-label="Sessions">
                  {sessions.map((s) => {
                    const people = Object.values(workspace.participants).filter((p) => p.sessionId === s.id).length;
                    const consent = consentSummary(workspace, s.id);
                    return (
                      <li key={s.id}>
                        <a className="ws-row" href={`${companyHref}/e/${engagement.id}/s/${s.id}`}>
                          <span className="ws-row-main">
                            <span className="ws-row-title">{s.title}</span>
                            <span className="ws-row-sub">
                              {formatWhen(s.startsAt)} · {count(people, 'participant')}
                            </span>
                          </span>
                          <span className={`ws-badge${consent === 'given' ? ' is-active' : ''}`}>{CONSENT_TEXT[consent]}</span>
                          <Icon name="chevronRight" size={14} className="ws-row-go" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <FilesCard view={view} owner={{ kind: 'engagement', engagementId: engagement.id }} />
          </div>
          <section className="ws-card" aria-labelledby="details-title">
            <h2 id="details-title">Engagement</h2>
            <TextField
              label="Name"
              value={engagement.name}
              readOnly={readOnly}
              onCommit={(name) => edit('Rename the engagement', { name })}
            />
            <TextField
              label="Goal"
              value={engagement.goal}
              multiline
              readOnly={readOnly}
              onCommit={(goal) => edit('Change the goal', { goal })}
            />
            <StatusField
              status={engagement.status}
              readOnly={readOnly}
              defaultEnd={today()}
              onChange={(status) =>
                edit(status.state === 'ended' ? 'End the engagement' : 'Make the engagement active', { status })
              }
            />
            {!readOnly && (
              <div className="ws-card-foot">
                <button type="button" className="button danger" onClick={() => setDialog('delete')}>
                  <Icon name="trash" size={14} /> Delete engagement…
                </button>
              </div>
            )}
          </section>
        </div>
      </Page>
      {dialog === 'session' && <NewSessionDialog view={view} engagement={engagement} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <DeleteEngagementDialog view={view} engagement={engagement} onClose={() => setDialog(null)} companyHref={companyHref} />
      )}
    </>
  );
}

function NewSessionDialog({ view, engagement, onClose }: { view: ClientView; engagement: Engagement; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(() => toLocalInput(nowToTheMinute()));
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title="New session"
      submitLabel="Add session"
      error={error}
      onClose={onClose}
      onSubmit={() => {
        const start = fromLocalInput(startsAt);
        if (!start) return setError('Give the date and time the session starts.');
        const result = createSession(view.workspace, engagement.id, { title, startsAt: start }, now());
        if (!result.ok) return setError(result.error);
        if (!view.session.apply('Add a session', () => result.value.workspace)) return setError(NOT_APPLIED);
        location.hash = `#/c/${view.workspace.company.id}/e/${engagement.id}/s/${result.value.id}`;
      }}
    >
      <DialogField label="Title">
        {(id) => (
          <input
            id={id}
            className="ws-input"
            value={title}
            placeholder="For example, Kick-off"
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </DialogField>
      <DialogField label="Starts">
        {(id) => (
          <input
            id={id}
            className="ws-input"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        )}
      </DialogField>
    </FormDialog>
  );
}

/** What deleting an engagement takes with it, counted, for its confirmation (MVP 2.3). */
function engagementContents(ws: CompanyWorkspace, engagementId: string) {
  const sessionIds = new Set(
    Object.values(ws.sessions)
      .filter((s) => s.engagementId === engagementId)
      .map((s) => s.id),
  );
  const inSessions = <T extends { sessionId: string }>(map: Record<string, T>) =>
    Object.values(map).filter((x) => sessionIds.has(x.sessionId)).length;
  return {
    sessions: sessionIds.size,
    consents: inSessions(ws.consents),
    notes: inSessions(ws.notes),
    findings: Object.values(ws.findings).filter((f) => f.engagementId === engagementId).length,
    files: Object.values(ws.files).filter(
      (f) =>
        (f.owner.kind === 'engagement' && f.owner.engagementId === engagementId) ||
        (f.owner.kind === 'session' && sessionIds.has(f.owner.sessionId)),
    ).length,
  };
}

function DeleteEngagementDialog({
  view,
  engagement,
  companyHref,
  onClose,
}: {
  view: ClientView;
  engagement: Engagement;
  companyHref: string;
  onClose: () => void;
}) {
  const c = engagementContents(view.workspace, engagement.id);
  return (
    <DeleteDialog
      title="Delete engagement…"
      onClose={onClose}
      onDelete={() => {
        const error = step(
          view.session,
          'Delete the engagement',
          (ws) => {
            const removal = removeEngagement(ws, engagement.id, now());
            return removal.ok ? { ok: true, value: removal.value.workspace } : removal;
          },
          { permanent: true },
        );
        if (error) throw new Error(error);
        location.hash = companyHref;
      }}
      what={
        <>
          <p>
            This deletes <strong>{engagement.name}</strong> and everything in it: {count(c.sessions, 'session')}, with their{' '}
            {count(c.consents, 'consent record')} and {count(c.notes, 'note')}, {count(c.findings, 'finding')} and{' '}
            {count(c.files, 'file')}.
          </p>
          <p>
            <strong>This can’t be undone,</strong> and the undo history is cleared.
          </p>
        </>
      }
    />
  );
}
