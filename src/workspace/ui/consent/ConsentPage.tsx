import { useMemo, useState } from 'react';
import { consentFor, consentState } from '../../model/consent';
import {
  confirmIssues,
  consentFormFor,
  decline,
  saveConsentForm,
  saveIssues,
  type ConsentFormValues,
  type FormPlace,
} from '../../model/consentForm';
import type { ConsentAmendment, ConsentRecord, Engagement, Session } from '../../model/types';
import { get } from '../../model/util';
import { CURRENT_WORDING, wordingFor } from '../../model/wording';
import { ClientFrame, Missing, type ClientView } from '../ClientFrame';
import { formatWhen, Page } from '../chrome';
import { now, step } from '../steps';
import { retentionSummary } from './ConsentPanel';
import { AmendForm } from './AmendForm';
import { ConsentAttachment } from './ConsentAttachment';
import { Choice, Section, STATEMENTS, YesNo } from './formParts';
import { useConsentContext, type ConsentContext } from './useConsentContext';

/** A session's consent form (MVP story 3.1; docs/spec/CONSENT.md). */
export function ConsentPage({
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
        const meeting = get(view.workspace.sessions, sessionId);
        if (!engagement) return <Missing view={view} what="engagement" />;
        if (!meeting || meeting.engagementId !== engagementId)
          return (
            <Missing
              view={view}
              what="session"
              back={{ href: `#/c/${companyId}/e/${engagementId}`, label: `Back to ${engagement.name}` }}
            />
          );
        return <Consent view={view} engagement={engagement} meeting={meeting} />;
      }}
    </ClientFrame>
  );
}

function Consent({ view, engagement, meeting }: { view: ClientView; engagement: Engagement; meeting: Session }) {
  const context = useConsentContext();
  const [amending, setAmending] = useState(false);
  const company = view.workspace.company;
  const folder = view.session.companyId;
  const sessionHref = `#/c/${folder}/e/${engagement.id}/s/${meeting.id}`;
  const record = consentFor(view.workspace, meeting.id);
  const crumbs = [
    { label: 'Clients', href: '#/' },
    { label: company.name, href: `#/c/${folder}` },
    { label: engagement.name, href: `#/c/${folder}/e/${engagement.id}` },
    { label: meeting.title, href: sessionHref },
    { label: 'Consent' },
  ];
  const title = `Consent for “${meeting.title}”`;
  const lede = formatWhen(meeting.startsAt);
  if (view.readOnly && !record) {
    return (
      <Page title={title} crumbs={crumbs} lede={lede} notices={view.notices}>
        <p>This session has no consent record, and this client is read-only, so none can be filled in.</p>
        <p>
          <a className="button" href={sessionHref}>
            Back to the session
          </a>
        </p>
      </Page>
    );
  }
  const attachment = record && context && <ConsentAttachment view={view} meeting={meeting} record={record} context={context} />;
  if (record && (record.lockedAt || view.readOnly)) {
    const withdrawn = record.amendments.some((a) => a.kind === 'withdrawal');
    const canAmend = !view.readOnly && !!record.confirmed && !withdrawn;
    if (amending && canAmend && context)
      return (
        <Page title={title} crumbs={crumbs} lede={lede} notices={view.notices}>
          <AmendForm view={view} meeting={meeting} record={record} context={context} onDone={() => setAmending(false)} />
        </Page>
      );
    return (
      <Page title={title} crumbs={crumbs} lede={lede} notices={view.notices}>
        <RecordView view={view} record={record} />
        {attachment}
        <p className="ws-actions">
          {canAmend && (
            <button type="button" className="button primary" onClick={() => setAmending(true)}>
              Amend…
            </button>
          )}
          <a className="button" href={sessionHref}>
            Back to the session
          </a>
        </p>
      </Page>
    );
  }
  return (
    <Page title={title} crumbs={crumbs} lede={lede} notices={view.notices}>
      {context ? (
        <>
          <ConsentForm view={view} meeting={meeting} context={context} sessionHref={sessionHref} />
          {attachment}
        </>
      ) : (
        <p className="ws-muted">Loading…</p>
      )}
    </Page>
  );
}

