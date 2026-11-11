import { useState } from 'react';
import { Icon } from '../../ui/Icon';
import { GROUPS, KIND_LABEL, provenanceLabel, RELATION_LABEL, STATUS_LABEL } from '../model/labels';
import { addRelation, createFinding, filteredRecord, linksOf, removeRelation, updateFinding } from '../model/record';
import { addToKnowledge, factFrom, isInRecord, removeFinding, type RecordGroups } from '../model/findings';
import { createId } from '../model/util';
import { ID_PREFIX } from '../model/workspace';
import {
  FINDING_KINDS,
  RELATION_TYPES,
  type CompanyWorkspace,
  type Engagement,
  type Finding,
  type FindingChange,
  type FindingKind,
  type RelationType,
} from '../model/types';
import { get } from '../model/util';
import { EvidenceLine, FindingFields, type FindingDraft } from './FindingForm';
import { ClientFrame, Missing, type ClientView } from './ClientFrame';
import { count, formatWhen, Page } from './chrome';
import { DialogField, FormDialog, NameField, nameFor } from './fields';
import { focusAfterRemoving } from './focus';
import { NOT_APPLIED, now, step } from './steps';
import { useConsultant, type Consultant } from './useConsultant';
import { saveAs } from './download';
import { exportEngagementMarkdown, exportFileName } from '../exportMarkdown';

/** An engagement's record (MVP stories 6.4, 7.1, 7.2). */
export function RecordPage({ companyId, engagementId }: { companyId: string; engagementId: string }) {
  return (
    <ClientFrame companyId={companyId}>
      {(view) => {
        const engagement = get(view.workspace.engagements, engagementId);
        return engagement ? <Record view={view} engagement={engagement} /> : <Missing view={view} what="engagement" />;
      }}
    </ClientFrame>
  );
}

type Dialog =
  | { kind: 'finding'; finding: Finding | null }
  | { kind: 'link'; finding: Finding }
  | { kind: 'promote'; finding: Finding }
  | null;

