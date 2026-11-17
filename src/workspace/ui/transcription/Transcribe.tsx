import { useEffect, useMemo, useState } from 'react';
import { formatDuration } from '../../extraction/estimate';
import { canUseAi } from '../../model/consent';
import {
  addRecordedTranscript,
  deletesOnAdding,
  recordingsOf,
  speakerWarning,
  talkTimes,
  transcribedBy,
  type Recording,
} from '../../model/recordings';
import { findingsQuotingTranscript, transcriptOf } from '../../model/transcripts';
import type { Participant, Session } from '../../model/types';
import { COOLING_UNTIL, coolingText } from '../../transcription/cooling';
import { estimate } from '../../transcription/estimate';
import { spanAt } from '../../transcription/play';
import type { JobResult, JobState, TranscriptionStatus } from '../../transcription/types';
import type { ClientView } from '../ClientFrame';
import { count } from '../chrome';
import { currentAiSetup } from '../extraction/aiSetup';
import { anyRunning } from '../extraction/runs';
import { DeleteDialog, FormDialog, NameField, nameFor } from '../fields';
import { formatLength } from '../RecordingsCard';
import { now } from '../steps';
import { useConsultant } from '../useConsultant';
import {
  addTranscription,
  cancelTranscribing,
  startTranscribingNow,
  discardTranscribing,
  dismissTranscribing,
  fetchResult,
  refreshTranscriptionStatus,
  startTranscribing,
  useTranscriptionStatus,
  type Transcribing,
} from './jobs';
import { playFrom, stopPlaying } from './player';
import { PlayerBar, RecordedSpeakerWarning, SpeakerList } from './Speakers';

/** What a transcription is doing, in words. */
const STEP_TEXT: Record<JobState, string> = {
  waiting: 'Waiting',
  preparing: 'Preparing the recordings',
  transcribing: 'Writing down what was said',
  speakers: 'Working out who spoke when',
  finishing: 'Putting words and speakers together',
  done: 'Ready',
  failed: 'Stopped',
  cancelled: 'Cancelled',
};

/** What a transcription waits for (decision 10), as said while it waits, and before it starts. */
const BUSY_NOW = { transcription: 'another transcription is running', extraction: 'the AI is reading a session' } as const;
const WHEN_DONE = {
  transcription: 'the other transcription has finished',
  extraction: 'the AI has finished reading a session',
} as const;

/** What adding does, as the preview says it and as "Add the transcript when it's ready" says it ahead (decision 18). */
function addingDoes(view: ClientView, meeting: Session): string[] {
  const ws = view.workspace;
  const lines: string[] = [];
  if (transcriptOf(ws, meeting.id)) {
    const quoting = findingsQuotingTranscript(ws, meeting.id).length;
    lines.push(
      quoting
        ? `It can’t replace the current transcript while ${count(quoting, 'finding')} in the record quote it.`
        : 'It replaces the current transcript, and any AI proposals that quote it.',
    );
  }
  lines.push(
    deletesOnAdding(ws, meeting.id, now())
      ? 'The recordings are deleted in the same step, as the client was told. The session keeps a line saying when.'
      : 'The recordings are kept, until the time the client agreed to.',
  );
  lines.push('Adding is permanent: it can’t be undone.');
  return lines;
}

/**
 * Transcribe… (decisions 17 and 18): which recordings, how long it should
 * take on this computer, whether it waits for another heavy job (decision
 * 10), and the two options: add the transcript when it's ready, and then ask
 * the AI for findings, where consent allows it.
 */
