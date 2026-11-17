/**
 * A session's recordings (Workspace Phase 3; docs/phase-3/PHASE-3-BRIEF.md,
 * decisions 12 to 25, as changed at the WP3 check-ins). Pure, like the rest
 * of the model.
 *
 * The sound itself is written by the local server, as it arrives; the
 * workspace lists each recording as a FileRef with `audio` details. Starting,
 * finishing, adding and deleting a recording, and adding a transcript made
 * from recordings, are permanent: the app saves each one straight away and
 * clears the undo history, as it does for files and transcripts, so no undo
 * can bring back a recording's entry after its sound was deleted.
 */
import { canCapture, checkSpeakers, consentFor, consentState, lockConsent, type SpeakerCheck } from './consent.ts';
import {
  canReplaceTranscript,
  deleteTranscript,
  insertTranscript,
  matchSpeaker,
  segmentsOf,
  transcriptOf,
} from './transcripts.ts';
import type { Imported, ScoredSegment } from './transcripts.ts';
import type {
  AudioDetails,
  CompanyWorkspace,
  DeletedRecording,
  DeletionReason,
  EngineUsed,
  FileRef,
  RecordingSettings,
  Session,
  Timestamp,
  TranscriptSource,
} from './types.ts';
import { fail, get, isNonEmptyText, isValidId, ok, time, type Result } from './util.ts';

/** The longest recording, and the longest WAV that can be added (decisions 13 and 15). */
export const MAX_RECORDING_MS = 4 * 60 * 60 * 1000;
/** The largest WAV that can be added, before it is converted (decision 15). */
export const MAX_ADDED_WAV_BYTES = 2 * 1024 * 1024 * 1024;
/** What StyleCode records, and what an added WAV is converted to: 16 kHz mono 16-bit (decision 12). */
export const RECORDING_SAMPLE_RATE = 16_000;
/** The bytes of one second of a recording. */
export const RECORDING_BYTES_PER_SECOND = RECORDING_SAMPLE_RATE * 2;
/** In a room there's no far end to cancel, and noise suppression can clip quiet speech (decision 12). */
export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
};
/** A recording under "deleted after transcription" is listed when it is still here a day after it was made (decision 22). */
export const TRANSCRIBE_WITHIN_MS = 24 * 60 * 60 * 1000;

/** A file that is a recording, with its details. */
export type Recording = FileRef & { audio: AudioDetails };

export const isRecording = (f: FileRef | undefined): f is Recording => !!f && f.purpose === 'audio' && !!f.audio;

/** A session's recordings, oldest first. */
export function recordingsOf(ws: CompanyWorkspace, sessionId: string): Recording[] {
  const session = get(ws.sessions, sessionId);
  if (!session) return [];
  return session.audioFileIds.map((id) => get(ws.files, id)).filter(isRecording);
}

/** The session's recording that is still going, if there is one. */
export function recordingInProgress(ws: CompanyWorkspace, sessionId: string): Recording | null {
  return recordingsOf(ws, sessionId).find((r) => r.audio.state === 'recording') ?? null;
}

/** "Recording 3": numbered across the session's recordings, deleted ones included, so a name is never reused. */
function nextName(session: Session): string {
  return `Recording ${session.audioFileIds.length + session.deletedRecordings.length + 1}`;
}

function withRecording(ws: CompanyWorkspace, session: Session, file: Recording, consentLockedAt: Timestamp): CompanyWorkspace {
  const record = consentFor(ws, session.id)!;
  const locked = lockConsent(record, consentLockedAt);
  return {
    ...ws,
    consents: locked.ok ? { ...ws.consents, [record.id]: locked.value } : ws.consents,
    sessions: { ...ws.sessions, [session.id]: { ...session, audioFileIds: [...session.audioFileIds, file.id] } },
    files: { ...ws.files, [file.id]: file },
  };
}

