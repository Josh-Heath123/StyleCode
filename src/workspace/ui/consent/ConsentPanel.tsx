import { useState } from 'react';
import { consentFor, consentState } from '../../model/consent';
import { withdrawConsent } from '../../model/consentForm';
import { keptFromSession } from '../../model/findings';
import { transcriptOf } from '../../model/transcripts';
import type { ConsentRecord, Retention, Session } from '../../model/types';
import type { ClientView } from '../ClientFrame';
import { formatWhen } from '../chrome';
import { DialogField, FormDialog } from '../fields';
import { finalStep, now } from '../steps';
import { refreshTranscriptions } from '../transcription/jobs';
import { DeleteTranscriptDialog } from '../TranscriptCard';
import { KeptDialog } from './KeptDialog';
import { DeleteRecordingsDialog } from './DeleteRecordingsDialog';
import { recordingsOf } from '../../model/recordings';
import { stopRecording } from '../../recording/recorder';
import { useConsentContext } from './useConsentContext';

export function retentionSummary(r: Retention): string {
  return r.kind === 'days'
    ? `audio kept for ${r.days} ${r.days === 1 ? 'day' : 'days'}`
    : r.kind === 'until-engagement-ends'
      ? 'audio kept until the engagement ends'
      : 'audio deleted after transcription';
}

/** What a record allows now, in a line: "transcription, AI on this computer · audio kept until the engagement ends". */
function agreedSummary(record: ConsentRecord): string {
  const { given, retention } = consentState(record);
  const items = [
    given.audioRecording && 'audio recording',
    given.transcription && 'transcription',
    given.aiLocal && 'AI on this computer',
    given.aiExternal && `AI by ${given.externalProvider}`,
  ].filter(Boolean);
  if (!items.length) return 'nothing yet';
  return given.audioRecording ? `${items.join(', ')} · ${retentionSummary(retention)}` : items.join(', ');
}

/**
 * The session's consent, at the top of its page (CONSENT.md, "The
 * interface"): its state in a line, and the way forward.
 */
export function ConsentPanel({ view, meeting, formHref }: { view: ClientView; meeting: Session; formHref: string }) {
  const record = consentFor(view.workspace, meeting.id);
  const [withdrawing, setWithdrawing] = useState(false);
  /**
   * After a withdrawal (decision 25, and Phase 2's decision 11): first the
   * offer to delete the recordings, then the transcript, then the review of
   * what keeps a statement.
   */
  const [after, setAfter] = useState<{ step: 'recordings' } | { step: 'delete' } | { step: 'review'; factIds: string[] } | null>(
    null,
  );
  const hasRecordings = recordingsOf(view.workspace, meeting.id).some((r) => r.audio.state === 'finished');
  const afterRecordings = () =>
    hasTranscript
      ? setAfter({ step: 'delete' })
      : setAfter(kept.findings.length + kept.facts.length > 0 ? { step: 'review', factIds: [] } : null);
  const kept = keptFromSession(view.workspace, meeting.id);
  const hasTranscript = transcriptOf(view.workspace, meeting.id) !== null;
  const state = record?.confirmed ? consentState(record) : null;
  const withdrawal = record?.amendments.find((a) => a.kind === 'withdrawal');

  let line: string;
  let detail: string | null = null;
  if (!record) {
    line = 'Consent: not filled in';
    detail = 'Fill in the consent form once you have asked the client.';
  } else if (!record.confirmed) {
    line = 'Consent: not confirmed';
    detail = 'The form is saved as a draft. Until you confirm it, it allows nothing.';
  } else if (withdrawal) {
    line = `Consent: withdrawn on ${formatWhen(withdrawal.at, meeting.timeZone)}`;
    detail = `Reason: ${withdrawal.reason} Nothing more is captured or processed for this session.`;
  } else if (state?.outcome.kind === 'declined') {
    line = 'Consent: declined';
    detail = 'This session can only have notes, and the AI won’t process them.';
  } else {
    line = `Consent: ${state?.outcome.kind === 'limited' ? 'given with limits' : 'given'} · ${agreedSummary(record)}`;
    if (state?.outcome.kind === 'limited') detail = `Limits: ${state.outcome.limits}`;
  }
  const canEdit = !view.readOnly && !record?.lockedAt;
  const canWithdraw = !view.readOnly && !!record?.confirmed && !withdrawal && state?.outcome.kind !== 'declined';

  return (
    <section
      className="ws-consent"
      aria-labelledby="consent-line"
      data-state={withdrawal ? 'withdrawn' : record?.confirmed ? 'confirmed' : 'open'}
    >
      <div className="ws-consent-text">
        <h2 id="consent-line">{line}</h2>
        {detail && <p>{detail}</p>}
      </div>
      <div className="ws-consent-actions">
        {canEdit ? (
          <a className={`button${record ? '' : ' primary'}`} href={formHref}>
            {!record ? 'Fill in consent form' : record.confirmed ? 'Edit consent form' : 'Continue consent form'}
          </a>
        ) : (
          record && (
            <a className="button" href={formHref}>
              View consent record
            </a>
          )
        )}
        {withdrawal && !view.readOnly && kept.findings.length + kept.facts.length > 0 && (
          <button type="button" className="button" onClick={() => setAfter({ step: 'review', factIds: [] })}>
            Review what keeps a statement…
          </button>
        )}
        {canWithdraw && (
          <button type="button" className="button danger" onClick={() => setWithdrawing(true)}>
            Withdraw consent…
          </button>
        )}
      </div>
      {withdrawing && (
        <WithdrawDialog
          view={view}
          meeting={meeting}
          onClose={() => setWithdrawing(false)}
          onWithdrawn={() => {
            setWithdrawing(false);
            if (hasRecordings) setAfter({ step: 'recordings' });
            else afterRecordings();
          }}
        />
      )}
      {after?.step === 'recordings' && (
        <DeleteRecordingsDialog
          view={view}
          meeting={meeting}
          intro={
            <p>
              Consent is withdrawn, so recording is no longer agreed for this session. Delete its recordings now, as the client
              would expect.
            </p>
          }
          onDone={afterRecordings}
          onClose={afterRecordings}
        />
      )}
      {after?.step === 'delete' && (
        <DeleteTranscriptDialog
          view={view}
          meeting={meeting}
          intro={
            <p>
              Consent is withdrawn. If the client asks, delete the transcript too. Otherwise it stays, and what was there before
              the withdrawal can still be used.
            </p>
          }
          onDeleted={(factIds) => setAfter({ step: 'review', factIds })}
          onClose={() => setAfter(kept.findings.length + kept.facts.length > 0 ? { step: 'review', factIds: [] } : null)}
        />
      )}
      {after?.step === 'review' && (
        <KeptDialog view={view} meeting={meeting} factIds={after.factIds} onClose={() => setAfter(null)} />
      )}
    </section>
  );
}