function ConsentForm({
  view,
  meeting,
  context,
  sessionHref,
}: {
  view: ClientView;
  meeting: Session;
  context: ConsentContext;
  sessionHref: string;
}) {
  const ws = view.workspace;
  const existing = consentFor(ws, meeting.id);
  const [values, setValues] = useState<ConsentFormValues>(() => consentFormFor(ws, meeting.id));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reconfirm, setReconfirm] = useState(false);
  const wording = wordingFor(CURRENT_WORDING)!;
  // The external provider: the one this record already names, or the one set up in AI settings (rule C6).
  const provider = existing?.given.externalProvider ?? existing?.told.externalProvider ?? context.externalProvider;
  const clients = Object.values(ws.participants).filter((p) => p.sessionId === meeting.id && p.side === 'client');
  // An existing record keeps who asked; a new one is asked by the consultant in settings (or the name given here).
  const askedBy = existing?.askedBy || context.consultant || name.trim() || null;
  const declined = values.outcome.kind === 'declined';

  /** Any change to what the record says needs confirming again (rule C3). */
  const update = (changes: Partial<ConsentFormValues>) => {
    setError(null);
    setValues((v) => {
      if (v.confirm && existing?.confirmed) setReconfirm(true);
      return { ...v, ...changes, confirm: false };
    });
  };

  // The retention statement's words follow the choice under "Audio kept", so a tick for the old words
  // no longer stands: it is cleared, for the consultant to tick the words they actually said.
  const [retentionUnticked, setRetentionUnticked] = useState(false);
  const setRetention = (retention: ConsentFormValues['retention']) => {
    if (values.told.retention) setRetentionUnticked(true);
    update({ retention, told: { ...values.told, retention: false } });
  };

  const blocking = useMemo(() => saveIssues(ws, meeting.id, values), [ws, meeting.id, values]);
  const toConfirm = useMemo(() => confirmIssues(values, askedBy), [values, askedBy]);
  const at = (place: FormPlace) => [...blocking, ...toConfirm].filter((i) => i.place === place);

  const save = async () => {
    if (blocking.length) return setError(blocking[0].message);
    let by = askedBy;
    if (!context.consultant && name.trim()) by = await context.saveConsultant(name);
    const label = !existing
      ? 'Fill in the consent form'
      : values.confirm
        ? 'Confirm the consent form'
        : 'Change the consent form';
    const problem = step(view.session, label, (w) => saveConsentForm(w, meeting.id, values, by, now()));
    if (problem) return setError(problem);
    location.hash = sessionHref;
  };

  return (
    <form
      className="ws-consent-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="ws-help">
        Fill this in after asking, in the order the conversation went. It is saved with the session and shows what the client was
        told (wording {CURRENT_WORDING}, a draft until it has been reviewed for POPIA) and what they agreed to.
      </p>

      <Section title="Who was asked" issues={at('asked')}>
        {clients.length === 0 ? (
          <p>
            This session has no one from the client yet. <a href={sessionHref}>Add the participants</a> first.
          </p>
        ) : (
          clients.map((p) => (
            <label key={p.id} className="ws-choice">
              <input
                type="checkbox"
                checked={values.askedParticipantIds.includes(p.id)}
                onChange={(e) =>
                  update({
                    askedParticipantIds: e.target.checked
                      ? [...values.askedParticipantIds, p.id]
                      : values.askedParticipantIds.filter((id) => id !== p.id),
                  })
                }
              />
              {[p.name, p.role, p.organisation].filter(Boolean).join(', ')}
            </label>
          ))
        )}
      </Section>

      <Section title="Asked by" issues={at('confirm').filter((i) => i.message.startsWith('Give your name'))}>
        {askedBy && (existing?.askedBy || context.consultant) ? (
          <p className="ws-value">{askedBy}</p>
        ) : (
          <label className="ws-field">
            <span className="ws-label">Your name (kept in settings)</span>
            <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
      </Section>

      <Choice
        title="How consent was asked"
        issues={at('method')}
        value={values.method.kind}
        options={[
          ['verbal-at-start', 'Verbally at the start of the meeting'],
          ['written-before', 'In writing beforehand'],
          ['other', 'Other'],
        ]}
        onChange={(kind) => update({ method: kind === 'other' ? { kind, description: '' } : { kind } })}
      >
        {values.method.kind === 'other' && (
          <input
            className="ws-input"
            aria-label="How consent was asked"
            value={values.method.description}
            onChange={(e) => update({ method: { kind: 'other', description: e.target.value } })}
          />
        )}
      </Choice>

      <Section title={`What you told them (wording ${CURRENT_WORDING})`} issues={at('told')}>
        <p className="ws-help">Tick each statement you said or sent to them, as it is written here.</p>
        {STATEMENTS.filter((s) => s !== 'processingExternal' || provider).map((s) => (
          <label key={s} className="ws-choice ws-statement">
            <input
              type="checkbox"
              checked={values.told[s]}
              onChange={(e) => {
                if (s === 'retention' && e.target.checked) setRetentionUnticked(false);
                update({
                  told: {
                    ...values.told,
                    [s]: e.target.checked,
                    ...(s === 'processingExternal' && { externalProvider: e.target.checked ? provider : null }),
                  },
                });
              }}
            />
            <q>{wording.statement(s, { provider, retention: values.retention })}</q>
          </label>
        ))}
      </Section>

      <Section title="What they agreed to" issues={at('given')}>
        {declined && <p className="ws-help">Consent was declined, so every answer is no.</p>}
        <YesNo label="Audio recording" answer="audioRecording" values={values} update={update} issues={at('audioRecording')} />
        <YesNo label="Transcription" answer="transcription" values={values} update={update} issues={at('transcription')} />
        <YesNo label="AI on this computer" answer="aiLocal" values={values} update={update} issues={at('aiLocal')} />
        {provider && (
          <YesNo
            label={`AI by ${provider}`}
            answer="aiExternal"
            provider={provider}
            values={values}
            update={update}
            issues={at('aiExternal')}
          />
        )}
      </Section>

      {values.given.audioRecording && (
        <Choice
          title="Audio kept"
          issues={at('retention')}
          value={values.retention.kind}
          options={[
            ['days', 'For a number of days'],
            ['until-engagement-ends', 'Until the engagement ends'],
            ['delete-after-transcription', 'Deleted after transcription'],
          ]}
          onChange={(kind) => setRetention(kind === 'days' ? { kind, days: 30 } : { kind })}
        >
          {values.retention.kind === 'days' && (
            <label className="ws-inline">
              <input
                className="ws-input ws-number"
                type="number"
                min={1}
                aria-label="Days the audio is kept"
                value={values.retention.days}
                onChange={(e) => setRetention({ kind: 'days', days: Math.floor(Number(e.target.value)) })}
              />
              days
            </label>
          )}
          {retentionUnticked && (
            <p className="ws-help" role="status">
              The statement about how long the recording is kept now says something else, so it is unticked. Tick it again under
              “What you told them” if that is what you said.
            </p>
          )}
        </Choice>
      )}

      <Choice
        title="Outcome"
        issues={at('outcome')}
        value={values.outcome.kind}
        options={[
          ['given', 'Given'],
          ['limited', 'Given with limits'],
          ['declined', 'Declined'],
        ]}
        onChange={(kind) => {
          if (kind === 'declined') update(decline(values));
          else update({ outcome: kind === 'limited' ? { kind, limits: '' } : { kind } });
        }}
      >
        {values.outcome.kind === 'limited' && (
          <input
            className="ws-input"
            aria-label="The limits the client set"
            value={values.outcome.limits}
            onChange={(e) => update({ outcome: { kind: 'limited', limits: e.target.value } })}
          />
        )}
      </Choice>

      <section className="ws-card ws-confirm" aria-labelledby="confirm-title">
        <h2 id="confirm-title">Confirm</h2>
        {reconfirm && <p className="ws-help">You changed the record, so it needs confirming again.</p>}
        {toConfirm.length > 0 && (
          <div className="ws-help" id="confirm-needs">
            To confirm, first:
            <ul>
              {toConfirm.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
            You can save it as a draft meanwhile. A draft allows nothing.
          </div>
        )}
        <label className="ws-choice">
          <input
            type="checkbox"
            checked={values.confirm}
            disabled={toConfirm.length > 0}
            aria-describedby={toConfirm.length ? 'confirm-needs' : undefined}
            onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.checked }))}
          />
          I asked for consent as recorded above.
        </label>
        {error && (
          <p className="ws-error" role="alert">
            {error}
          </p>
        )}
        <div className="ws-actions">
          <button type="submit" className="button primary">
            {values.confirm ? 'Save and confirm' : 'Save as draft'}
          </button>
          <a className="button" href={sessionHref}>
            Cancel
          </a>
        </div>
      </section>
    </form>
  );
}

