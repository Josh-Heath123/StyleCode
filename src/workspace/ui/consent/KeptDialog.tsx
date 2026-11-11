import { useState } from 'react';
import { keptFromSession, removeFact, removeFinding } from '../../model/findings';
import { KIND_LABEL } from '../../model/labels';
import type { Session } from '../../model/types';
import { get } from '../../model/util';
import type { ClientView } from '../ClientFrame';
import { FormDialog } from '../fields';
import { now, step } from '../steps';

/**
 * After a withdrawal (rule C8; Phase 2 brief, decision 11): the findings and
 * company facts that keep a statement from the session, each with a way to
 * edit or remove it, if the client asks for that. Removing is an ordinary
 * undoable step. `factIds` adds the facts that lost their quotes when the
 * transcript was deleted, which can't otherwise be traced to the session.
 */
export function KeptDialog({
  view,
  meeting,
  factIds = [],
  onClose,
}: {
  view: ClientView;
  meeting: Session;
  factIds?: string[];
  onClose: () => void;
}) {
  const ws = view.workspace;
  const [error, setError] = useState<string | null>(null);
  const kept = keptFromSession(ws, meeting.id);
  const facts = [
    ...kept.facts,
    ...factIds.map((id) => get(ws.knowledge, id)).filter((f) => f && !kept.facts.some((k) => k.id === f.id)),
  ] as typeof kept.facts;
  const recordHref = `#/c/${view.session.companyId}/e/${meeting.engagementId}/record`;
  const remove = (label: string, change: Parameters<typeof step>[2]) => setError(step(view.session, label, change));

  return (
    <FormDialog
      title="What keeps a statement from this session"
      submitLabel="Done"
      error={error}
      onSubmit={onClose}
      onClose={onClose}
    >
      <p className="ws-dialog-text">
        These still say something from <strong>{meeting.title}</strong>. If the client asks, remove them, or edit a finding in the
        record and a company fact on the client’s page. Removing one can be undone.
      </p>
      {kept.findings.length === 0 && facts.length === 0 && <p className="ws-muted">Nothing keeps a statement from it now.</p>}
      {kept.findings.length > 0 && (
        <>
          <h3 className="ws-label">Findings</h3>
          <ul className="ws-list is-compact" aria-label="Findings">
            {kept.findings.map((f) => (
              <li key={f.id} className="ws-row is-static">
                <span className="ws-row-main">
                  <span className="ws-row-title">{f.statement}</span>
                  <span className="ws-row-sub">{KIND_LABEL[f.kind]}</span>
                </span>
                <a className="button" href={recordHref} onClick={onClose}>
                  Edit in the record
                </a>
                <button
                  type="button"
                  className="button danger"
                  aria-label={`Remove the finding “${f.statement}”`}
                  onClick={() => remove('Remove a finding', (w) => removeFinding(w, f.id, now()))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {facts.length > 0 && (
        <>
          <h3 className="ws-label">Company facts</h3>
          <ul className="ws-list is-compact" aria-label="Company facts">
            {facts.map((f) => (
              <li key={f.id} className="ws-row is-static">
                <span className="ws-row-main">
                  <span className="ws-row-title">{f.statement}</span>
                  <span className="ws-row-sub">
                    {KIND_LABEL[f.kind]}
                    {f.source?.findingId === null ? ' · source deleted' : ''}
                  </span>
                </span>
                <a
                  className="button"
                  href={`#/c/${view.session.companyId}`}
                  onClick={onClose}
                  aria-label={`Edit “${f.statement}” on the client’s page`}
                >
                  Edit on the client’s page
                </a>
                <button
                  type="button"
                  className="button danger"
                  aria-label={`Remove the company fact “${f.statement}”`}
                  onClick={() => remove('Remove a company fact', (w) => removeFact(w, f.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </FormDialog>
  );
}