/**
 * Starts a recording (decision 13): it needs consent to audio recording (C1),
 * and locks the consent record if it isn't locked yet (C4). A session records
 * one at a time. The file starts empty and grows as the server writes the
 * sound; `finishRecording` closes it.
 */
export function startRecording(
  ws: CompanyWorkspace,
  sessionId: string,
  recording: { id: string; settings: RecordingSettings },
  by: string,
  at: Timestamp,
): Result<{ workspace: CompanyWorkspace; file: Recording }> {
  const allowed = canCapture(ws, sessionId, 'recording', at);
  if (!allowed.ok) return allowed;
  if (!isNonEmptyText(by)) return fail('Give your name in Settings first: a recording records who made it.');
  if (!isValidId(recording.id) || get(ws.files, recording.id))
    return fail('The recording can’t start: its id is missing or already used.');
  if (recordingInProgress(ws, sessionId)) return fail('This session is already recording.');
  const session = get(ws.sessions, sessionId)!;
  const file: Recording = {
    id: recording.id,
    owner: { kind: 'session', sessionId },
    purpose: 'audio',
    name: nextName(session),
    mediaType: 'audio/wav',
    sizeBytes: 0,
    addedBy: by.trim(),
    addedAt: at,
    audio: {
      source: 'recorded',
      recordedAt: at,
      state: 'recording',
      durationMs: 0,
      sampleRate: RECORDING_SAMPLE_RATE,
      settings: { ...recording.settings },
      recovered: false,
      transcribedAt: null,
    },
  };
  return ok({ workspace: withRecording(ws, session, file, at), file });
}

/** How long a recording's sound is, from the bytes the server wrote (after the 44-byte header). */
export function durationOfBytes(soundBytes: number): number {
  return Math.floor((Math.max(0, soundBytes) / RECORDING_BYTES_PER_SECOND) * 1000);
}

/**
 * Finishes a recording when it is stopped, reaches its limit, or is found
 * unfinished at start-up (`recovered`), with what the server wrote.
 */
export function finishRecording(
  ws: CompanyWorkspace,
  fileId: string,
  finished: { durationMs: number; sizeBytes: number; recovered: boolean },
): Result<CompanyWorkspace> {
  const file = get(ws.files, fileId);
  if (!isRecording(file)) return fail('The recording does not exist.');
  if (file.audio.state !== 'recording') return fail('The recording has already stopped.');
  if (!Number.isInteger(finished.durationMs) || finished.durationMs < 0 || finished.durationMs > MAX_RECORDING_MS)
    return fail('A recording is at most 4 hours long.');
  if (!Number.isInteger(finished.sizeBytes) || finished.sizeBytes < 0) return fail('The recording has an invalid size.');
  const next: Recording = {
    ...file,
    sizeBytes: finished.sizeBytes,
    audio: { ...file.audio, state: 'finished', durationMs: finished.durationMs, recovered: finished.recovered },
  };
  return ok({ ...ws, files: { ...ws.files, [fileId]: next } });
}

/**
 * Adds a WAV made elsewhere, already converted to 16 kHz mono by the server
 * (decision 15). It needs the same consent as recording (C1) and locks the
 * consent record in the same way (C4).
 */
export function addRecordingFile(
  ws: CompanyWorkspace,
  sessionId: string,
  added: { id: string; name: string; durationMs: number; sizeBytes: number },
  by: string,
  at: Timestamp,
): Result<{ workspace: CompanyWorkspace; file: Recording }> {
  const allowed = canCapture(ws, sessionId, 'recording', at);
  if (!allowed.ok) return allowed;
  if (!isNonEmptyText(by)) return fail('Give your name in Settings first: a recording records who added it.');
  if (!isValidId(added.id) || get(ws.files, added.id)) return fail('The file can’t be added: its id is missing or already used.');
  if (!isNonEmptyText(added.name)) return fail('A file needs a name.');
  if (!Number.isInteger(added.durationMs) || added.durationMs <= 0) return fail('The file has no sound in it.');
  if (added.durationMs > MAX_RECORDING_MS) return fail('A recording is at most 4 hours long.');
  const session = get(ws.sessions, sessionId)!;
  const file: Recording = {
    id: added.id,
    owner: { kind: 'session', sessionId },
    purpose: 'audio',
    name: added.name.trim(),
    mediaType: 'audio/wav',
    sizeBytes: added.sizeBytes,
    addedBy: by.trim(),
    addedAt: at,
    audio: {
      source: 'added',
      recordedAt: at,
      state: 'finished',
      durationMs: added.durationMs,
      sampleRate: RECORDING_SAMPLE_RATE,
      settings: null,
      recovered: false,
      transcribedAt: null,
    },
  };
  return ok({ workspace: withRecording(ws, session, file, at), file });
}