const METHOD_TEXT = {
  'verbal-at-start': 'Verbally at the start of the meeting',
  'written-before': 'In writing beforehand',
} as const;

/** A record that can't be edited here (locked by a withdrawal, or a read-only client): what it says, and its history. */
function RecordView({ view, record }: { view: ClientView; record: ConsentRecord }) {
  const wording = wordingFor(record.wordingVersion);
  const provider = record.given.externalProvider ?? record.told.externalProvider;
  const asked = record.askedParticipantIds.map((id) => get(view.workspace.participants, id)?.name ?? id).join(', ');
  const answers: [string, boolean][] = [
    ['Audio recording', record.given.audioRecording],
    ['Transcription', record.given.transcription],
    ['AI on this computer', record.given.aiLocal],
    ...(provider ? ([[`AI by ${provider}`, record.given.aiExternal]] as [string, boolean][]) : []),
  ];
  return (
    <div className="ws-columns">
      <section className="ws-card" aria-labelledby="record-title">
        <h2 id="record-title">The record</h2>
        <dl className="ws-dl">
          <dt>Who was asked</dt>
          <dd>{asked || 'No one'}</dd>
          <dt>Asked by</dt>
          <dd>{record.askedBy || 'Not given'}</dd>
          <dt>How</dt>
          <dd>{record.method.kind === 'other' ? record.method.description : METHOD_TEXT[record.method.kind]}</dd>
          <dt>What they agreed to</dt>
          <dd>
            {answers.map(([label, yes]) => (
              <div key={label}>
                {label}: {yes ? 'yes' : 'no'}
              </div>
            ))}
          </dd>
          <dt>Audio</dt>
          <dd>{retentionSummary(record.retention)}</dd>
          <dt>Outcome</dt>
          <dd>
            {record.outcome.kind === 'given'
              ? 'Given'
              : record.outcome.kind === 'declined'
                ? 'Declined'
                : `Given with limits: ${record.outcome.limits}`}
          </dd>
          <dt>Confirmed</dt>
          <dd>{record.confirmed ? `By ${record.confirmed.by}, ${formatWhen(record.confirmed.at)}` : 'No'}</dd>
        </dl>
      </section>
      <section className="ws-card" aria-labelledby="told-title">
        <h2 id="told-title">What they were told (wording {record.wordingVersion})</h2>
        <ul className="ws-told">
          {STATEMENTS.filter((s) => record.told[s]).map((s) => (
            <li key={s}>
              <q>{wording ? wording.statement(s, { provider, retention: record.retention }) : s}</q>
            </li>
          ))}
        </ul>
        {record.amendments.length > 0 && (
          <>
            <h2>Changes since</h2>
            <ol className="ws-amendments" aria-label="Changes since">
              {record.amendments.map((a) => (
                <li key={a.id}>
                  <p>
                    <strong>{a.kind === 'withdrawal' ? 'Consent withdrawn' : 'Amended'}</strong> by {a.by}, {formatWhen(a.at)}.
                    Reason: {a.reason}
                  </p>
                  {a.kind === 'change' && <AmendmentDetail record={record} amendment={a} />}
                </li>
              ))}
            </ol>
            <h2>What it allows now</h2>
            <p>{nowAllowed(record)}</p>
          </>
        )}
      </section>
    </div>
  );
}