export function TranscribeDialog({
  view,
  meeting,
  status: initial,
  href,
  onClose,
}: {
  view: ClientView;
  meeting: Session;
  status: TranscriptionStatus;
  href: string;
  onClose: () => void;
}) {
  const consultant = useConsultant();
  // Asked again on opening, so it knows what is running on this computer now.
  const live = useTranscriptionStatus();
  const status = typeof live === 'object' && live ? live : initial;
  useEffect(() => void refreshTranscriptionStatus(), []);
  const recordings = recordingsOf(view.workspace, meeting.id).filter((r) => r.audio.state === 'finished');
  const audioMs = recordings.reduce((n, r) => n + r.audio.durationMs, 0);
  const guess = estimate(audioMs, status.speeds);
  const [autoAdd, setAutoAdd] = useState(false);
  const [thenAi, setThenAi] = useState(false);
  /** Whether the AI could be asked after adding: null while finding out, or why not. */
  const [ai, setAi] = useState<{ ok: true } | { ok: false; why: string } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const waitsFor = status.busy ? 'transcription' : (status.heavyNow ?? (anyRunning() ? 'extraction' : null));

  useEffect(() => {
    let current = true;
    void currentAiSetup().then((setup) => {
      if (!current) return;
      if (typeof setup === 'string') return setAi({ ok: false, why: setup });
      const allowed = canUseAi(view.workspace, meeting.id, setup.processing, now());
      setAi(allowed.ok ? { ok: true } : { ok: false, why: allowed.error });
    });
    return () => {
      current = false;
    };
  }, [view.workspace, meeting.id]);

  return (
    <FormDialog
      title="Transcribe the recordings"
      submitLabel="Transcribe"
      submitDisabled={!recordings.length}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        setError(null);
        let by: string | null = null;
        if (autoAdd) {
          by = await nameFor(consultant, name);
          if (!by) return setError('Give your name: a transcript records who added it.');
        }
        const problem = await startTranscribing(
          view.session,
          meeting,
          recordings.map((r) => r.id),
          autoAdd && by ? { by, thenAi: thenAi && ai?.ok === true, href } : null,
        );
        if (problem) return setError(problem);
        onClose();
      }}
    >
      <p className="ws-dialog-text">
        StyleCode transcribes {recordings.length === 1 ? 'the recording' : `the ${recordings.length} recordings, in order,`} on
        this computer, with {status.transcriber.name}, and works out who spoke when with {status.speakers.name}. Nothing is sent
        anywhere.
      </p>
      <ul className="ws-transcribe-list" aria-label="Recordings to transcribe">
        {recordings.map((r: Recording) => (
          <li key={r.id}>
            {r.name} <span className="ws-muted">· {formatLength(r.audio.durationMs)}</span>
          </li>
        ))}
      </ul>
      <p className="ws-dialog-text" data-testid="transcribe-estimate">
        {`It should take ${formatDuration(guess.totalMs)} for ${formatLength(audioMs)} of sound, ${
          status.speeds.length
            ? 'judging by earlier transcriptions on this computer'
            : 'judging by a test laptop: this computer hasn’t transcribed before'
        }. You can keep working, or leave this page: it carries on while StyleCode is open.`}
        {waitsFor ? ` It starts once ${WHEN_DONE[waitsFor]} on this computer: one heavy job runs at a time.` : ''}
      </p>
      <fieldset className="ws-field ws-fieldset">
        <legend className="ws-label">When it’s ready</legend>
        <label className="ws-choice">
          <input
            type="checkbox"
            checked={autoAdd}
            onChange={(e) => {
              setAutoAdd(e.target.checked);
              if (!e.target.checked) setThenAi(false);
            }}
          />
          Add the transcript when it’s ready
        </label>
        <p className="ws-help ws-choice-help">
          {autoAdd
            ? `Without a preview: ${addingDoes(view, meeting).join(' ')} Speakers are matched afterwards. Keep this page open until then.`
            : 'Otherwise you review it first: the speakers, the length, and what adding does.'}
        </p>
        {ai?.ok ? (
          <label className="ws-choice">
            <input type="checkbox" checked={thenAi} disabled={!autoAdd} onChange={(e) => setThenAi(e.target.checked)} />
            Then ask the AI for findings
          </label>
        ) : (
          ai && <p className="ws-help">The AI can’t be asked afterwards: {lowerFirst(ai.why)}</p>
        )}
      </fieldset>
      {autoAdd && <NameField consultant={consultant} value={name} onChange={setName} />}
    </FormDialog>
  );
}