/** Why a recording was deleted, as its kept line says it (decision 24), on screen and in the export. */
export const DELETION_REASON_TEXT: Record<DeletionReason, string> = {
  transcribed: 'after transcription, as the client was told',
  retention: 'its time was up',
  withdrawal: 'the client withdrew consent',
  consultant: 'the consultant deleted it',
};

/**
 * Deletes recordings, permanently, keeping a line for each (decision 24). A
 * recording still going is stopped first. The server deletes the sound when
 * the save is written.
 */
export function removeRecordings(
  ws: CompanyWorkspace,
  fileIds: readonly string[],
  reason: DeletionReason,
  by: string,
  at: Timestamp,
): Result<CompanyWorkspace> {
  if (!isNonEmptyText(by)) return fail('Give your name in Settings first: deleting a recording records who did it.');
  const files = { ...ws.files };
  const sessions = { ...ws.sessions };
  for (const id of new Set(fileIds)) {
    const file = get(files, id);
    if (!isRecording(file) || file.owner.kind !== 'session') return fail('The recording does not exist.');
    if (file.audio.state === 'recording') return fail('Stop the recording first.');
    const session = get(sessions, file.owner.sessionId);
    if (!session) return fail('The recording’s session does not exist.');
    const line: DeletedRecording = {
      recordedAt: file.audio.recordedAt,
      durationMs: file.audio.durationMs,
      deletedAt: at,
      deletedBy: by.trim(),
      reason,
    };
    sessions[session.id] = {
      ...session,
      audioFileIds: session.audioFileIds.filter((f) => f !== id),
      deletedRecordings: [...session.deletedRecordings, line],
    };
    delete files[id];
  }
  return ok({ ...ws, files, sessions });
}

/** What a transcript made from recordings brings: the segments, what made them, and the speakers already matched in the preview. */
export interface RecordedTranscriptInput {
  /** The recordings it was made from, in the order they were transcribed. */
  recordingIds: readonly string[];
  segments: readonly ScoredSegment[];
  transcriber: EngineUsed;
  speakers: EngineUsed | null;
  /** Speaker labels the consultant matched in the preview, to participant ids (decision 20, as changed at WP3). */
  matches: Readonly<Record<string, string>>;
}

export interface RecordedTranscriptAdded extends Imported {
  /** The recordings deleted in the same step, because the client was told they would be (decision 22). */
  deletedRecordingIds: string[];
  /** Proposals under review that quoted the transcript it replaced. */
  removedProposalIds: string[];
}

const engineOk = (e: EngineUsed | null) =>
  !!e && isNonEmptyText(e.name) && isNonEmptyText(e.version) && e.models.length > 0 && e.models.every(isNonEmptyText);

/**
 * Adds a transcript made on this computer from a session's recordings
 * (decisions 18 and 22). Like an import, it needs consent to transcription
 * now (C1, C8). A session that has a transcript has it replaced, under Phase
 * 2's rules (MVP Q10). The preview's speaker matches are kept.
 *
 * When the client was told the recordings are deleted after transcription,
 * the same step deletes the ones it was made from, so the transcript and the
 * sound are never kept together (C10). Otherwise each is marked transcribed.
 */