/**
 * Records that the client withdrew consent, with the reason (rule C8). A
 * withdrawal is final (C4): it can't be undone, and it clears the undo history.
 */
function WithdrawDialog({
  view,
  meeting,
  onClose,
  onWithdrawn,
}: {
  view: ClientView;
  meeting: Session;
  onClose: () => void;
  onWithdrawn: () => void;
}) {
  const context = useConsentContext();
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title="Withdraw consent"
      submitLabel="Record the withdrawal"
      danger
      error={error}
      submitDisabled={!context}
      onClose={onClose}
      onSubmit={async () => {
        if (!context) return;
        if (!reason.trim()) return setError('Say why consent was withdrawn, in the client’s words if you can.');
        let by = context.consultant;
        if (!by) {
          if (!name.trim()) return setError('Give your name, as the person recording the withdrawal.');
          by = await context.saveConsultant(name);
        }
        // A withdrawal stops a recording first (C8), so what was recorded before it is kept whole.
        await stopRecording(
          { companyId: view.session.companyId, sessionId: meeting.id },
          'Consent was withdrawn, so the recording stopped.',
        );
        const problem = await finalStep(view.session, 'Record the withdrawal of consent', (ws) =>
          withdrawConsent(ws, meeting.id, reason, by, now()),
        );
        if (problem) return setError(problem);
        // A transcription of the session is cancelled, and a result waiting is discarded (decisions 16 and 25).
        void refreshTranscriptions(view.session.companyId);
        onWithdrawn();
      }}
    >
      <p className="ws-dialog-text">
        From now on nothing more is captured or processed by the AI for <strong>{meeting.title}</strong>. A withdrawal is final:
        if the client agrees again, that is a new session with its own consent form. <strong>This can’t be undone,</strong> and
        the undo history is cleared.
      </p>
      <DialogField label="Reason">
        {(id) => <textarea id={id} className="ws-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </DialogField>
      {context && !context.consultant && (
        <DialogField label="Your name">
          {(id) => <input id={id} className="ws-input" value={name} onChange={(e) => setName(e.target.value)} />}
        </DialogField>
      )}
    </FormDialog>
  );
}