/** "The client…" → "the client…", but "AI is…" stays as it is. */
const lowerFirst = (text: string) => (/^[A-Z][A-Z]/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1));
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A session's transcription: waiting, going (with progress and Cancel), ready, or how it ended. */
export function TranscribingPanel({ view, meeting, t }: { view: ClientView; meeting: Session; t: Transcribing }) {
  const [reviewing, setReviewing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const job = t.job;
  const going = !['done', 'failed', 'cancelled'].includes(job.state);
  useEffect(() => {
    if (!going) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 5000);
    return () => window.clearInterval(timer);
  }, [going]);

  if (going) {
    const percent = Math.round(job.progress * 100);
    const started = job.startedAt ? Date.now() - Date.parse(job.startedAt) : 0;
    const cooling = job.state === 'waiting' && job.coolingC !== null;
    // While the card cools, nothing has started: the time left is the whole estimate, so it counts the wait.
    const left = cooling ? job.estimateMs : job.state === 'waiting' ? null : Math.max(0, job.estimateMs - started);
    return (
      <div className="ws-transcribing" role="group" aria-label="Transcription">
        <div className="ws-transcribing-head">
          <p className="ws-transcribing-state" role="status">
            {cooling
              ? `${coolingText(job.coolingC!)}. ${COOLING_UNTIL}`
              : job.state === 'waiting'
                ? `Waiting: ${BUSY_NOW[job.waitingFor ?? 'transcription']} on this computer, and one heavy job runs at a time. Transcribing starts when it finishes.`
                : `Transcribing on this computer: ${STEP_TEXT[job.state].toLowerCase()}.`}
          </p>
          {cooling && (
            <button
              type="button"
              className="button"
              onClick={async () => setError(await startTranscribingNow(t))}
              aria-label="Don’t wait for the graphics card to cool"
            >
              Don’t wait
            </button>
          )}
          <button
            type="button"
            className="button"
            onClick={async () => setError(await cancelTranscribing(t))}
            aria-label="Cancel the transcription"
          >
            Cancel
          </button>
        </div>
        {job.state !== 'waiting' && (
          <div
            className="ws-progress"
            role="progressbar"
            aria-label="Transcription progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span className="ws-progress-bar" style={{ width: `${percent}%` }} />
          </div>
        )}
        <p className="ws-help">
          {left !== null ? `${capital(formatDuration(left))} left, for ${formatLength(job.audioMs)} of sound. ` : ''}
          {t.auto
            ? `The transcript is added when it’s ready${t.auto.thenAi ? ', then the AI is asked for findings' : ''}, while this page stays open.`
            : 'You can leave this page: it carries on while StyleCode is open, and waits here for you to review.'}
        </p>
        {error && (
          <p className="ws-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (t.adding === 'adding')
    return (
      <div className="ws-transcribing" role="status">
        <p>Adding the transcript…</p>
      </div>
    );

  if (job.state === 'done' && t.adding !== 'added')
    return (
      <div className="ws-transcribing is-ready" role="group" aria-label="Transcription">
        <p className="ws-transcribing-state" role="status">
          {t.message ?? `The transcript is ready: ${formatLength(job.audioMs)} of sound, transcribed on this computer.`}
        </p>
        <div className="ws-actions">
          <button type="button" className="button" onClick={() => setDiscarding(true)}>
            Discard…
          </button>
          <button type="button" className="button primary" onClick={() => setReviewing(true)}>
            Review and add…
          </button>
        </div>
        {error && (
          <p className="ws-error" role="alert">
            {error}
          </p>
        )}
        {reviewing && <TranscribedPreview view={view} meeting={meeting} t={t} onClose={() => setReviewing(false)} />}
        {discarding && (
          <DeleteDialog
            title="Discard the transcription…"
            what={
              <p>
                The transcription is deleted, and nothing is added to the session. The recordings stay, so you can transcribe them
                again.
              </p>
            }
            onClose={() => setDiscarding(false)}
            onDelete={async () => {
              const problem = await discardTranscribing(t);
              if (problem) throw new Error(problem);
            }}
          />
        )}
      </div>
    );

  // Ended: failed, cancelled, or added with something to say (the AI couldn't be asked).
  const text =
    t.message ??
    (job.state === 'cancelled'
      ? 'The transcription was cancelled. Nothing it made was kept.'
      : (job.error ?? 'The transcription stopped.'));
  return (
    <div className={`ws-notice${job.state === 'failed' ? ' is-error' : ''}`} role="status">
      <p>{text}</p>
      <button type="button" className="button" onClick={() => dismissTranscribing(t)}>
        OK
      </button>
    </div>
  );
}

/**
 * The preview before adding (decision 18, as changed at the WP3 check-ins):
 * the length, what made it, the speakers by talk time with the short labels
 * grouped, matching them now, playing a label's longest part while the
 * recordings are still here, the speakers not yet matched to anyone asked
 * (C11), and what adding does. Matches made here are kept when it's added.
 */
function TranscribedPreview({
  view,
  meeting,
  t,
  onClose,
}: {
  view: ClientView;
  meeting: Session;
  t: Transcribing;
  onClose: () => void;
}) {
  const consultant = useConsultant();
  const [result, setResult] = useState<JobResult | string | null>(null);
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetchResult(t).then(
      (r) => current && setResult(r),
      (e: Error) => current && setResult(e.message),
    );
    return () => {
      current = false;
    };
  }, [t]);

  const ready = typeof result === 'object' && result !== null ? result : null;
  // What adding would do, on the workspace as it is, without changing it: the speakers matched and the warning.
  const dryRun = useMemo(
    () =>
      ready &&
      addRecordedTranscript(
        view.workspace,
        meeting.id,
        {
          recordingIds: ready.recordingIds,
          segments: ready.segments,
          transcriber: ready.transcriber,
          speakers: ready.speakers,
          matches,
        },
        'preview',
        now(),
      ),
    [ready, view.workspace, meeting.id, matches],
  );
  const talk = useMemo(() => (ready ? talkTimes(ready.segments) : []), [ready]);
  const people: Participant[] = Object.values(view.workspace.participants)
    .filter((p) => p.sessionId === meeting.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const close = () => {
    stopPlaying(ready?.recordingIds);
    onClose();
  };

  return (
    <FormDialog
      title="Add the transcript"
      submitLabel="Add transcript"
      submitDisabled={!dryRun?.ok}
      error={error ?? (typeof result === 'string' ? result : dryRun && !dryRun.ok ? dryRun.error : null)}
      onClose={close}
      onSubmit={async () => {
        if (!ready) return;
        setError(null);
        const by = await nameFor(consultant, name);
        if (!by) return setError('Give your name: a transcript records who added it.');
        const problem = await addTranscription(view.session, meeting.id, ready, matches, by);
        if (problem) return setError(problem);
        stopPlaying(ready.recordingIds);
        onClose();
      }}
    >
      {!ready ? (
        typeof result !== 'string' && <p className="ws-dialog-text">Reading the transcription…</p>
      ) : (
        <section className="ws-preview" aria-label="What will be added">
          <dl className="ws-dl">
            <dt>Made by</dt>
            <dd>
              {transcribedBy({ kind: 'recording', recordings: [], transcriber: ready.transcriber, speakers: ready.speakers })}
            </dd>
            <dt>Length</dt>
            <dd>
              {formatLength(ready.audioMs)} of sound, from {count(ready.recordingIds.length, 'recording')};{' '}
              {count(ready.segments.length, 'segment')}
            </dd>
            <dt>Speakers</dt>
            <dd>{talk.length} labels, by how long each spoke</dd>
          </dl>
          {dryRun?.ok && (
            <RecordedSpeakerWarning
              warning={
                speakerWarning(dryRun.value.workspace, meeting.id) ?? {
                  main: [],
                  short: { labels: [], ms: 0 },
                  unnamedSpeakers: false,
                }
              }
              shortId="preview-short-labels"
              adding
            />
          )}
          <p className="ws-dialog-text">
            <strong>{addingDoes(view, meeting).join(' ')}</strong> No sound is kept in the transcript: only what was said, by
            which speaker and when, with the words the engine was unsure of marked “may be misheard”.
          </p>
          <PlayerBar companyId={view.session.companyId} fileIds={ready.recordingIds} />
          <SpeakerList
            talk={talk}
            segments={ready.segments}
            people={people}
            matchOf={(label) => matches[label] ?? null}
            onMatch={(label, participantId) =>
              setMatches((m) => {
                const next = { ...m };
                // One participant per label, and a label to one participant (MVP 4.3).
                if (participantId) next[label] = participantId;
                else delete next[label];
                return next;
              })
            }
            onPlay={(s) => {
              const segment = ready.segments[s.longest];
              const at = spanAt(ready.spans, segment.startMs);
              if (!at) return;
              const span = ready.spans.find((x) => x.fileId === at.fileId)!;
              void playFrom(view.session.companyId, at.fileId, at.atMs, span.offsetMs, `${s.label}’s longest part`);
            }}
            readOnly={false}
            shortId="preview-short-labels"
          />
        </section>
      )}
      <NameField consultant={consultant} value={name} onChange={setName} />
    </FormDialog>
  );
}

/** Why Transcribe isn't offered for a session that has recordings, or null when it is. */
export function transcribeUnavailable(
  status: TranscriptionStatus | string | null,
  why: string | null,
): { text: string; settings: boolean } | null {
  if (status === null) return null;
  if (typeof status === 'string') return { text: `Transcribing isn’t available: ${lowerFirst(status)}`, settings: false };
  if (!status.ready) return { text: `Transcribing isn’t available: ${lowerFirst(status.reason ?? '')}`, settings: true };
  if (why) return { text: `Transcribing isn’t available: ${lowerFirst(why)}`, settings: false };
  return null;
}