export function addRecordedTranscript(
  ws: CompanyWorkspace,
  sessionId: string,
  input: RecordedTranscriptInput,
  by: string,
  at: Timestamp,
): Result<RecordedTranscriptAdded> {
  if (!get(ws.sessions, sessionId)) return fail('The session does not exist.');
  if (!input.recordingIds.length) return fail('Choose the recordings the transcript was made from.');
  const recordings: Recording[] = [];
  for (const id of input.recordingIds) {
    const file = get(ws.files, id);
    if (!isRecording(file) || file.owner.kind !== 'session' || file.owner.sessionId !== sessionId)
      return fail('A recording the transcript was made from is no longer in this session.');
    if (file.audio.state !== 'finished') return fail('A recording the transcript was made from hasn’t stopped.');
    recordings.push(file);
  }
  if (new Set(input.recordingIds).size !== input.recordingIds.length) return fail('A recording is named twice.');
  if (!engineOk(input.transcriber) || (input.speakers !== null && !engineOk(input.speakers)))
    return fail('The transcript doesn’t say what made it.');

  let base = ws;
  let removedProposalIds: string[] = [];
  if (transcriptOf(ws, sessionId)) {
    const replaceable = canReplaceTranscript(ws, sessionId);
    if (!replaceable.ok) return replaceable;
    const deleted = deleteTranscript(ws, sessionId, at);
    if (!deleted.ok) return deleted;
    base = deleted.value.workspace;
    removedProposalIds = deleted.value.removedProposalIds;
  }

  const source: TranscriptSource = {
    kind: 'recording',
    recordings: recordings.map((r) => ({ recordedAt: r.audio.recordedAt, durationMs: r.audio.durationMs })),
    transcriber: { ...input.transcriber, models: [...input.transcriber.models] },
    speakers: input.speakers && { ...input.speakers, models: [...input.speakers.models] },
  };
  const labels = new Set(input.segments.map((s) => s.speakerLabel?.trim()).filter(isNonEmptyText));
  const inserted = insertTranscript(base, sessionId, source, input.segments, by, at, (participants) => {
    const matched: string[] = [];
    for (const [label, participantId] of Object.entries(input.matches)) {
      if (!labels.has(label)) continue;
      const step = matchSpeaker({ ...base, participants }, sessionId, label, participantId);
      if (!step.ok) return step;
      Object.assign(participants, step.value.participants);
      matched.push(label);
    }
    return ok(matched);
  });
  if (!inserted.ok) return inserted;

  const record = consentFor(ws, sessionId)!;
  const ids = recordings.map((r) => r.id);
  if (consentState(record, at).retention.kind === 'delete-after-transcription') {
    const removed = removeRecordings(inserted.value.workspace, ids, 'transcribed', by, at);
    if (!removed.ok) return removed;
    return ok({ ...inserted.value, workspace: removed.value, deletedRecordingIds: ids, removedProposalIds });
  }
  const files = { ...inserted.value.workspace.files };
  for (const r of recordings) files[r.id] = { ...r, audio: { ...r.audio, transcribedAt: at } };
  return ok({
    ...inserted.value,
    workspace: { ...inserted.value.workspace, files },
    deletedRecordingIds: [],
    removedProposalIds,
  });
}

/** Whether adding a transcript now would delete the recordings, because the client was told so (decision 18's preview). */
export function deletesOnAdding(ws: CompanyWorkspace, sessionId: string, at?: Timestamp): boolean {
  const record = consentFor(ws, sessionId);
  return !!record && consentState(record, at).retention.kind === 'delete-after-transcription';
}

// ---------------------------------------------------------------------------
// Speakers (decision 20, as changed at the WP3 check-ins)
// ---------------------------------------------------------------------------

/** A label holding less talk than this is "short": grouped in the list, and summed up in the warning. */
export const SHORT_LABEL_MS = 30_000;

export interface SpeakerTalk {
  label: string;
  /** Total time of the label's segments. */
  ms: number;
  segments: number;
  /** The label's longest segment's position in the list given, to play or read it. */
  longest: number;
}

