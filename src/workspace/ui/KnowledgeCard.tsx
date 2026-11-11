import { useState } from 'react';
import { removeFact, updateFact } from '../model/findings';
import { KIND_LABEL, provenanceLabel, STATUS_LABEL } from '../model/labels';
import { FINDING_KINDS, FINDING_STATUSES, type CompanyFact, type FindingKind, type FindingStatus } from '../model/types';
import { get } from '../model/util';
import type { ClientView } from './ClientFrame';
import { count, formatWhen } from './chrome';
import { DialogField, FormDialog } from './fields';
import { speakerName } from './FindingForm';
import { step } from './steps';

/** The company's facts, oldest first, so each keeps its place as more are added. */
export function factsOf(view: ClientView): CompanyFact[] {
  return Object.values(view.workspace.knowledge).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * What is known about the client (Phase 2 brief, WP8): each fact with its
 * kind, status, provenance and source, or "source deleted". On the client's
 * page, facts can be edited and removed. On an engagement's page, they are
 * shown to read, with a link to the client's page.
 */
export function KnowledgeCard({ view, manage }: { view: ClientView; manage: boolean }) {
  const facts = factsOf(view);
  const [editing, setEditing] = useState<CompanyFact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = manage && !view.readOnly;
  const companyHref = `#/c/${view.session.companyId}`;
  return (
    <section className="ws-card" aria-labelledby="knowledge-title">
      <div className="ws-card-head">
        <h2 id="knowledge-title">{manage ? 'Company knowledge' : `What is known about ${view.workspace.company.name}`}</h2>
        {!manage && facts.length > 0 && (
          <a className="button" href={companyHref}>
            Change on the client’s page
          </a>
        )}
      </div>
      {facts.length === 0 ? (
        <p className="ws-help">
          Nothing yet. In an engagement’s record, choose “Add to company knowledge” on a finding, and it shows here and in every
          engagement with this client.
        </p>
      ) : (
        <>
          <p className="ws-help">
            {manage
              ? `${count(facts.length, 'fact')}, carried into every engagement with this client.`
              : `${count(facts.length, 'fact')} from this client’s engagements.`}
          </p>
          {error && (
            <p className="ws-error" role="alert">
              {error}
            </p>
          )}
          <ul className="ws-findings" aria-label="Company facts">
            {facts.map((f) => (
              <FactItem
                key={f.id}
                view={view}
                fact={f}
                editable={editable}
                onEdit={() => setEditing(f)}
                onRemove={() => setError(step(view.session, 'Remove a company fact', (ws) => removeFact(ws, f.id)))}
              />
            ))}
          </ul>
        </>
      )}
      {editing && <FactDialog view={view} fact={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function FactItem({
  view,
  fact: f,
  editable,
  onEdit,
  onRemove,
}: {
  view: ClientView;
  fact: CompanyFact;
  editable: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const ws = view.workspace;
  const source = f.source;
  const finding = source?.findingId ? get(ws.findings, source.findingId) : undefined;
  const recordHref = finding ? `#/c/${view.session.companyId}/e/${finding.engagementId}/record` : null;
  return (
    <li className="ws-finding" aria-labelledby={`fact-${f.id}`}>
      <p className="ws-finding-statement" id={`fact-${f.id}`}>
        {f.statement}
      </p>
      <div className="ws-labels">
        <span className="ws-badge">{KIND_LABEL[f.kind]}</span>
        <span className="ws-badge is-status" data-status={f.status}>
          <span className="visually-hidden">Status: </span>
          {STATUS_LABEL[f.status]}
        </span>
        <span className="ws-badge is-provenance">
          <span className="visually-hidden">Provenance: </span>
          {provenanceLabel(f.provenance)}
        </span>
      </div>
      <p className="ws-fact-source">
        {!source ? (
          <span className="ws-muted">Entered by {f.createdBy}</span>
        ) : source.findingId === null ? (
          <span className="ws-muted">
            From {source.engagementName || 'an engagement'}: source deleted
            {source.deletedAt ? ` (${formatWhen(source.deletedAt)})` : ''}
          </span>
        ) : (
          <>
            <span className="ws-muted">From the record of </span>
            {recordHref ? <a href={recordHref}>{source.engagementName}</a> : source.engagementName}
          </>
        )}
        {source && source.statement !== f.statement && (
          <span className="ws-muted">
            {' '}
            · first recorded as <q>{source.statement}</q>
          </span>
        )}
      </p>
      {source && source.quotes.length > 0 && (
        <ul className="ws-evidence" aria-label="Quotes">
          {source.quotes.map((q, i) => (
            <li key={i}>
              <q>{q.text}</q>{' '}
              <span className="ws-muted">
                {q.speakerLabel === null ? 'note' : `said by ${speakerName(ws, q.sessionId, q.speakerLabel)}`}, in{' '}
                {q.sessionTitle}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="ws-finding-foot">
          <div className="ws-actions">
            <button type="button" className="button" onClick={onEdit} aria-label={`Change the company fact “${f.statement}”`}>
              Change
            </button>
            <button
              type="button"
              className="button danger"
              onClick={onRemove}
              aria-label={`Remove the company fact “${f.statement}”`}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Changes a fact's statement, kind or status (decision 17). Its source stays as it was. */
function FactDialog({ view, fact, onClose }: { view: ClientView; fact: CompanyFact; onClose: () => void }) {
  const [statement, setStatement] = useState(fact.statement);
  const [kind, setKind] = useState<FindingKind>(fact.kind);
  const [status, setStatus] = useState<FindingStatus>(fact.status);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title="Change the company fact"
      submitLabel="Save changes"
      error={error}
      onClose={onClose}
      onSubmit={() => {
        const problem = step(view.session, 'Change a company fact', (ws) => updateFact(ws, fact.id, { statement, kind, status }));
        if (problem) return setError(problem);
        onClose();
      }}
    >
      <DialogField label="Statement">
        {(id) => (
          <textarea id={id} className="ws-input" rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} />
        )}
      </DialogField>
      <DialogField label="Kind">
        {(id) => (
          <select id={id} className="ws-input" value={kind} onChange={(e) => setKind(e.target.value as FindingKind)}>
            {FINDING_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        )}
      </DialogField>
      <DialogField label="Status">
        {(id) => (
          <select id={id} className="ws-input" value={status} onChange={(e) => setStatus(e.target.value as FindingStatus)}>
            {FINDING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        )}
      </DialogField>
      {fact.source && <p className="ws-help">Its source stays as it was promoted, so you can still see where it came from.</p>}
    </FormDialog>
  );
}