function Record({ view, engagement }: { view: ClientView; engagement: Engagement }) {
  const { workspace, readOnly } = view;
  const consultant = useConsultant();
  const [kind, setKind] = useState<FindingKind | ''>('');
  const [sessionId, setSessionId] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const companyHref = `#/c/${view.session.companyId}`;
  const engagementHref = `${companyHref}/e/${engagement.id}`;
  const groups = filteredRecord(workspace, engagement.id, { kind: kind || null, sessionId: sessionId || null });
  const total = Object.values(workspace.findings).filter((f) => f.engagementId === engagement.id && isInRecord(f)).length;
  const shown = GROUPS.reduce((n, g) => n + groups[g.key].length, 0);
  const sessions = Object.values(workspace.sessions)
    .filter((s) => s.engagementId === engagement.id)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  /** Follows a link to another finding; if the filters hide it, they are cleared first, so it can be shown. */
  const follow = (findingId: string) => {
    if (focusFinding(findingId)) return;
    setKind('');
    setSessionId('');
    requestAnimationFrame(() => focusFinding(findingId));
  };

  return (
    <>
      <Page
        title="Record"
        crumbs={[
          { label: 'Clients', href: '#/' },
          { label: workspace.company.name, href: companyHref },
          { label: engagement.name, href: engagementHref },
          { label: 'Record' },
        ]}
        lede={`What is established for ${engagement.name}, from all its sessions.`}
        notices={view.notices}
        actions={
          <>
            <ExportButton workspace={workspace} engagement={engagement} />
            {!readOnly && (
              <button type="button" className="button primary" onClick={() => setDialog({ kind: 'finding', finding: null })}>
                <Icon name="plus" size={14} /> Add finding
              </button>
            )}
          </>
        }
      >
        {error && (
          <p className="ws-error" role="alert">
            {error}
          </p>
        )}
        {total === 0 ? (
          <div className="ws-empty is-small ws-record-empty">
            <p>No findings yet. Findings are what you establish with the client, kept in four groups:</p>
            <ul>
              {GROUPS.map((g) => (
                <li key={g.key}>
                  <strong>{g.title}:</strong> {g.about}.
                </li>
              ))}
            </ul>
            {!readOnly && (
              <button type="button" className="button primary" onClick={() => setDialog({ kind: 'finding', finding: null })}>
                <Icon name="plus" size={14} /> Add finding
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="ws-filters" role="group" aria-label="Filter the record">
              <label className="ws-inline">
                Kind
                <select className="ws-input ws-select" value={kind} onChange={(e) => setKind(e.target.value as FindingKind | '')}>
                  <option value="">All kinds</option>
                  {FINDING_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ws-inline">
                Session
                <select className="ws-input ws-select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                  <option value="">All sessions</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <span className="ws-muted" role="status">
                {shown === total ? count(total, 'finding') : `${shown} of ${count(total, 'finding')}`}
              </span>
            </div>
            {shown === 0 && <p className="ws-muted">No findings match these filters.</p>}
            {GROUPS.filter((g) => groups[g.key].length > 0).map((g) => (
              <section key={g.key} className="ws-group" aria-labelledby={`group-${g.key}`}>
                <h2 id={`group-${g.key}`}>
                  {g.title} <span className="ws-muted">({groups[g.key].length})</span>
                </h2>
                <p className="ws-help">{capitalise(g.about)}.</p>
                <ol className="ws-findings">
                  {groups[g.key].map((f) => (
                    <FindingCard
                      key={f.id}
                      view={view}
                      finding={f}
                      engagementHref={engagementHref}
                      onEdit={() => setDialog({ kind: 'finding', finding: f })}
                      onLink={() => setDialog({ kind: 'link', finding: f })}
                      onPromote={() => setDialog({ kind: 'promote', finding: f })}
                      onDelete={() => {
                        const problem = step(view.session, 'Delete a finding', (ws) => removeFinding(ws, f.id, now()));
                        setError(problem);
                        if (!problem) {
                          const shownIds = GROUPS.flatMap((g) => groups[g.key].map((x) => x.id));
                          focusAfterRemoving(shownIds, f.id, (id) => `finding-${id}`);
                        }
                      }}
                      onError={setError}
                      onFollow={follow}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </>
        )}
      </Page>
      {dialog?.kind === 'finding' && (
        <FindingDialog
          view={view}
          engagement={engagement}
          finding={dialog.finding}
          consultant={consultant}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'promote' && (
        <PromoteDialog view={view} finding={dialog.finding} consultant={consultant} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'link' && (
        <LinkDialog
          view={view}
          engagement={engagement}
          finding={dialog.finding}
          consultant={consultant}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Moves focus to a finding's card, so a link can be followed from the keyboard. Returns false if it isn't shown. */
function focusFinding(findingId: string): boolean {
  const card = document.getElementById(`finding-${findingId}`);
  if (!card) return false;
  card.scrollIntoView({ block: 'center' });
  card.focus();
  return true;
}

function FindingCard({
  view,
  finding: f,
  engagementHref,
  onEdit,
  onLink,
  onPromote,
  onDelete,
  onError,
  onFollow,
}: {
  view: ClientView;
  finding: Finding;
  engagementHref: string;
  onEdit: () => void;
  onLink: () => void;
  onPromote: () => void;
  onDelete: () => void;
  onError: (error: string | null) => void;
  onFollow: (findingId: string) => void;
}) {
  const { workspace, readOnly, session } = view;
  const links = linksOf(workspace, f.id);
  const fact = factFrom(workspace, f.id);
  return (
    <li className="ws-finding" id={`finding-${f.id}`} tabIndex={-1} aria-labelledby={`finding-${f.id}-statement`}>
      <p className="ws-finding-statement" id={`finding-${f.id}-statement`}>
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
        {fact && (
          <a className="ws-badge is-knowledge" href={`#/c/${session.companyId}`}>
            In company knowledge
          </a>
        )}
      </div>
      {f.evidence.length > 0 && (
        <ul className="ws-evidence" aria-label="Evidence">
          {f.evidence.map((e, i) => (
            <li key={i}>
              <EvidenceLine workspace={workspace} evidence={e} engagementHref={engagementHref} />
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <ul className="ws-links" aria-label="Links">
          {links.map(({ relation, outgoing, other }) => (
            <li key={relation.id}>
              <span className="ws-muted">{RELATION_LABEL[relation.type][outgoing ? 'from' : 'to']}:</span>{' '}
              <button type="button" className="ws-link-button" onClick={() => onFollow(other.id)}>
                {other.statement}
              </button>
              {!readOnly && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove the link to “${other.statement}”`}
                  data-tip="Remove the link"
                  onClick={() => onError(step(session, 'Remove a link', (ws) => removeRelation(ws, relation.id)))}
                >
                  <Icon name="x" size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="ws-finding-foot">
        {f.history.length > 0 && <History changes={f.history} />}
        {!readOnly && (
          <div className="ws-actions">
            <button type="button" className="button" onClick={onEdit} aria-label={`Change “${f.statement}”`}>
              Change
            </button>
            <button type="button" className="button" onClick={onLink} aria-label={`Link “${f.statement}” to another finding`}>
              Link…
            </button>
            {!fact && (
              <button
                type="button"
                className="button"
                onClick={onPromote}
                aria-label={`Add “${f.statement}” to company knowledge`}
              >
                Add to company knowledge…
              </button>
            )}
            <button type="button" className="button danger" aria-label={`Delete “${f.statement}”`} onClick={onDelete}>
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

const FIELD_NAME: Record<FindingChange['field'], string> = {
  kind: 'Kind',
  statement: 'Statement',
  status: 'Status',
  evidence: 'Evidence',
};

function describe(change: FindingChange): string {
  switch (change.field) {
    case 'kind':
      return `${KIND_LABEL[change.from]} → ${KIND_LABEL[change.to]}`;
    case 'status':
      return `${STATUS_LABEL[change.from]} → ${STATUS_LABEL[change.to]}`;
    case 'statement':
      return `“${change.from}” → “${change.to}”`;
    case 'evidence':
      return `${count(change.from.length, 'quote')} → ${count(change.to.length, 'quote')}`;
  }
}

/** Every change to the finding, with who and when (MVP 7.1). */
function History({ changes }: { changes: FindingChange[] }) {
  return (
    <details className="ws-history">
      <summary>{count(changes.length, 'change')}</summary>
      <ol>
        {changes.map((c, i) => (
          <li key={i}>
            <strong>{FIELD_NAME[c.field]}:</strong> {describe(c)}{' '}
            <span className="ws-muted">
              ({c.by}, {formatWhen(c.at)})
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Asks for the consultant's name once, the first time something records it. */
/** Adds a finding by hand (MVP 6.4), or changes one in the record (7.1). Notes can be quoted as evidence. */
function FindingDialog({
  view,
  engagement,
  finding,
  consultant,
  onClose,
}: {
  view: ClientView;
  engagement: Engagement;
  finding: Finding | null;
  consultant: Consultant;
  onClose: () => void;
}) {
  const ws = view.workspace;
  const [draft, setDraft] = useState<FindingDraft>({
    kind: finding?.kind ?? 'business-requirement',
    statement: finding?.statement ?? '',
    status: finding?.status ?? 'suggested',
    evidence: finding?.evidence ?? [],
  });
  const { kind, statement, status, evidence } = draft;
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sessions = Object.values(ws.sessions)
    .filter((s) => s.engagementId === engagement.id)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return (
    <FormDialog
      title={finding ? 'Change the finding' : 'Add a finding'}
      submitLabel={finding ? 'Save changes' : 'Add finding'}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        const by = await nameFor(consultant, name);
        if (!by) return setError('Give your name: a finding records who added or changed it.');
        if (finding) {
          const problem = step(view.session, 'Change a finding', (w) =>
            updateFinding(w, finding.id, { kind, statement, status, evidence }, by, now()),
          );
          if (problem) return setError(problem);
        } else {
          const result = createFinding(
            view.session.getState().workspace,
            engagement.id,
            { kind, statement, status, evidence },
            by,
            now(),
          );
          if (!result.ok) return setError(result.error);
          if (!view.session.apply('Add a finding', () => result.value.workspace)) return setError(NOT_APPLIED);
        }
        onClose();
      }}
    >
      <FindingFields ws={ws} sessions={sessions} draft={draft} onChange={setDraft} />
      <NameField consultant={consultant} value={name} onChange={setName} />
    </FormDialog>
  );
}

/**
 * Adds a finding to company knowledge (Phase 2 brief, WP8 and decision 17),
 * so every engagement with this client shows it. The fact copies the
 * finding's statement, kind, status and quotes; the finding doesn't change.
 */
function PromoteDialog({
  view,
  finding,
  consultant,
  onClose,
}: {
  view: ClientView;
  finding: Finding;
  consultant: Consultant;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title="Add to company knowledge"
      submitLabel="Add to company knowledge"
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        const by = await nameFor(consultant, name);
        if (!by) return setError('Give your name: company knowledge records who added it.');
        const problem = step(view.session, 'Add to company knowledge', (ws) =>
          addToKnowledge(ws, finding.id, createId(ID_PREFIX.knowledge), by, now()),
        );
        if (problem) return setError(problem);
        onClose();
      }}
    >
      <p className="ws-dialog-text">
        <q>{finding.statement}</q>
      </p>
      <p className="ws-help">
        It will show on {view.workspace.company.name}’s page and in every engagement with them, as{' '}
        {KIND_LABEL[finding.kind].toLowerCase()}, {STATUS_LABEL[finding.status].toLowerCase()}
        {finding.evidence.some((e) => e.kind !== 'deleted') ? ', with its quotes' : ''}. You can change it there afterwards. The
        finding stays in this record as it is.
      </p>
      <NameField consultant={consultant} value={name} onChange={setName} />
    </FormDialog>
  );
}

/** Links a finding to another in the same engagement (MVP 7.2). */
function LinkDialog({
  view,
  engagement,
  finding,
  consultant,
  onClose,
}: {
  view: ClientView;
  engagement: Engagement;
  finding: Finding;
  consultant: Consultant;
  onClose: () => void;
}) {
  const others = Object.values(view.workspace.findings).filter(
    (f) => f.engagementId === engagement.id && f.id !== finding.id && isInRecord(f),
  );
  const [type, setType] = useState<RelationType>('influences');
  const [toId, setToId] = useState(others[0]?.id ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title="Link to another finding"
      submitLabel="Link"
      submitDisabled={!others.length}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        const by = await nameFor(consultant, name);
        if (!by) return setError('Give your name: a link records who made it.');
        const result = addRelation(view.session.getState().workspace, { type, fromId: finding.id, toId }, by, now());
        if (!result.ok) return setError(result.error);
        if (!view.session.apply('Link two findings', () => result.value.workspace)) return setError(NOT_APPLIED);
        onClose();
      }}
    >
      <p className="ws-dialog-text">
        <q>{finding.statement}</q>
      </p>
      {others.length === 0 ? (
        <p className="ws-help">There is no other finding in this engagement’s record to link to yet.</p>
      ) : (
        <>
          <DialogField label="How it relates">
            {(id) => (
              <select id={id} className="ws-input" value={type} onChange={(e) => setType(e.target.value as RelationType)}>
                {RELATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RELATION_LABEL[t].from}
                  </option>
                ))}
              </select>
            )}
          </DialogField>
          <DialogField label="The other finding">
            {(id) => (
              <select id={id} className="ws-input" value={toId} onChange={(e) => setToId(e.target.value)}>
                {others.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.statement}
                  </option>
                ))}
              </select>
            )}
          </DialogField>
        </>
      )}
      <NameField consultant={consultant} value={name} onChange={setName} />
    </FormDialog>
  );
}

/** The record in a line, for the engagement page: how many findings are in each group. */
export function RecordSummary({ groups }: { groups: RecordGroups }) {
  const parts = GROUPS.map((g) => `${groups[g.key].length} ${g.title.toLowerCase()}`);
  return <>{parts.join(' · ')}</>;
}

/** Saves the engagement's record as a Markdown file (MVP story 8). */
export function ExportButton({ workspace, engagement }: { workspace: CompanyWorkspace; engagement: Engagement }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="button"
        onClick={() => {
          setError(null);
          try {
            saveAs(
              exportFileName(String(workspace.company.name), String(engagement.name)),
              new Blob([exportEngagementMarkdown(workspace, engagement.id)], { type: 'text/markdown;charset=utf-8' }),
            );
          } catch (e) {
            // A damaged client (opened read-only) may hold values the export can't read: say so, rather than nothing.
            setError(`The record couldn’t be exported: ${(e as Error).message}`);
          }
        }}
      >
        <Icon name="download" size={14} /> Export as Markdown
      </button>
      {error && (
        <span className="ws-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