/** What an amendment changed, and what the client was newly told, in the wording it names. */
function AmendmentDetail({
  record,
  amendment: a,
}: {
  record: ConsentRecord;
  amendment: Extract<ConsentAmendment, { kind: 'change' }>;
}) {
  const wording = a.wordingVersion ? wordingFor(a.wordingVersion) : null;
  const provider = a.told?.externalProvider ?? record.told.externalProvider ?? null;
  const changes: string[] = [];
  const answer = (label: string, yes: boolean | undefined) =>
    yes !== undefined && changes.push(`${label}: ${yes ? 'yes' : 'no'}`);
  answer('Audio recording', a.given?.audioRecording);
  answer('Transcription', a.given?.transcription);
  answer('AI on this computer', a.given?.aiLocal);
  answer(`AI by ${a.given?.externalProvider ?? provider ?? 'an external provider'}`, a.given?.aiExternal);
  if (a.retention) changes.push(capitalise(retentionSummary(a.retention)));
  if (a.outcome)
    changes.push(
      a.outcome.kind === 'limited'
        ? `Given with limits: ${a.outcome.limits}`
        : a.outcome.kind === 'declined'
          ? 'Declined'
          : 'Given',
    );
  const told = STATEMENTS.filter((s) => a.told?.[s]);
  return (
    <>
      {changes.length > 0 && <p>{changes.join(' · ')}</p>}
      {told.length > 0 && (
        <>
          <p>Newly told (wording {a.wordingVersion}):</p>
          <ul className="ws-told">
            {told.map((s) => (
              <li key={s}>
                <q>{wording ? wording.statement(s, { provider, retention: a.retention ?? record.retention }) : s}</q>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What the record allows after its amendments, in a line. */
function nowAllowed(record: ConsentRecord): string {
  const state = consentState(record);
  if (state.withdrawn) return 'Nothing: consent was withdrawn.';
  if (state.outcome.kind === 'declined') return 'Nothing: consent was declined.';
  const items = [
    state.given.audioRecording && `audio recording (${retentionSummary(state.retention)})`,
    state.given.transcription && 'transcription',
    state.given.aiLocal && 'AI on this computer',
    state.given.aiExternal && `AI by ${state.given.externalProvider}`,
  ].filter(Boolean);
  return items.length ? capitalise(items.join(', ')) + '.' : 'Nothing.';
}
