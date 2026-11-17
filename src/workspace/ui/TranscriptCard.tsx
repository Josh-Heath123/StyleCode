import { Quoted } from './Quoted';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import { LAYOUT_LABELS, PLATFORM_LABELS, readPastedTranscript, readTranscriptFile, type TranscriptRead } from '../import/read';
import { canCapture } from '../model/consent';
import { isInRecord, keptFromSession } from '../model/findings';
import { recordingsOf, speakerWarning, talkTimes, transcribedBy } from '../model/recordings';
import { spanAt, spansOfSource } from '../transcription/play';
import { isJobOver } from '../transcription/types';
import { refreshTranscriptions, refreshTranscriptionStatus, useTranscribing, useTranscriptionStatus } from './transcription/jobs';
import { playFrom } from './transcription/player';
import { PlayerBar, RecordedSpeakerWarning, SpeakerList } from './transcription/Speakers';
import { TranscribeDialog, TranscribingPanel, transcribeUnavailable } from './transcription/Transcribe';
import {
  canReplaceTranscript,
  deleteTranscript,
  findingsQuotingTranscript,
  importTranscript,
  matchSpeaker,
  replaceTranscript,
  segmentsOf,
  speakerLabelsOf,
  speakerOf,
  transcriptOf,
  type TranscriptInput,
} from '../model/transcripts';
import {
  TRANSCRIPT_PLATFORMS,
  type CompanyWorkspace,
  type Participant,
  type Session,
  type Transcript,
  type TranscriptPlatform,
  type TranscriptSegment,
} from '../model/types';
import { currentTimeZone, get, type Result } from '../model/util';
import { formatOffset, formatTimeOfDay } from '../time';
import { useConsultant } from './useConsultant';
import type { ClientView } from './ClientFrame';
import { count, formatWhen } from './chrome';
import { DeleteDialog, DialogField, FormDialog, NameField, nameFor } from './fields';
import { KeptDialog } from './consent/KeptDialog';
import { now, permanentStep, step } from './steps';

export { formatOffset };

const SIDE_TEXT = { client: 'Client', consultant: 'Your side' } as const;

/** Consecutive segments by one speaker, shown together. */
function groupsOf(segments: readonly TranscriptSegment[]): TranscriptSegment[][] {
  const groups: TranscriptSegment[][] = [];
  for (const s of segments) {
    const last = groups.at(-1);
    if (last && last[0].speakerLabel === s.speakerLabel) last.push(s);
    else groups.push([s]);
  }
  return groups;
}

/**
 * A session's transcript (MVP story 4): importing one, or pasting it; the
 * transcript by speaker, with the speakers who weren't asked for consent
 * (rule C11); matching speakers to participants; replacing and deleting it.
 */
