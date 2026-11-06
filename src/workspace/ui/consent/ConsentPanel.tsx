import { useState } from 'react';
import { consentFor, consentState } from '../../model/consent';
import { withdrawConsent } from '../../model/consentForm';
import type { ConsentRecord, Retention, Session } from '../../model/types';
import type { ClientView } from '../ClientFrame';
import { formatWhen } from '../chrome';
import { DialogField, FormDialog } from '../fields';
import { now, step } from '../steps';
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
    line = `Consent: withdrawn on ${formatWhen(withdrawal.at)}`;
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
        {canWithdraw && (
          <button type="button" className="button danger" onClick={() => setWithdrawing(true)}>
            Withdraw consent…
          </button>
        )}
      </div>
      {withdrawing && <WithdrawDialog view={view} meeting={meeting} onClose={() => setWithdrawing(false)} />}
    </section>
  );
}

/**
 * Records that the client withdrew consent, with the reason (rule C8). A
 * withdrawal is final (C4): it can't be undone, and it clears the undo history.
 */
function WithdrawDialog({ view, meeting, onClose }: { view: ClientView; meeting: Session; onClose: () => void }) {
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
        const problem = step(
          view.session,
          'Record the withdrawal of consent',
          (ws) => withdrawConsent(ws, meeting.id, reason, by, now()),
          { final: true },
        );
        if (problem) return setError(problem);
        onClose();
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