/** Each speaker label's talk time, most first; labels with no times count as none. */
export function talkTimes(
  segments: readonly { speakerLabel: string | null; startMs: number | null; endMs: number | null }[],
): SpeakerTalk[] {
  const byLabel = new Map<string, SpeakerTalk & { longestMs: number }>();
  segments.forEach((s, index) => {
    if (s.speakerLabel === null) return;
    const ms = s.startMs !== null && s.endMs !== null ? Math.max(0, s.endMs - s.startMs) : 0;
    const talk = byLabel.get(s.speakerLabel) ?? { label: s.speakerLabel, ms: 0, segments: 0, longest: index, longestMs: -1 };
    talk.ms += ms;
    talk.segments += 1;
    if (ms > talk.longestMs) {
      talk.longestMs = ms;
      talk.longest = index;
    }
    byLabel.set(s.speakerLabel, talk);
  });
  return [...byLabel.values()]
    .map(({ longestMs: _, ...talk }) => talk)
    .sort((a, b) => b.ms - a.ms || a.label.localeCompare(b.label, 'en', { numeric: true }));
}

/** The speaker warning as the interface shows it: unmatched labels split into main and short (decision 20). */
export interface SpeakerWarning extends SpeakerCheck {
  /** True for a transcript made from recordings: the warning follows the matching. */
  live: boolean;
  /** Unasked labels holding at least `SHORT_LABEL_MS`, most talk first. */
  main: string[];
  /** Unasked short labels, summed up. */
  short: { labels: string[]; ms: number };
}

/**
 * C11 for a session's transcript. An imported transcript keeps its warning as
 * it was at import. A transcript made from recordings has labels that name
 * nobody, so its warning is worked out now: every label not yet matched to a
 * client participant who was asked, or to someone on the consultant's side.
 */
export function speakerWarning(ws: CompanyWorkspace, sessionId: string): SpeakerWarning | null {
  const transcript = transcriptOf(ws, sessionId);
  if (!transcript) return null;
  const segments = segmentsOf(ws, transcript.id);
  const live = transcript.source.kind === 'recording';
  const check = live
    ? checkSpeakers(
        ws,
        sessionId,
        segments.map((s) => s.speakerLabel),
      )
    : { unaskedSpeakers: transcript.unaskedSpeakers, unnamedSpeakers: transcript.unnamedSpeakers };
  return { ...check, live, ...splitShort(check.unaskedSpeakers, live ? talkTimes(segments) : null) };
}

/** Unasked labels as main and short, by talk time; without times (an import), all are main. */
export function splitShort(
  unasked: readonly string[],
  talk: readonly SpeakerTalk[] | null,
): Pick<SpeakerWarning, 'main' | 'short'> {
  if (!talk) return { main: [...unasked], short: { labels: [], ms: 0 } };
  const main: string[] = [];
  const short = { labels: [] as string[], ms: 0 };
  for (const t of talk) {
    if (!unasked.includes(t.label)) continue;
    if (t.ms >= SHORT_LABEL_MS) main.push(t.label);
    else {
      short.labels.push(t.label);
      short.ms += t.ms;
    }
  }
  return { main, short };
}

/** How a transcript made on this computer says it was made: "Transcribed on this computer by whisper.cpp 1.8.2 (large-v3-turbo-q5_0); speakers by sherpa-onnx 1.12.0". */
export function transcribedBy(source: Extract<TranscriptSource, { kind: 'recording' }>): string {
  const speakers = source.speakers ? `; speakers by ${source.speakers.name} ${source.speakers.version}` : '';
  return `Transcribed on this computer by ${source.transcriber.name} ${source.transcriber.version} (${source.transcriber.models.join(', ')})${speakers}`;
}

// ---------------------------------------------------------------------------
// Retention (decisions 22 and 23; CONSENT.md, C10 and decision 4)
// ---------------------------------------------------------------------------