export function TranscriptCard({
  view,
  meeting,
  passageId,
  quoted,
}: {
  view: ClientView;
  meeting: Session;
  passageId: string | null;
  /** The passages the selected proposal quotes, with the words quoted from each. */
  quoted?: ReadonlyMap<string, readonly string[]>;
}) {
  const { workspace, readOnly, session } = view;
  const transcript = transcriptOf(workspace, meeting.id);
  const [dialog, setDialog] = useState<'import' | 'replace' | 'delete' | 'transcribe' | null>(null);
  /** After deleting: what keeps a statement from the session (decision 11), with the facts that lost their quotes. */
  const [review, setReview] = useState<string[] | null>(null);
  const allowed = canCapture(workspace, meeting.id, 'transcript-import');
  const replaceable = canReplaceTranscript(workspace, meeting.id);

  // Transcribing on this computer (Phase 3 brief, WP7): offered for a session with stopped recordings, when it's set up.
  const status = useTranscriptionStatus();
  const transcribing = useTranscribing(session.companyId, meeting.id);
  useEffect(() => {
    void refreshTranscriptionStatus();
    void refreshTranscriptions(session.companyId);
  }, [session.companyId]);
  const recordings = recordingsOf(workspace, meeting.id).filter((r) => r.audio.state === 'finished');
  const consented = canCapture(workspace, meeting.id, 'transcription');
  const blocked = !consented.ok ? consented.error : transcript && !replaceable.ok ? replaceable.error : null;
  const unavailable = recordings.length && !readOnly ? transcribeUnavailable(status, blocked) : null;
  const busy =
    !!transcribing &&
    (!isJobOver(transcribing.job.state) || (transcribing.job.state === 'done' && transcribing.adding !== 'added'));
  const canTranscribe =
    !readOnly && recordings.length > 0 && typeof status === 'object' && status?.ready === true && !blocked && !busy;

  return (
    <section className="ws-card" aria-labelledby="transcript-title">
      <div className="ws-card-head">
        <h2 id="transcript-title">Transcript</h2>
        {!readOnly && !transcript && (allowed.ok || canTranscribe) && (
          <div className="ws-actions">
            {canTranscribe && (
              <button type="button" className="button primary" onClick={() => setDialog('transcribe')}>
                <Icon name="mic" size={14} /> Transcribe…
              </button>
            )}
            {allowed.ok && (
              <button type="button" className={`button${canTranscribe ? '' : ' primary'}`} onClick={() => setDialog('import')}>
                <Icon name="plus" size={14} /> Import transcript…
              </button>
            )}
          </div>
        )}
        {!readOnly && transcript && (
          <div className="ws-actions">
            {canTranscribe && (
              <button type="button" className="button" onClick={() => setDialog('transcribe')}>
                Transcribe again…
              </button>
            )}
            {replaceable.ok && (
              <button type="button" className="button" onClick={() => setDialog('replace')}>
                Replace…
              </button>
            )}
            <button type="button" className="button danger" onClick={() => setDialog('delete')}>
              <Icon name="trash" size={14} /> Delete transcript…
            </button>
          </div>
        )}
      </div>
      {!readOnly && transcript && !replaceable.ok && (
        <p className="ws-help">Replacing it isn’t available: {lowerFirst(replaceable.error)}</p>
      )}
      {unavailable && !busy && (
        <p className="ws-help" data-testid="transcribe-unavailable">
          {unavailable.text}
          {unavailable.settings && (
            <>
              {' '}
              <a href="#/settings">Transcription in Settings</a>
            </>
          )}
        </p>
      )}
      {transcribing && <TranscribingPanel view={view} meeting={meeting} t={transcribing} />}
      {!transcript ? (
        !busy && (
          <div className="ws-empty is-small">
            <p>
              {canTranscribe
                ? 'No transcript yet. Transcribe the recordings on this computer, or import the one Teams, Zoom or Google Meet made.'
                : allowed.ok
                  ? 'No transcript yet. Import the one Teams, Zoom or Google Meet made, or paste it.'
                  : `Importing a transcript isn’t available: ${lowerFirst(allowed.error)}`}
            </p>
          </div>
        )
      ) : (
        <TranscriptView view={view} meeting={meeting} transcript={transcript} passageId={passageId} quoted={quoted} />
      )}
      {dialog === 'transcribe' && typeof status === 'object' && status && (
        <TranscribeDialog view={view} meeting={meeting} status={status} href={location.hash} onClose={() => setDialog(null)} />
      )}
      {(dialog === 'import' || dialog === 'replace') && (
        <ImportDialog view={view} meeting={meeting} replacing={dialog === 'replace'} onClose={() => setDialog(null)} />
      )}
      {dialog === 'delete' && transcript && (
        <DeleteTranscriptDialog
          view={view}
          meeting={meeting}
          onDeleted={(factIds) => {
            setDialog(null);
            const kept = keptFromSession(view.session.getState().workspace, meeting.id);
            if (kept.findings.length + kept.facts.length + factIds.length > 0) setReview(factIds);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {review && <KeptDialog view={view} meeting={meeting} factIds={review} onClose={() => setReview(null)} />}
    </section>
  );
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Where a transcript came from, in a line. */
function sourceLine(t: Transcript): string {
  if (t.source.kind === 'recording') return `${transcribedBy(t.source)}. Added by ${t.importedBy}, ${formatWhen(t.importedAt)}.`;
  const from =
    t.source.kind === 'pasted' ? 'Pasted' : `Imported from ${t.source.fileName} (${PLATFORM_LABELS[t.source.platform]})`;
  return `${from} by ${t.importedBy}, ${formatWhen(t.importedAt)}.`;
}

function SpeakerWarning({ transcript }: { transcript: Transcript }) {
  if (!transcript.unaskedSpeakers.length && !transcript.unnamedSpeakers) return null;
  return (
    <div className="ws-alert" role="note" aria-labelledby="c11-title">
      <h2 id="c11-title">
        {transcript.unaskedSpeakers.length
          ? `Not asked for consent: ${transcript.unaskedSpeakers.join(', ')}`
          : 'Some speakers couldn’t be checked'}
      </h2>
      <p>
        {transcript.unaskedSpeakers.length
          ? `${transcript.unaskedSpeakers.length === 1 ? 'This speaker' : 'These speakers'} didn’t match anyone asked for consent, or anyone on your side, when the transcript was imported. Check that they agreed before you use what they said.`
          : ''}
        {transcript.unnamedSpeakers ? ' Some lines have no speaker, so they couldn’t be checked.' : ''}
      </p>
    </div>
  );
}

function TranscriptView({
  view,
  meeting,
  transcript,
  passageId,
  quoted,
}: {
  view: ClientView;
  meeting: Session;
  transcript: Transcript;
  passageId: string | null;
  quoted?: ReadonlyMap<string, readonly string[]>;
}) {
  const ws = view.workspace;
  const segments = segmentsOf(ws, transcript.id);
  const recorded = transcript.source.kind === 'recording' ? transcript.source : null;
  const [matching, setMatching] = useState<string | null>(null);
  const name = (label: string | null) => {
    if (label === null) return { name: 'No speaker given', side: null };
    const p = speakerOf(ws, meeting.id, label);
    return p ? { name: p.name, side: SIDE_TEXT[p.side], label: p.name === label ? null : label } : { name: label, side: null };
  };
  // Play from here (decision 21): while the recordings it was made from are kept.
  const spans = recorded ? spansOfSource(recorded.recordings, recordingsOf(ws, meeting.id)) : [];
  const play = (startMs: number | null, what: string) => {
    const at = startMs === null ? null : spanAt(spans, startMs);
    if (!at) return null;
    const span = spans.find((s) => s.fileId === at.fileId)!;
    return () => void playFrom(view.session.companyId, at.fileId, at.atMs, span.offsetMs, what);
  };
  const warning = recorded ? speakerWarning(ws, meeting.id) : null;
  return (
    <>
      <p className="ws-help">
        {sourceLine(transcript)} {count(segments.length, 'segment')}.
        {recorded && segments.some((s) => s.unsureWords.length) && (
          <>
            {' '}
            Words the engine was unsure of are <span className="ws-unsure-sample">underlined with dots</span>: they may be
            misheard.
          </>
        )}
      </p>
      {recorded && warning ? (
        <RecordedSpeakerWarning warning={warning} shortId={`short-labels-${meeting.id}`} />
      ) : (
        <SpeakerWarning transcript={transcript} />
      )}
      {recorded ? (
        <RecordedSpeakers view={view} meeting={meeting} play={play} shortId={`short-labels-${meeting.id}`} />
      ) : (
        <SpeakerMatching view={view} meeting={meeting} />
      )}
      <PlayerBar companyId={view.session.companyId} fileIds={spans.map((s) => s.fileId)} />
      <div className="ws-transcript" aria-label="What was said" role="region">
        {groupsOf(segments).map((group) => {
          const label = group[0].speakerLabel;
          const who = name(label);
          return (
            <div key={group[0].id} className="ws-turn">
              <div className="ws-turn-head">
                <span className="ws-turn-speaker">{who.name}</span>
                {recorded && who.side && who.label && <span className="ws-muted">{who.label}</span>}
                {who.side ? (
                  <span className="ws-badge">{who.side}</span>
                ) : (
                  label !== null && <span className="ws-muted">not matched</span>
                )}
                {group[0].startMs !== null && <span className="ws-muted ws-turn-time">{formatOffset(group[0].startMs)}</span>}
                {recorded && label !== null && !view.readOnly && (
                  <button
                    type="button"
                    className="button is-small ws-turn-match"
                    aria-label={`Match “${label}” at ${formatOffset(group[0].startMs ?? 0)}…`}
                    onClick={() => setMatching(label)}
                  >
                    {who.side ? 'Change…' : 'Match…'}
                  </button>
                )}
              </div>
              {group.map((s) => {
                const playHere = recorded ? play(s.startMs, `from ${formatOffset(s.startMs ?? 0)}`) : null;
                return (
                  <p
                    key={s.id}
                    id={`passage-${s.id}`}
                    tabIndex={-1}
                    className={`ws-segment${s.id === passageId ? ' is-cited' : ''}${quoted?.has(s.id) ? ' is-quoted' : ''}${playHere ? ' has-play' : ''}`}
                  >
                    {playHere && (
                      <button
                        type="button"
                        className="icon-button ws-play-here"
                        aria-label={`Play from ${formatOffset(s.startMs ?? 0)}`}
                        data-tip="Play from here"
                        onClick={playHere}
                      >
                        <Icon name="play" size={12} />
                      </button>
                    )}
                    <Quoted text={s.text} quotes={quoted?.get(s.id)} unsure={recorded ? s.unsureWords : undefined} />
                  </p>
                );
              })}
            </div>
          );
        })}
      </div>
      {matching !== null && <MatchDialog view={view} meeting={meeting} label={matching} onClose={() => setMatching(null)} />}
    </>
  );
}

/**
 * A transcript made on this computer's speakers (decision 20, as changed at
 * the WP3 check-ins): by talk time, short labels grouped, each matched as an
 * ordinary undoable step, and a label's longest part played while the
 * recordings are kept.
 */
function RecordedSpeakers({
  view,
  meeting,
  play,
  shortId,
}: {
  view: ClientView;
  meeting: Session;
  play: (startMs: number | null, what: string) => (() => void) | null;
  shortId: string;
}) {
  const ws = view.workspace;
  const transcript = transcriptOf(ws, meeting.id)!;
  const segments = segmentsOf(ws, transcript.id);
  const talk = talkTimes(segments);
  const people = Object.values(ws.participants)
    .filter((p) => p.sessionId === meeting.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [error, setError] = useState<string | null>(null);
  const matched = talk.filter((t) => speakerOf(ws, meeting.id, t.label)).length;
  // Open while a speaker isn't matched when the page opens; after that, only the consultant opens or closes it.
  const [open, setOpen] = useState(() => matched < talk.length);
  if (!talk.length) return null;
  const canPlay = talk.some((t) => play(segments[t.longest].startMs, '') !== null);
  return (
    <details className="ws-speakers" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Speakers: {matched} of {talk.length} matched to participants
      </summary>
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
      <SpeakerList
        talk={talk}
        wordsOf={(label) =>
          segments
            .filter((s) => s.speakerLabel === label)
            .map((s) => s.text)
            .join(' ')
        }
        people={people}
        matchOf={(label) => speakerOf(ws, meeting.id, label)?.id ?? null}
        onMatch={(label, participantId) =>
          setError(step(view.session, `Match ${label}`, (w) => matchSpeaker(w, meeting.id, label, participantId)))
        }
        onPlay={
          canPlay
            ? (t) => {
                const go = play(segments[t.longest].startMs, `${t.label}’s longest part`);
                go?.();
              }
            : null
        }
        readOnly={view.readOnly}
        shortId={shortId}
      />
      <p className="ws-help">Matching says who said what. It doesn’t change who was asked for consent.</p>
    </details>
  );
}

/** Matching a label from one of its turns in the transcript (decision 20, as changed at WP3). */
function MatchDialog({
  view,
  meeting,
  label,
  onClose,
}: {
  view: ClientView;
  meeting: Session;
  label: string;
  onClose: () => void;
}) {
  const ws = view.workspace;
  const people = Object.values(ws.participants)
    .filter((p) => p.sessionId === meeting.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [choice, setChoice] = useState(speakerOf(ws, meeting.id, label)?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title={`Who is “${label}”?`}
      submitLabel="Match"
      error={error}
      onClose={onClose}
      onSubmit={() => {
        const problem = step(view.session, `Match ${label}`, (w) => matchSpeaker(w, meeting.id, label, choice || null));
        if (problem) return setError(problem);
        onClose();
      }}
    >
      <p className="ws-dialog-text">
        Every part of the transcript labelled “{label}” is matched. You can undo it, or change it in the speaker list.
      </p>
      <DialogField label="Participant">
        {(id) => (
          <select id={id} className="ws-input" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Not matched</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({SIDE_TEXT[p.side].toLowerCase()})
              </option>
            ))}
          </select>
        )}
      </DialogField>
    </FormDialog>
  );
}

/** Each speaker label, who it is, and a way to change it (MVP 4.3). An ordinary undoable step. */
function SpeakerMatching({ view, meeting }: { view: ClientView; meeting: Session }) {
  const ws = view.workspace;
  const labels = speakerLabelsOf(ws, meeting.id);
  const people = Object.values(ws.participants)
    .filter((p) => p.sessionId === meeting.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const [error, setError] = useState<string | null>(null);
  // Open while a speaker isn't matched when the page opens; after that, only the consultant opens or closes it.
  const [open, setOpen] = useState(() => labels.some((l) => !speakerOf(ws, meeting.id, l)));
  if (!labels.length) return null;
  return (
    <details className="ws-speakers" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Speakers: {labels.filter((l) => speakerOf(ws, meeting.id, l)).length} of {labels.length} matched to participants
      </summary>
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
      <table className="ws-speaker-table">
        <thead>
          <tr>
            <th scope="col">In the transcript</th>
            <th scope="col">Participant</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((label) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>
                <select
                  className="ws-input"
                  aria-label={`Who “${label}” is`}
                  disabled={view.readOnly}
                  value={speakerOf(ws, meeting.id, label)?.id ?? ''}
                  onChange={(e) =>
                    setError(
                      step(view.session, `Match ${label}`, (w) => matchSpeaker(w, meeting.id, label, e.target.value || null)),
                    )
                  }
                >
                  <option value="">Not matched</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({SIDE_TEXT[p.side].toLowerCase()})
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ws-help">Matching says who said what. It doesn’t change who was asked for consent.</p>
    </details>
  );
}

/** What importing would do, worked out on the current workspace without changing it, for the preview. */
function dryRun(ws: CompanyWorkspace, meeting: Session, input: TranscriptInput, replacing: boolean) {
  return replacing
    ? replaceTranscript(ws, meeting.id, input, 'preview', now())
    : importTranscript(ws, meeting.id, input, 'preview', now());
}

/**
 * Importing, or replacing, a transcript (MVP 4.1 and 4.2; decision 6). The
 * preview shows what was read before anything changes: the layout and
 * platform (which can be corrected), the segments and speakers, the speakers
 * who weren't asked (C11), and that this locks the consent record and can't
 * be undone.
 */
function ImportDialog({
  view,
  meeting,
  replacing,
  onClose,
}: {
  view: ClientView;
  meeting: Session;
  replacing: boolean;
  onClose: () => void;
}) {
  const consultant = useConsultant();
  const [source, setSource] = useState<'file' | 'paste'>('file');
  const [pasted, setPasted] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [read, setRead] = useState<Result<TranscriptRead> | null>(null);
  const [platform, setPlatform] = useState<TranscriptPlatform>('other');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reading = useRef(0);
  const context = { startsAt: meeting.startsAt, timeZone: meeting.timeZone };
  const quoting = replacing ? findingsQuotingTranscript(view.workspace, meeting.id).length : 0;

  const show = (result: Result<TranscriptRead>) => {
    setRead(result);
    if (result.ok) setPlatform(result.value.platform);
  };
  const choose = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const attempt = ++reading.current;
    setFileName(file.name);
    setRead(null);
    const result = await readTranscriptFile(file.name, new Uint8Array(await file.arrayBuffer()), context);
    if (attempt === reading.current) show(result);
  };
  const input = useMemo<TranscriptInput | null>(
    () =>
      read?.ok && (source === 'paste' || fileName)
        ? {
            source:
              source === 'paste' || read.value.format === null
                ? { kind: 'pasted' }
                : { kind: 'file', fileName: fileName!, format: read.value.format, platform },
            segments: read.value.segments,
          }
        : null,
    [read, source, fileName, platform],
  );
  // Not on every keystroke in the name field: only when what would be imported changes.
  const preview = useMemo(
    () => (input ? dryRun(view.workspace, meeting, input, replacing) : null),
    [input, view.workspace, meeting, replacing],
  );
  /** Switching between a file and pasted text drops what was read, and any file still being read. */
  const switchTo = (to: 'file' | 'paste') => {
    reading.current++;
    setSource(to);
    setRead(null);
    setFileName(null);
  };

  return (
    <FormDialog
      title={replacing ? 'Replace the transcript' : 'Import a transcript'}
      submitLabel={replacing ? 'Replace transcript' : 'Import transcript'}
      submitDisabled={!preview?.ok}
      error={error ?? (preview && !preview.ok ? preview.error : null)}
      onClose={onClose}
      onSubmit={async () => {
        if (!input) return;
        const by = await nameFor(consultant, name);
        if (!by) return setError('Give your name: a transcript records who imported it.');
        try {
          await permanentStep(view.session, replacing ? 'Replace the transcript' : 'Import a transcript', (ws) => {
            const result = replacing
              ? replaceTranscript(ws, meeting.id, input, by, now())
              : importTranscript(ws, meeting.id, input, by, now());
            return result.ok ? { ok: true, value: result.value.workspace } : result;
          });
          onClose();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      {quoting > 0 ? (
        <p className="ws-dialog-text">
          {quoting === 1 ? 'A finding in the record quotes' : `${quoting} findings in the record quote`} this transcript, so it
          can’t be replaced. Change their evidence first, or delete the transcript.
        </p>
      ) : (
        <>
          <fieldset className="ws-field ws-fieldset">
            <legend className="ws-label">The transcript</legend>
            <div className="ws-choices">
              <label className="ws-choice">
                <input type="radio" name="transcript-source" checked={source === 'file'} onChange={() => switchTo('file')} />A
                file from Teams, Zoom or Google Meet
              </label>
              <label className="ws-choice">
                <input type="radio" name="transcript-source" checked={source === 'paste'} onChange={() => switchTo('paste')} />
                Pasted text
              </label>
            </div>
          </fieldset>
          {source === 'file' ? (
            <DialogField label="File (.vtt, .docx or .txt)">
              {(id) => (
                <input
                  id={id}
                  type="file"
                  className="ws-input"
                  accept=".vtt,.docx,.txt,text/vtt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => void choose(e.target.files?.[0])}
                />
              )}
            </DialogField>
          ) : (
            <DialogField label="Transcript, one line per turn: “Name: words”">
              {(id) => (
                <textarea
                  id={id}
                  className="ws-input"
                  rows={8}
                  value={pasted}
                  onChange={(e) => {
                    setPasted(e.target.value);
                    show(readPastedTranscript(e.target.value, context));
                  }}
                />
              )}
            </DialogField>
          )}
          {read && !read.ok && (source === 'file' || pasted.trim()) && (
            <p className="ws-error" role="alert">
              {read.error} Nothing was imported.
            </p>
          )}
          {read?.ok && preview?.ok && (
            <Preview
              view={view}
              meeting={meeting}
              read={read.value}
              isFile={source === 'file'}
              platform={platform}
              onPlatform={setPlatform}
              speakers={preview.value.speakers}
              workspace={preview.value.workspace}
              removedProposals={'removedProposalIds' in preview.value ? (preview.value.removedProposalIds as string[]).length : 0}
              replacing={replacing}
            />
          )}
          <NameField consultant={consultant} value={name} onChange={setName} />
        </>
      )}
    </FormDialog>
  );
}

function Preview({
  meeting,
  read,
  isFile,
  platform,
  onPlatform,
  speakers,
  workspace,
  removedProposals,
  replacing,
}: {
  view: ClientView;
  meeting: Session;
  read: TranscriptRead;
  isFile: boolean;
  platform: TranscriptPlatform;
  onPlatform: (p: TranscriptPlatform) => void;
  speakers: { unaskedSpeakers: string[]; unnamedSpeakers: boolean };
  /** The workspace as it would be after importing, for who each speaker would be matched to. */
  workspace: CompanyWorkspace;
  removedProposals: number;
  replacing: boolean;
}) {
  const platformId = useId();
  const labels = [...new Set(read.segments.map((s) => s.speakerLabel).filter((l): l is string => l !== null))];
  const timed = read.segments.filter((s) => s.startMs !== null);
  // In the session's own zone, the one the file's times of day are read in (decision 18), named if it isn't this computer's.
  const startsAt = `${formatTimeOfDay(meeting.startsAt, meeting.timeZone)}${meeting.timeZone === currentTimeZone() ? '' : ` ${meeting.timeZone} time`}`;
  return (
    <section className="ws-preview" aria-label="What will be imported">
      <h3>What will be imported</h3>
      <dl className="ws-dl">
        <dt>Read as</dt>
        <dd>{LAYOUT_LABELS[read.layout]}</dd>
        {isFile && (
          <>
            <dt>
              <label htmlFor={platformId}>Platform</label>
            </dt>
            <dd>
              <select
                id={platformId}
                className="ws-input"
                value={platform}
                onChange={(e) => onPlatform(e.target.value as TranscriptPlatform)}
              >
                {TRANSCRIPT_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </select>
            </dd>
          </>
        )}
        <dt>Segments</dt>
        <dd>
          {timed.length > 0 && timed.length < read.segments.length
            ? // Only now and then, as in Google Meet's: a span from them would mislead.
              `${count(read.segments.length, 'segment')}; ${isFile ? PLATFORM_LABELS[platform] : 'the transcript'} gives a time only every few minutes`
            : read.segments.length}
          {timed.length > 0 &&
            timed.length === read.segments.length &&
            `, from ${formatOffset(timed[0].startMs!)} to ${formatOffset(timed.at(-1)!.endMs ?? timed.at(-1)!.startMs!)}`}
        </dd>
        <dt>Speakers</dt>
        <dd>
          <ul className="ws-preview-speakers">
            {labels.map((label) => {
              const p: Participant | null = speakerOf(workspace, meeting.id, label);
              return (
                <li key={label}>
                  {label} <span className="ws-muted">{p ? `· ${p.name}` : '· not matched'}</span>
                </li>
              );
            })}
          </ul>
        </dd>
        {read.times && (
          <>
            <dt>Times</dt>
            <dd>
              {read.times.from === 'session-start'
                ? `Times of day, from the session’s start: the first words at ${read.times.firstTime}, and the session starts at ${startsAt}.`
                : `The first time in the file, ${read.times.firstTime}, isn’t within a day after the session starts (${startsAt}), so times are measured from the first words. Check the session’s date and time.`}
            </dd>
          </>
        )}
      </dl>
      {(speakers.unaskedSpeakers.length > 0 || speakers.unnamedSpeakers) && (
        <div className="ws-alert" role="note">
          <h2>
            {speakers.unaskedSpeakers.length
              ? `Not asked for consent: ${speakers.unaskedSpeakers.join(', ')}`
              : 'Some speakers can’t be checked'}
          </h2>
          <p>
            {speakers.unaskedSpeakers.length
              ? 'They don’t match anyone asked for consent, or anyone on your side. You can still import; the warning stays on the transcript.'
              : ''}
            {speakers.unnamedSpeakers ? ' Some lines have no speaker, so they can’t be checked.' : ''}
          </p>
        </div>
      )}
      <p className="ws-dialog-text">
        <strong>
          {replacing
            ? `Replacing deletes the current transcript${removedProposals ? ` and ${count(removedProposals, 'AI proposal')} that quote it` : ''}. This can’t be undone.`
            : 'Importing locks the consent record, and can’t be undone.'}
        </strong>{' '}
        The file itself isn’t kept: only what was said, by whom and when.
      </p>
    </section>
  );
}

/**
 * Deleting the transcript (decision 6; rule C8): permanent, and it says what
 * goes and what keeps a statement. After a withdrawal it is offered first,
 * with `intro` saying why (decision 11), and `onDeleted` gets the company
 * facts that lost their quotes, for the review that follows.
 */
export function DeleteTranscriptDialog({
  view,
  meeting,
  intro,
  onDeleted,
  onClose,
}: {
  view: ClientView;
  meeting: Session;
  intro?: ReactNode;
  onDeleted?: (factIds: string[]) => void;
  onClose: () => void;
}) {
  const ws = view.workspace;
  const deletion = deleteTranscript(ws, meeting.id, now());
  // Rejected proposals are scrubbed too, but aren't part of the record, so they aren't counted.
  const inRecord = (ids: string[]) =>
    ids.filter((id) => {
      const f = get(ws.findings, id);
      return !!f && isInRecord(f);
    });
  const result = deletion.ok
    ? {
        ...deletion,
        value: {
          ...deletion.value,
          removedFindingIds: inRecord(deletion.value.removedFindingIds),
          keptFindingIds: inRecord(deletion.value.keptFindingIds),
        },
      }
    : deletion;
  const findings = (ids: string[]) => ids.map((id) => get(ws.findings, id)?.statement).filter(Boolean) as string[];
  const segments = transcriptOf(ws, meeting.id);
  return (
    <DeleteDialog
      title="Delete transcript…"
      onClose={onClose}
      onDelete={async () => {
        let factIds: string[] = [];
        await permanentStep(view.session, 'Delete the transcript', (w) => {
          const removal = deleteTranscript(w, meeting.id, now());
          if (removal.ok) factIds = removal.value.factIds;
          return removal.ok ? { ok: true, value: removal.value.workspace } : removal;
        });
        if (onDeleted) onDeleted(factIds);
        else onClose();
      }}
      what={
        result.ok && segments ? (
          <>
            {intro}
            <p>
              Every word of <strong>{meeting.title}</strong>’s transcript ({count(segmentsOf(ws, segments.id).length, 'segment')})
              is deleted, including the quotes taken from it. <strong>This can’t be undone.</strong>
            </p>
            {result.value.removedProposalIds.length > 0 && (
              <p>{count(result.value.removedProposalIds.length, 'AI proposal')} that quote it go too.</p>
            )}
            {result.value.removedFindingIds.length > 0 && (
              <>
                <p>Findings that rest only on it are removed:</p>
                <ul>
                  {findings(result.value.removedFindingIds).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {result.value.keptFindingIds.length + result.value.factIds.length > 0 && (
              <p>
                {count(result.value.keptFindingIds.length, 'finding')} and {count(result.value.factIds.length, 'company fact')}{' '}
                keep a statement from this session, without its quotes. You can review them next.
              </p>
            )}
          </>
        ) : (
          <p>{result.ok ? '' : result.error}</p>
        )
      }
    />
  );
}

/** Scrolls a cited passage into view and focuses it, once it's on the page (decision 16). */
export function usePassage(passageId: string | null) {
  useEffect(() => {
    if (!passageId) return;
    const el = document.getElementById(`passage-${passageId}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }, [passageId]);
}
