import { useEffect, useRef, useState } from 'react';
import { ALT_KEY } from '../../app/actions';
import { Icon } from '../../ui/Icon';
import { addWavFile, discardStoredFile } from '../api';
import { canCapture, consentFor } from '../model/consent';
import { formatSize } from '../model/files';
import {
  addRecordingFile,
  DELETION_REASON_TEXT,
  MAX_ADDED_WAV_BYTES,
  recordingsOf,
  removeRecordings,
  type Recording,
} from '../model/recordings';
import type { Session } from '../model/types';
import {
  dismissRecording,
  isRecordingNow,
  startRecordingSession,
  stopRecording,
  useRecording,
  UNSAVED_MESSAGE,
  type ActiveRecording,
} from '../recording/recorder';
import type { ClientView } from './ClientFrame';
import { formatWhen } from './chrome';
import { DeleteDialog, FormDialog, NameField, nameFor } from './fields';
import { finalStep, now, permanentStep } from './steps';
import { useConsultant } from './useConsultant';
import { stopPlaying } from './transcription/player';

/** "12:04", or "1:02:03" past an hour: a recording's clock. */
export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

/** "1 h 4 min", "12 min 4 s", "45 s": a recording's length. */
export function formatLength(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

/** The key that stops a recording, as shown. */
export const STOP_KEY = `${ALT_KEY}+S`;

/** The microphone chosen, kept while the tab is open: null for the computer's default. */
let chosenMicrophone: string | null = null;

/** The microphones the browser offers. Their names show once the microphone has been allowed. */
function useMicrophones(active: boolean): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let current = true;
    const read = () =>
      navigator.mediaDevices.enumerateDevices().then(
        (all) => current && setDevices(all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default')),
        () => undefined,
      );
    void read();
    navigator.mediaDevices.addEventListener?.('devicechange', read);
    return () => {
      current = false;
      navigator.mediaDevices.removeEventListener?.('devicechange', read);
    };
  }, [active]);
  return devices;
}

/** The microphone's level, as a meter: in words for screen readers, and as a bar. */
export function LevelMeter({ level, compact }: { level: number; compact?: boolean }) {
  const percent = Math.round(Math.min(1, level) * 100);
  return (
    <span
      className={`ws-level${compact ? ' is-compact' : ''}`}
      role="meter"
      aria-label="Microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={percent < 2 ? 'silent' : `${percent}%`}
    >
      <span className="ws-level-bar" style={{ width: `${percent}%` }} />
    </span>
  );
}

/**
 * A session's recordings (Phase 3 brief, decisions 12 to 15): Record, or why
 * not; the microphone and its level; the recording going, with Stop; and the
 * recordings made, each of which can be deleted. Recording happens in the
 * room; an online meeting's transcript is imported instead (decision 14).
 */