/** How long a recording is kept, as the session shows it ("kept until 12 Dec 2026"). */
export type KeptUntil =
  | { kind: 'date'; at: Timestamp }
  | { kind: 'engagement-ends' }
  | { kind: 'engagement-ended'; endedOn: string }
  | { kind: 'transcription' }
  | { kind: 'not-agreed'; withdrawn: boolean };

/** The calendar date of a moment in a time zone, as "YYYY-MM-DD". */
function dateIn(at: Timestamp, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(at),
  );
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** How long a recording is kept under its session's consent now. */
export function keptUntil(ws: CompanyWorkspace, file: Recording): KeptUntil {
  const sessionId = file.owner.kind === 'session' ? file.owner.sessionId : '';
  const record = consentFor(ws, sessionId);
  if (!record) return { kind: 'not-agreed', withdrawn: false };
  const state = consentState(record);
  if (state.withdrawn) return { kind: 'not-agreed', withdrawn: true };
  if (!state.given.audioRecording) return { kind: 'not-agreed', withdrawn: false };
  const retention = state.retention;
  if (retention.kind === 'days')
    return { kind: 'date', at: new Date(time(file.audio.recordedAt) + retention.days * 86_400_000).toISOString() };
  if (retention.kind === 'delete-after-transcription') return { kind: 'transcription' };
  const engagement = get(ws.engagements, get(ws.sessions, sessionId)?.engagementId);
  return engagement?.status.state === 'ended'
    ? { kind: 'engagement-ended', endedOn: engagement.status.endedOn }
    : { kind: 'engagement-ends' };
}

export interface RecordingDue {
  sessionId: string;
  fileId: string;
  /** Why its time is up: N days passed, the engagement ended, consent no longer allows it, or it was transcribed under "deleted after transcription". */
  why: 'days' | 'engagement-ended' | 'not-agreed' | 'withdrawn' | 'transcribed';
}

export interface RecordingWaiting {
  sessionId: string;
  fileId: string;
  /** Not transcribed yet, or its transcript is ready but not added. */
  waiting: 'transcription' | 'adding';
}

/** The reason a deletion records, for a recording whose time is up. */
export const deletionReasonFor = (why: RecordingDue['why']): DeletionReason =>
  why === 'withdrawn' ? 'withdrawal' : why === 'transcribed' ? 'transcribed' : 'retention';

/**
 * Every finished recording whose time is up at `now` (decision 23), and,
 * listed separately, those under "deleted after transcription" still here a
 * day after they were made (decision 22). `ready` holds the recordings whose
 * transcript is ready but not added. StyleCode never deletes on its own.
 */
export function recordingsPastTime(
  ws: CompanyWorkspace,
  now: Timestamp,
  ready: ReadonlySet<string> = new Set(),
): { due: RecordingDue[]; waiting: RecordingWaiting[] } {
  const due: RecordingDue[] = [];
  const waiting: RecordingWaiting[] = [];
  for (const session of Object.values(ws.sessions)) {
    for (const file of recordingsOf(ws, session.id)) {
      if (file.audio.state !== 'finished') continue;
      const entry = { sessionId: session.id, fileId: file.id };
      const kept = keptUntil(ws, file);
      if (kept.kind === 'not-agreed') due.push({ ...entry, why: kept.withdrawn ? 'withdrawn' : 'not-agreed' });
      else if (kept.kind === 'date' && time(now) >= time(kept.at)) due.push({ ...entry, why: 'days' });
      else if (kept.kind === 'engagement-ended' && dateIn(now, session.timeZone) >= kept.endedOn)
        due.push({ ...entry, why: 'engagement-ended' });
      else if (kept.kind === 'transcription') {
        if (file.audio.transcribedAt !== null) due.push({ ...entry, why: 'transcribed' });
        else if (time(now) - time(file.audio.recordedAt) >= TRANSCRIBE_WITHIN_MS)
          waiting.push({ ...entry, waiting: ready.has(file.id) ? 'adding' : 'transcription' });
      }
    }
  }
  return { due, waiting };
}
