import { useId, useMemo, useState } from 'react';
import { consentState, toldSoFar } from '../../model/consent';
import {
  amendConsentForm,
  amendFormFor,
  amendIssues,
  canTellOnAmend,
  type AmendValues,
  type FormPlace,
} from '../../model/consentForm';
import type { ConsentRecord, Session } from '../../model/types';
import { CURRENT_WORDING, wordingFor } from '../../model/wording';
import type { ClientView } from '../ClientFrame';
import { now, step } from '../steps';
import { Choice, Section, STATEMENTS, YesNo } from './formParts';
import type { ConsentContext } from './useConsentContext';

/**
 * Amend… for a locked consent record (Phase 2 brief, decision 10; CONSENT.md,
 * rule C4): the answers as they stand, the statements not yet told, and why.
 * It adds a dated amendment and never changes the original. It is checked like
 * the form (C2), and is final once recorded, like the record it adds to.
 */
export function AmendForm({
  view,
  meeting,
  record,
  context,
  onDone,
}: {
  view: ClientView;
  meeting: Session;
  record: ConsentRecord;
  context: ConsentContext;
  onDone: () => void;
}) {
  const [values, setValues] = useState<AmendValues>(() => amendFormFor(record));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const wording = wordingFor(CURRENT_WORDING)!;
  const toldBefore = toldSoFar(record).statements;
  const current = consentState(record);
  // The provider this record already names, or the one set up in AI settings (rule C6).
  const provider = current.given.externalProvider ?? record.told.externalProvider ?? context.externalProvider;
  const declined = values.outcome.kind === 'declined';

  const issues = useMemo(() => amendIssues(record, values), [record, values]);
  const at = (place: FormPlace) => issues.filter((i) => i.place === place);
  const update = (changes: Partial<AmendValues>) => {
    setError(null);
    setValues((v) => {
      const next = { ...v, ...changes };
      // A statement that can no longer be newly told (the retention back as it was) is unticked.
      const told = { ...next.told };
      for (const s of STATEMENTS) if (told[s] && !canTellOnAmend(record, next, s)) told[s] = false;
      return { ...next, told };
    });
  };

  const save = async () => {
    if (issues.length) return setError(issues[0].message);
    if (!values.reason.trim()) return setError('Say why consent changed, in the client’s words if you can.');
    let by = context.consultant;
    if (!by) {
      if (!name.trim()) return setError('Give your name, as the person recording the change.');
      by = await context.saveConsultant(name);
    }
    const problem = step(view.session, 'Amend the consent record', (ws) => amendConsentForm(ws, meeting.id, values, by, now()), {
      final: true,
    });
    if (problem) return setError(problem);
    onDone();
  };

  return (
    <form
      className="ws-consent-form"
      aria-label="Amend the consent record"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="ws-help">
        The record is locked, because it has been used. An amendment adds to it, dated and with the reason; the original stays as
        it was. Record what changed after you asked the client again.
      </p>

      <Section title={`What you told them since (wording ${CURRENT_WORDING})`} issues={at('told')}>
        <p className="ws-help">Tick each statement you have now said or sent to them, as it is written here.</p>
        {STATEMENTS.filter((s) => s !== 'processingExternal' || provider).map((s) => {
          const open = canTellOnAmend(record, values, s);
          return (
            <label key={s} className="ws-choice ws-statement">
              <input
                type="checkbox"
                checked={open ? values.told[s] : true}
                disabled={!open}
                onChange={(e) =>
                  update({
                    told: {
                      ...values.told,
                      [s]: e.target.checked,
                      ...(s === 'processingExternal' && { externalProvider: e.target.checked ? provider : null }),
                    },
                  })
                }
              />
              <span>
                <q>{wording.statement(s, { provider, retention: values.retention })}</q>
                {!open && <span className="ws-muted"> Told before.</span>}
                {open && toldBefore.has(s) && <span className="ws-muted"> Told before in other words.</span>}
              </span>
            </label>
          );
        })}
      </Section>

      <Section title="What they agree to now" issues={at('given')}>
        {declined && <p className="ws-help">Consent is now declined, so every answer is no.</p>}
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
          onChange={(kind) => update({ retention: kind === 'days' ? { kind, days: 30 } : { kind } })}
        >
          {values.retention.kind === 'days' && (
            <label className="ws-inline">
              <input
                className="ws-input ws-number"
                type="number"
                min={1}
                aria-label="Days the audio is kept"
                value={values.retention.days}
                onChange={(e) => update({ retention: { kind: 'days', days: Math.floor(Number(e.target.value)) } })}
              />
              days
            </label>
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
          if (kind === 'declined')
            update({
              outcome: { kind },
              given: { audioRecording: false, transcription: false, aiLocal: false, aiExternal: false, externalProvider: null },
            });
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

      <section className="ws-card ws-confirm" aria-labelledby={`${reasonId}-title`}>
        <h2 id={`${reasonId}-title`}>Why it changed</h2>
        <label className="ws-field">
          <span className="ws-label">Reason</span>
          <textarea className="ws-input" rows={3} value={values.reason} onChange={(e) => update({ reason: e.target.value })} />
        </label>
        {!context.consultant && (
          <label className="ws-field">
            <span className="ws-label">Your name (kept in settings)</span>
            <input className="ws-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <p className="ws-help">Once recorded, an amendment can’t be undone. If something is wrong, record another one.</p>
        {error && (
          <p className="ws-error" role="alert">
            {error}
          </p>
        )}
        <div className="ws-actions">
          <button type="submit" className="button primary">
            Record the change
          </button>
          <button type="button" className="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </section>
    </form>
  );
}