export function RecordingsCard({ view, meeting, href }: { view: ClientView; meeting: Session; href: string }) {
  const { workspace, readOnly, session } = view;
  const recording = useRecording();
  const consultant = useConsultant();
  const recordings = recordingsOf(workspace, meeting.id);
  const allowed = canCapture(workspace, meeting.id, 'recording');
  const locked = !!consentFor(workspace, meeting.id)?.lockedAt;
  const here = recording?.companyId === session.companyId && recording.sessionId === meeting.id ? recording : null;
  const recordingHere = isRecordingNow(here);
  const elsewhere = isRecordingNow(recording) && !here ? recording : null;
  const microphones = useMicrophones(recordingHere);
  const [microphone, setMicrophone] = useState<string | null>(chosenMicrophone);
  const [confirm, setConfirm] = useState<'record' | 'add' | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Recording | null>(null);
  const [adding, setAdding] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);

  // Once it records, Stop has focus: one key (Enter or Space) away, as Alt+S is from anywhere.
  useEffect(() => {
    if (here?.state === 'recording') stopButton.current?.focus();
  }, [here?.state]);

  const record = async (typedName: string) => {
    setError(null);
    const by = await nameFor(consultant, typedName);
    if (!by) return setError('Give your name first: a recording records who made it.');
    setStarting(true);
    const problem = await startRecordingSession(session, meeting, href, by, microphone);
    setStarting(false);
    setConfirm(null);
    if (problem) setError(problem);
  };

  const addWav = async (file: File, typedName: string) => {
    setError(null);
    if (!/\.wav$/i.test(file.name))
      return setError('StyleCode adds WAV files only. Convert the recording to WAV first: M4A, MP3 and MP4 can’t be read yet.');
    if (file.size > MAX_ADDED_WAV_BYTES) return setError('The file is too large. The limit is 2 GB.');
    const by = await nameFor(consultant, typedName);
    if (!by) return setError('Give your name first: a recording records who added it.');
    setAdding(true);
    try {
      const stored = await addWavFile(session.companyId, file);
      const problem = await finalStep(session, 'Add a recording', (ws) => {
        const added = addRecordingFile(
          ws,
          meeting.id,
          { id: stored.id, name: file.name, durationMs: stored.durationMs, sizeBytes: stored.sizeBytes },
          by,
          now(),
        );
        return added.ok ? { ok: true, value: added.value.workspace } : added;
      });
      if (problem) {
        await discardStoredFile(session.companyId, stored.id).catch(() => undefined);
        setError(problem);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const pickWav = () => fileInput.current?.click();
  const canStart = !readOnly && allowed.ok && !isRecordingNow(recording) && !starting;

  return (
    <section className="ws-card" aria-labelledby="recordings-title">
      <div className="ws-card-head">
        <h2 id="recordings-title">Recordings</h2>
        {canStart && (
          <div className="ws-actions">
            <button
              type="button"
              className="button"
              disabled={adding}
              onClick={() => (locked && consultant.name ? pickWav() : setConfirm('add'))}
            >
              {adding ? 'Adding…' : 'Add a WAV file…'}
            </button>
            <button
              type="button"
              className="button primary"
              onClick={() => (locked && consultant.name ? void record('') : setConfirm('record'))}
            >
              <Icon name="mic" size={14} /> Record
            </button>
          </div>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void addWav(file, '');
        }}
      />

      {!readOnly && !allowed.ok && !recordingHere && recordings.length > 0 && (
        <p className="ws-help">Recording isn’t available: {lowerFirst(allowed.error)}</p>
      )}
      {elsewhere && !recordingHere && (
        <p className="ws-help">
          StyleCode is recording <a href={elsewhere.href}>{elsewhere.sessionTitle}</a>. Stop that recording before starting
          another.
        </p>
      )}

      {here && recordingHere && <LivePanel recording={here} stopButton={stopButton} />}
      {here && !recordingHere && here.message && (
        <div className={`ws-notice${here.state === 'failed' ? ' is-error' : ''}`} role="status">
          <p>{here.message}</p>
          <button type="button" className="button" onClick={dismissRecording}>
            OK
          </button>
        </div>
      )}
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}

      {canStart && (
        <div className="ws-field ws-microphone">
          <label className="ws-label" htmlFor={`mic-${meeting.id}`}>
            Microphone
          </label>
          <select
            id={`mic-${meeting.id}`}
            className="ws-input"
            value={microphone ?? ''}
            onChange={(e) => {
              chosenMicrophone = e.target.value || null;
              setMicrophone(chosenMicrophone);
            }}
          >
            <option value="">The computer’s default microphone</option>
            {microphones.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
          <p className="ws-help">
            Record meetings in the room. For an online meeting, import the transcript Teams, Zoom or Meet made instead: the
            microphone wouldn’t hear the other side.
          </p>
        </div>
      )}

      {recordings.length === 0 ? (
        !recordingHere && (
          <div className="ws-empty is-small">
            <p>
              {!readOnly && !allowed.ok
                ? `Recording isn’t available: ${lowerFirst(allowed.error)}`
                : meeting.deletedRecordings.length
                  ? 'No recordings kept.'
                  : 'No recordings yet.'}
            </p>
          </div>
        )
      ) : (
        <ul className="ws-list is-compact" aria-label="Recordings">
          {recordings.map((r) => (
            <RecordingRow
              key={r.id}
              recording={r}
              live={here?.fileId === r.id && recordingHere ? here : null}
              readOnly={readOnly}
              onRemove={() => setRemoving(r)}
            />
          ))}
        </ul>
      )}

      {meeting.deletedRecordings.length > 0 && <DeletedRecordings meeting={meeting} />}

      {confirm && (
        <LockDialog
          adding={confirm === 'add'}
          consultantNeeded={consultant}
          busy={starting}
          onClose={() => setConfirm(null)}
          locks={!locked}
          onConfirm={async (name) => {
            if (confirm === 'record') return record(name);
            if (!(await nameFor(consultant, name))) return setError('Give your name first: a recording records who added it.');
            setConfirm(null);
            pickWav();
          }}
        />
      )}
      {removing && (
        <DeleteDialog
          title="Delete recording…"
          onClose={() => setRemoving(null)}
          onDelete={async () => {
            const by = await consultant.current();
            if (!by) throw new Error('Give your name in Settings first: deleting a recording records who did it.');
            stopPlaying([removing.id]);
            await permanentStep(session, `Delete ${removing.name}`, (ws) =>
              removeRecordings(ws, [removing.id], 'consultant', by, now()),
            );
            setRemoving(null);
          }}
          what={
            <>
              <p>
                This deletes <strong>{removing.name}</strong> ({formatLength(removing.audio.durationMs)}, recorded{' '}
                {formatWhen(removing.audio.recordedAt)}). The session keeps a line saying when it was recorded, how long it was,
                and when you deleted it, but no sound.
              </p>
              <p>
                <strong>This can’t be undone,</strong> and the undo history is cleared.
              </p>
            </>
          }
        />
      )}
    </section>
  );
}

function LivePanel({
  recording,
  stopButton,
}: {
  recording: ActiveRecording;
  stopButton: React.RefObject<HTMLButtonElement | null>;
}) {
  const stopping = recording.state === 'stopping';
  return (
    <div className="ws-live" role="group" aria-label="Recording">
      <span className="ws-live-dot" aria-hidden="true" />
      <span className="ws-live-state">{stopping ? 'Stopping…' : recording.state === 'starting' ? 'Starting…' : 'Recording'}</span>
      <span className="ws-live-clock" aria-label={`Recorded so far: ${formatLength(recording.elapsedMs)}`}>
        {formatClock(recording.elapsedMs)}
      </span>
      <LevelMeter level={recording.level} />
      <button
        ref={stopButton}
        type="button"
        className="button stop-button"
        disabled={stopping}
        onClick={() => void stopRecording()}
        aria-keyshortcuts="Alt+S"
      >
        <Icon name="stop" size={14} /> Stop <kbd className="ws-kbd">{STOP_KEY}</kbd>
      </button>
      {recording.unsaved && (
        <p className="ws-live-unsaved" role="alert">
          <Icon name="warning" size={14} /> {UNSAVED_MESSAGE}
        </p>
      )}
      {recording.lowSpace && (
        <p className="ws-help ws-caution">
          Under 5 GB is free on this computer’s drive. An hour of recording takes about 115 MB.
        </p>
      )}
    </div>
  );
}

/**
 * What is kept of each deleted recording (decision 24): when it was recorded,
 * how long it was, and when, by whom and why it was deleted. No sound, no
 * words. The delete dialog promises this line.
 */
function DeletedRecordings({ meeting }: { meeting: Session }) {
  return (
    <div className="ws-deleted-recordings">
      <h3 id={`deleted-recordings-${meeting.id}`}>Deleted recordings</h3>
      <p className="ws-help">Only these lines are kept: no sound and no words.</p>
      <ul className="ws-list is-compact" aria-labelledby={`deleted-recordings-${meeting.id}`}>
        {meeting.deletedRecordings.map((d, i) => (
          <li key={i} className="ws-row is-static">
            <span className="ws-row-main">
              <span className="ws-row-title">
                Recorded {formatWhen(d.recordedAt)}, {formatLength(d.durationMs)}
              </span>
              <span className="ws-row-sub">
                Deleted {formatWhen(d.deletedAt)} by {d.deletedBy}. Why: {DELETION_REASON_TEXT[d.reason]}.
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecordingRow({
  recording: r,
  live,
  readOnly,
  onRemove,
}: {
  recording: Recording;
  live: ActiveRecording | null;
  readOnly: boolean;
  onRemove: () => void;
}) {
  const going = r.audio.state === 'recording';
  const facts = [
    `${r.audio.source === 'added' ? 'Added' : 'Recorded'} ${formatWhen(r.audio.recordedAt)}`,
    going ? (live ? `${formatLength(live.elapsedMs)} so far` : 'not finished') : formatLength(r.audio.durationMs),
    going ? null : formatSize(r.sizeBytes),
  ].filter(Boolean);
  return (
    <li className="ws-row is-static">
      <span className="ws-row-main">
        <span className="ws-row-title">{r.name}</span>
        <span className="ws-row-sub">{facts.join(' · ')}</span>
        {r.audio.recovered && (
          <span className="ws-row-sub">Recovered: StyleCode stopped while recording, so it keeps what reached the disk.</span>
        )}
        {going && !live && (
          <span className="ws-row-sub">
            Being recorded in another window, or left unfinished: it is finished when that stops.
          </span>
        )}
      </span>
      {r.audio.source === 'added' && <span className="ws-badge">WAV file</span>}
      {going && live && <span className="ws-badge is-live">Recording</span>}
      {!readOnly && !going && (
        <button
          type="button"
          className="icon-button"
          aria-label={`Delete ${r.name}`}
          data-tip="Delete"
          data-tip-side="left"
          onClick={onRemove}
        >
          <Icon name="trash" size={14} />
        </button>
      )}
    </li>
  );
}

/**
 * The first recording (or added WAV) locks the consent record (C4), so it is
 * confirmed once, as the import preview does for a transcript.
 */
function LockDialog({
  adding,
  locks,
  consultantNeeded,
  busy,
  onConfirm,
  onClose,
}: {
  adding: boolean;
  /** Whether this locks the consent record, or only asks for the consultant's name. */
  locks: boolean;
  consultantNeeded: ReturnType<typeof useConsultant>;
  busy: boolean;
  onConfirm: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  return (
    <FormDialog
      title={adding ? 'Add a recording' : 'Start recording'}
      submitLabel={adding ? 'Choose a WAV file…' : busy ? 'Starting…' : 'Start recording'}
      submitDisabled={busy}
      error={null}
      onClose={onClose}
      onSubmit={() => onConfirm(name)}
    >
      {locks && (
        <p className="ws-dialog-text">
          <strong>
            {adding ? 'Adding the first recording' : 'Starting the first recording'} locks this session’s consent record.
          </strong>{' '}
          After that it changes only by dated amendments, and this can’t be undone.
        </p>
      )}
      {!adding && (
        <p className="ws-dialog-text">
          The client can ask you to stop at any time. Stop is on every page while recording, and {STOP_KEY} stops it from anywhere
          in StyleCode.
        </p>
      )}
      <NameField consultant={consultantNeeded} value={name} onChange={setName} />
    </FormDialog>
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
