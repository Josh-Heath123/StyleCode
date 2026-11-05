import { useId, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { addParticipant, editParticipant, editSession, removeParticipant, type ParticipantFields } from '../model/entities';
import { removeSession } from '../model/findings';
import type { Engagement, Participant, Session, Side } from '../model/types';
import { get } from '../model/util';
import { fromLocalInput, toLocalInput } from '../time';
import { ClientFrame, type ClientView } from './ClientFrame';
import { count, formatWhen, Page } from './chrome';
import { DeleteDialog, DialogField, FormDialog, TextField } from './fields';
import { Missing } from './EngagementPage';
import { now, step } from './steps';

/** A session (one meeting): who took part, and when it was (MVP 2.2, 2.3). */
export function SessionPage({
  companyId,
  engagementId,
  sessionId,
}: {
  companyId: string;
  engagementId: string;
  sessionId: string;
}) {
  return (
    <ClientFrame companyId={companyId}>
      {(view) => {
        const engagement = get(view.workspace.engagements, engagementId);
        const session = get(view.workspace.sessions, sessionId);
        if (!engagement) return <Missing view={view} what="engagement" />;
        if (!session || session.engagementId !== engagementId)
          return (
            <Missing
              view={view}
              what="session"
              back={{ href: `#/c/${companyId}/e/${engagementId}`, label: `Back to ${engagement.name}` }}
            />
          );
        return <SessionView view={view} engagement={engagement} meeting={session} />;
      }}
    </ClientFrame>
  );
}

const SIDE_TEXT: Record<Side, string> = { client: 'Client', consultant: 'Your side' };

function SessionView({ view, engagement, meeting }: { view: ClientView; engagement: Engagement; meeting: Session }) {
  const { workspace, readOnly, session, notices } = view;
  const companyHref = `#/c/${workspace.company.id}`;
  const engagementHref = `${companyHref}/e/${engagement.id}`;
  const [dialog, setDialog] = useState<{ kind: 'participant'; participant: Participant | null } | { kind: 'delete' } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const people = Object.values(workspace.participants)
    .filter((p) => p.sessionId === meeting.id)
    .sort((a, b) => Number(a.side === 'consultant') - Number(b.side === 'consultant') || a.name.localeCompare(b.name));
  const edit = (label: string, changes: Parameters<typeof editSession>[2]) =>
    step(session, label, (ws) => editSession(ws, meeting.id, changes, now()));

  return (
    <>
      <Page
        title={meeting.title}
        crumbs={[
          { label: 'Clients', href: '#/' },
          { label: workspace.company.name, href: companyHref },
          { label: engagement.name, href: engagementHref },
          { label: meeting.title },
        ]}
        lede={formatWhen(meeting.startsAt)}
        notices={notices}
      >
        <div className="ws-columns">
          <section className="ws-card" aria-labelledby="participants-title">
            <div className="ws-card-head">
              <h2 id="participants-title">Participants</h2>
              {!readOnly && people.length > 0 && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => setDialog({ kind: 'participant', participant: null })}
                >
                  <Icon name="plus" size={14} /> Add participant
                </button>
              )}
            </div>
            {error && (
              <p className="ws-error" role="alert">
                {error}
              </p>
            )}
            {people.length === 0 ? (
              <div className="ws-empty is-small">
                <p>
                  No participants yet. Add who took part, on the client’s side and yours. At least one person from the client is
                  needed to record their consent.
                </p>
                {!readOnly && (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => setDialog({ kind: 'participant', participant: null })}
                  >
                    <Icon name="plus" size={14} /> Add participant
                  </button>
                )}
              </div>
            ) : (
              <ul className="ws-list is-compact" aria-label="Participants">
                {people.map((p) => (
                  <li key={p.id} className="ws-row is-static">
                    <span className="ws-row-main">
                      <span className="ws-row-title">{p.name}</span>
                      <span className="ws-row-sub">{[p.role, p.organisation].filter(Boolean).join(', ') || 'No role given'}</span>
                    </span>
                    <span className={`ws-badge${p.side === 'client' ? ' is-active' : ''}`}>{SIDE_TEXT[p.side]}</span>
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Edit ${p.name}`}
                          data-tip="Edit"
                          onClick={() => setDialog({ kind: 'participant', participant: p })}
                        >
                          <Icon name="pencil" size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remove ${p.name}`}
                          data-tip="Remove"
                          data-tip-side="left"
                          onClick={() => setError(step(session, `Remove ${p.name}`, (ws) => removeParticipant(ws, p.id)))}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="ws-card" aria-labelledby="details-title">
            <h2 id="details-title">Session</h2>
            <TextField
              label="Title"
              value={meeting.title}
              readOnly={readOnly}
              onCommit={(title) => edit('Rename the session', { title })}
            />
            <TextField
              label="Starts"
              type="datetime-local"
              value={toLocalInput(meeting.startsAt)}
              display={formatWhen(meeting.startsAt)}
              readOnly={readOnly}
              onCommit={(value) => {
                const startsAt = fromLocalInput(value);
                return startsAt
                  ? edit('Change when the session starts', { startsAt })
                  : 'Give the date and time the session starts.';
              }}
            />
            {!readOnly && (
              <div className="ws-card-foot">
                <button type="button" className="button danger" onClick={() => setDialog({ kind: 'delete' })}>
                  <Icon name="trash" size={14} /> Delete session…
                </button>
              </div>
            )}
          </section>
        </div>
      </Page>
      {dialog?.kind === 'participant' && (
        <ParticipantDialog view={view} sessionId={meeting.id} participant={dialog.participant} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          title="Delete session…"
          onClose={() => setDialog(null)}
          onDelete={() => {
            const problem = step(
              session,
              'Delete the session',
              (ws) => {
                const removal = removeSession(ws, meeting.id, now());
                return removal.ok ? { ok: true, value: removal.value.workspace } : removal;
              },
              { permanent: true },
            );
            if (problem) throw new Error(problem);
            location.hash = engagementHref;
          }}
          what={<SessionContents view={view} meeting={meeting} />}
        />
      )}
    </>
  );
}

/** What deleting a session takes with it (MVP 2.3; DOMAIN-MODEL.md, decision 4). */
function SessionContents({ view, meeting }: { view: ClientView; meeting: Session }) {
  const ws = view.workspace;
  const mine = <T extends { sessionId: string }>(map: Record<string, T>) =>
    Object.values(map).filter((x) => x.sessionId === meeting.id);
  const notes = mine(ws.notes).length;
  const consent = mine(ws.consents).length;
  const transcript = mine(ws.transcripts).length;
  return (
    <>
      <p>
        This deletes the session <strong>{meeting.title}</strong> ({formatWhen(meeting.startsAt)}) with its{' '}
        {count(mine(ws.participants).length, 'participant')}, {consent ? 'consent record' : 'consent record (none yet)'},{' '}
        {transcript ? 'transcript, ' : ''}
        {count(notes, 'note')}, and the findings whose only evidence is in it.
      </p>
      <p>
        <strong>This can’t be undone,</strong> and the undo history is cleared.
      </p>
    </>
  );
}

function ParticipantDialog({
  view,
  sessionId,
  participant,
  onClose,
}: {
  view: ClientView;
  sessionId: string;
  participant: Participant | null;
  onClose: () => void;
}) {
  const sideName = useId();
  const companyName = view.workspace.company.name;
  const [fields, setFields] = useState<ParticipantFields>(
    participant ?? { name: '', role: '', organisation: companyName, side: 'client' },
  );
  const [error, setError] = useState<string | null>(null);
  const set = (changes: Partial<ParticipantFields>) => setFields((f) => ({ ...f, ...changes }));
  const setSide = (side: Side) =>
    // The organisation follows the side while it is still the default.
    set({
      side,
      organisation:
        fields.organisation === (fields.side === 'client' ? companyName : '')
          ? side === 'client'
            ? companyName
            : ''
          : fields.organisation,
    });
  return (
    <FormDialog
      title={participant ? `Edit ${participant.name}` : 'Add participant'}
      submitLabel={participant ? 'Save changes' : 'Add participant'}
      error={error}
      onClose={onClose}
      onSubmit={() => {
        if (participant) {
          const problem = step(view.session, `Change ${participant.name}`, (ws) => editParticipant(ws, participant.id, fields));
          if (problem) return setError(problem);
        } else {
          const result = addParticipant(view.workspace, sessionId, fields);
          if (!result.ok) return setError(result.error);
          view.session.apply(`Add ${fields.name.trim()}`, () => result.value.workspace);
        }
        onClose();
      }}
    >
      <fieldset className="ws-field ws-fieldset">
        <legend className="ws-label">Side</legend>
        <div className="ws-choices">
          <label className="ws-choice">
            <input type="radio" name={sideName} checked={fields.side === 'client'} onChange={() => setSide('client')} />
            The client’s
          </label>
          <label className="ws-choice">
            <input type="radio" name={sideName} checked={fields.side === 'consultant'} onChange={() => setSide('consultant')} />
            Yours (you, or someone working with you)
          </label>
        </div>
      </fieldset>
      <DialogField label="Name">
        {(id) => <input id={id} className="ws-input" value={fields.name} onChange={(e) => set({ name: e.target.value })} />}
      </DialogField>
      <DialogField label="Role" optional>
        {(id) => (
          <input
            id={id}
            className="ws-input"
            value={fields.role}
            placeholder="For example, Owner"
            onChange={(e) => set({ role: e.target.value })}
          />
        )}
      </DialogField>
      <DialogField label="Organisation" optional>
        {(id) => (
          <input
            id={id}
            className="ws-input"
            value={fields.organisation}
            onChange={(e) => set({ organisation: e.target.value })}
          />
        )}
      </DialogField>
    </FormDialog>
  );
}
