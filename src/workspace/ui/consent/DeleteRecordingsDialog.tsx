import { useState, type ReactNode } from 'react';
import { deletionReasonFor, recordingsOf, removeRecordings, retentionOf, type Recording } from '../../model/recordings';
import type { Session } from '../../model/types';
import type { ClientView } from '../ClientFrame';
import { count, formatWhen } from '../chrome';
import { DeleteDialog, NameField, nameFor } from '../fields';
import { now, permanentStep } from '../steps';
import { stopPlaying } from '../transcription/player';
import { formatLength } from '../../time';
import { useConsultant } from '../useConsultant';

/** A session's recordings whose time is up now (decision 23): after a withdrawal, or an amendment that turned recording off or shortened how long it's kept. */
export function dueRecordings(view: ClientView, meeting: Session): Recording[] {
  const at = now();
  return recordingsOf(view.workspace, meeting.id).filter((r) => retentionOf(view.workspace, r, at).due !== null);
}

/**
 * Offers to delete a session's recordings that are past their time now
 * (decisions 23 and 25): after a withdrawal, first in its flow, or after an
 * amendment. Each keeps its line. Declining leaves them on the list shown at
 * start-up until they're gone.
 */
export function DeleteRecordingsDialog({
  view,
  meeting,
  intro,
  onDone,
  onClose,
}: {
  view: ClientView;
  meeting: Session;
  intro: ReactNode;
  onDone: () => void;
  onClose: () => void;
}) {
  const consultant = useConsultant();
  const [name, setName] = useState('');
  const due = dueRecordings(view, meeting);
  return (
    <DeleteDialog
      title={due.length === 1 ? 'Delete the recording…' : 'Delete the recordings…'}
      onClose={onClose}
      what={
        <>
          {intro}
          <ul className="ws-list is-compact" aria-label="Recordings past their time">
            {due.map((r) => (
              <li key={r.id} className="ws-row is-static">
                <span className="ws-row-main">
                  <span className="ws-row-title">{r.name}</span>
                  <span className="ws-row-sub">
                    Recorded {formatWhen(r.audio.recordedAt)} · {formatLength(r.audio.durationMs)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p>
            The session keeps a line for {due.length === 1 ? 'it' : 'each'}: when it was recorded, how long it was, and when, by
            whom and why it was deleted. No sound is kept. If you don’t delete {due.length === 1 ? 'it' : 'them'} now,{' '}
            {due.length === 1 ? 'it’s' : 'they’re'} listed each time StyleCode opens until {due.length === 1 ? 'it’s' : 'they’re'}{' '}
            gone.
          </p>
          <p>
            <strong>This can’t be undone,</strong> and the undo history is cleared.
          </p>
          <NameField consultant={consultant} value={name} onChange={setName} />
        </>
      }
      onDelete={async () => {
        const by = await nameFor(consultant, name);
        if (!by) throw new Error('Give your name: deleting a recording records who did it.');
        const at = now();
        stopPlaying(due.map((r) => r.id));
        await permanentStep(view.session, `Delete ${count(due.length, 'recording')}`, (ws) => {
          let next = ws;
          for (const r of due) {
            const why = retentionOf(next, r, at).due;
            const removed = removeRecordings(next, [r.id], why ? deletionReasonFor(why) : 'retention', by, at);
            if (!removed.ok) return removed;
            next = removed.value;
          }
          return { ok: true, value: next };
        });
        onDone();
      }}
    />
  );
}
