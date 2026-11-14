import { describe, expect, it } from 'vitest';
import { amendConsent } from './consent.ts';
import { sampleWorkspace, consentRecord } from './fixtures.ts';
import {
  addRecordedTranscript,
  addRecordingFile,
  DEFAULT_RECORDING_SETTINGS,
  deletesOnAdding,
  deletionReasonFor,
  durationOfBytes,
  finishRecording,
  keptUntil,
  MAX_RECORDING_MS,
  recordingInProgress,
  recordingsOf,
  recordingsPastTime,
  removeRecordings,
  SHORT_LABEL_MS,
  speakerWarning,
  splitShort,
  startRecording,
  talkTimes,
  transcribedBy,
  type RecordedTranscriptInput,
} from './recordings.ts';
import { importTranscript, segmentsOf, speakerOf, transcriptOf, type ScoredSegment } from './transcripts.ts';
import { createFinding } from './record.ts';
import type { CompanyWorkspace, Retention } from './types.ts';
import { validateWorkspace } from './validate.ts';
import { parseWorkspace } from './workspace.ts';

/**
 * Workspace Phase 3, WP4: recordings, transcripts made from them, C11 for
 * recordings and retention (Phase 3 brief, decisions 12 to 25, as changed at
 * the WP3 check-ins). Every person and company is role-played.
 */

const T4 = '2026-11-05T08:00:00.000Z';
const T5 = '2026-11-05T09:00:00.000Z';
const T6 = '2026-11-05T10:00:00.000Z';
const DAY = 86_400_000;
const later = (at: string, ms: number) => new Date(Date.parse(at) + ms).toISOString();

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);

/**
 * A second session, Bosveld Citrus's intake, with Thandi (client, asked) and
 * Sam (the consultant). Its consent record is confirmed and not locked, and
 * agrees to recording and transcription, kept as `retention` says.
 */
function intake(retention: Retention = { kind: 'days', days: 30 }): CompanyWorkspace {
  const ws = sampleWorkspace();
  ws.sessions.se_2 = { ...ws.sessions.se_1, id: 'se_2', title: 'Intake', startsAt: T4 };
  const person = { sessionId: 'se_2', role: '', organisation: '', speakerLabels: [] };
  ws.participants.pa_thandi = { ...person, id: 'pa_thandi', name: 'Thandi Mokoena', side: 'client' };
  ws.participants.pa_sam = { ...person, id: 'pa_sam', name: 'Sam Naidoo', side: 'consultant' };
  ws.participants.pa_lerato = { ...person, id: 'pa_lerato', name: 'Lerato Dlamini', side: 'client' };
  ws.consents.cr_2 = consentRecord({
    id: 'cr_2',
    sessionId: 'se_2',
    askedParticipantIds: ['pa_thandi'],
    given: { audioRecording: true, transcription: true, aiLocal: true, aiExternal: false, externalProvider: null },
    retention,
    confirmed: { by: 'Sam Naidoo', at: T4 },
    lockedAt: null,
    createdAt: T4,
    updatedAt: T4,
  });
  expect(codes(ws)).toEqual([]);
  return ws;
}

const start = (ws: CompanyWorkspace, id = 'fi_r1', at = T5) =>
  startRecording(ws, 'se_2', { id, settings: DEFAULT_RECORDING_SETTINGS }, 'Sam Naidoo', at);

/** A finished recording of `ms`, started at T5. */
function recorded(ws: CompanyWorkspace, id = 'fi_r1', ms = 600_000, at = T5): CompanyWorkspace {
  const started = value(start(ws, id, at)).workspace;
  return value(finishRecording(started, id, { durationMs: ms, sizeBytes: 44 + ms * 32, recovered: false }));
}

const segment = (label: string | null, startMs: number, endMs: number, text: string, unsure: [number, number][] = []) =>
  ({ speakerLabel: label, startMs, endMs, text, confidence: 0.9, unsureWords: unsure }) satisfies ScoredSegment;

const engines = {
  transcriber: { name: 'whisper.cpp', version: '1.8.2', models: ['large-v3-turbo-q5_0'] },
  speakers: { name: 'sherpa-onnx', version: '1.12.0', models: ['pyannote-segmentation-3.0', 'eres2net'] },
};

const input = (overrides: Partial<RecordedTranscriptInput> = {}): RecordedTranscriptInput => ({
  recordingIds: ['fi_r1'],
  segments: [
    segment('Speaker 1', 0, 40_000, 'We pack about two thousand cartons a day in season.', [[24, 32]]),
    segment('Speaker 2', 40_000, 52_000, 'And out of season?'),
    segment('Speaker 3', 52_000, 55_000, 'Sorry, just the keys.'),
  ],
  ...engines,
  matches: {},
  ...overrides,
});

describe('starting and finishing a recording (decisions 12 and 13)', () => {
  it('needs consent to recording (C1), and says why not', () => {
    const ws = intake();
    ws.consents.cr_2.given.audioRecording = false;
    expect(start(ws)).toEqual({ ok: false, error: 'The client did not agree to audio recording.' });
    ws.consents.cr_2.confirmed = null;
    expect(start(ws)).toEqual({ ok: false, error: 'Confirm the consent form for this session first.' });
    delete ws.consents.cr_2;
    expect(start(ws)).toEqual({ ok: false, error: 'Fill in the consent form for this session first.' });
  });

  it('is refused after a withdrawal (C8)', () => {
    const ws = intake();
    ws.consents.cr_2 = value(
      amendConsent(ws.consents.cr_2, { id: 'am_1', kind: 'withdrawal', by: 'Sam Naidoo', at: T5, reason: 'Asked to stop.' }),
    );
    expect(start(ws, 'fi_r1', T6)).toEqual({ ok: false, error: 'The client withdrew consent for this session.' });
  });

  it('locks the consent record when the first recording starts (C4), and keeps that time', () => {
    const { workspace, file } = value(start(intake()));
    expect(workspace.consents.cr_2.lockedAt).toBe(T5);
    expect(file).toMatchObject({
      name: 'Recording 1',
      purpose: 'audio',
      mediaType: 'audio/wav',
      owner: { kind: 'session', sessionId: 'se_2' },
      audio: { source: 'recorded', state: 'recording', recordedAt: T5, settings: DEFAULT_RECORDING_SETTINGS, recovered: false },
    });
    expect(workspace.sessions.se_2.audioFileIds).toEqual(['fi_r1']);
    expect(recordingInProgress(workspace, 'se_2')?.id).toBe('fi_r1');
    expect(codes(workspace)).toEqual([]);
    const second = recorded(
      value(finishRecording(workspace, 'fi_r1', { durationMs: 1000, sizeBytes: 32_044, recovered: false })),
      'fi_r2',
      1000,
      T6,
    );
    expect(second.consents.cr_2.lockedAt).toBe(T5);
    expect(recordingsOf(second, 'se_2').map((r) => r.name)).toEqual(['Recording 1', 'Recording 2']);
  });

  it('records one at a time per session, and refuses a used id', () => {
    const ws = value(start(intake())).workspace;
    expect(start(ws, 'fi_r2')).toEqual({ ok: false, error: 'This session is already recording.' });
    const done = value(finishRecording(ws, 'fi_r1', { durationMs: 1000, sizeBytes: 32_044, recovered: false }));
    expect(start(done, 'fi_r1').ok).toBe(false);
  });

  it('finishes with what was written, at most 4 hours, once', () => {
    const ws = value(start(intake())).workspace;
    expect(finishRecording(ws, 'fi_r1', { durationMs: MAX_RECORDING_MS + 1, sizeBytes: 1, recovered: false }).ok).toBe(false);
    const done = value(finishRecording(ws, 'fi_r1', { durationMs: 90_000, sizeBytes: 2_880_044, recovered: true }));
    expect(done.files.fi_r1).toMatchObject({
      sizeBytes: 2_880_044,
      audio: { state: 'finished', durationMs: 90_000, recovered: true },
    });
    expect(finishRecording(done, 'fi_r1', { durationMs: 1, sizeBytes: 1, recovered: false })).toEqual({
      ok: false,
      error: 'The recording has already stopped.',
    });
    expect(codes(done)).toEqual([]);
  });

  it('works out a length from the bytes written', () => {
    expect(durationOfBytes(32_000)).toBe(1000);
    expect(durationOfBytes(48_000)).toBe(1500);
    expect(durationOfBytes(-5)).toBe(0);
  });
});

describe('adding a WAV made elsewhere (decision 15)', () => {
  const wav = { id: 'fi_w', name: 'intake.wav', durationMs: 120_000, sizeBytes: 3_840_044 };

  it('needs the same consent as recording, and locks the record', () => {
    const ws = intake();
    const { workspace, file } = value(addRecordingFile(ws, 'se_2', wav, 'Sam Naidoo', T5));
    expect(file.audio).toMatchObject({ source: 'added', state: 'finished', settings: null, durationMs: 120_000 });
    expect(file.name).toBe('intake.wav');
    expect(workspace.consents.cr_2.lockedAt).toBe(T5);
    expect(codes(workspace)).toEqual([]);
    ws.consents.cr_2.given.audioRecording = false;
    expect(addRecordingFile(ws, 'se_2', wav, 'Sam Naidoo', T5).ok).toBe(false);
  });

  it('refuses one longer than 4 hours, or with no sound', () => {
    expect(addRecordingFile(intake(), 'se_2', { ...wav, durationMs: MAX_RECORDING_MS + 1 }, 'Sam', T5)).toEqual({
      ok: false,
      error: 'A recording is at most 4 hours long.',
    });
    expect(addRecordingFile(intake(), 'se_2', { ...wav, durationMs: 0 }, 'Sam', T5).ok).toBe(false);
  });
});

describe('deleting a recording (decision 24)', () => {
  it('keeps a line saying when it was recorded, how long it was, and when, by whom and why it went', () => {
    const ws = recorded(intake());
    const gone = value(removeRecordings(ws, ['fi_r1'], 'consultant', 'Sam Naidoo', T6));
    expect(gone.files.fi_r1).toBeUndefined();
    expect(gone.sessions.se_2.audioFileIds).toEqual([]);
    expect(gone.sessions.se_2.deletedRecordings).toEqual([
      { recordedAt: T5, durationMs: 600_000, deletedAt: T6, deletedBy: 'Sam Naidoo', reason: 'consultant' },
    ]);
    expect(codes(gone)).toEqual([]);
  });

  it('stops first: a recording still going is not deleted', () => {
    const ws = value(start(intake())).workspace;
    expect(removeRecordings(ws, ['fi_r1'], 'consultant', 'Sam', T6)).toEqual({ ok: false, error: 'Stop the recording first.' });
  });

  it('is possible after a withdrawal', () => {
    const ws = recorded(intake());
    ws.consents.cr_2 = value(
      amendConsent(ws.consents.cr_2, { id: 'am_1', kind: 'withdrawal', by: 'Sam Naidoo', at: T6, reason: 'Asked to stop.' }),
    );
    expect(removeRecordings(ws, ['fi_r1'], 'withdrawal', 'Sam Naidoo', T6).ok).toBe(true);
  });

  it('numbers new recordings after the deleted ones, so a name is never reused', () => {
    const gone = value(removeRecordings(recorded(intake()), ['fi_r1'], 'consultant', 'Sam', T6));
    expect(value(start(gone, 'fi_r2', T6)).file.name).toBe('Recording 2');
  });
});

describe('adding a transcript made from recordings (decisions 18, 19 and 22)', () => {
  it('names the recordings by start and length, and what made it; keeps confidence and unsure words', () => {
    const added = value(addRecordedTranscript(recorded(intake()), 'se_2', input(), 'Sam Naidoo', T6));
    const transcript = transcriptOf(added.workspace, 'se_2')!;
    expect(transcript.source).toEqual({ kind: 'recording', recordings: [{ recordedAt: T5, durationMs: 600_000 }], ...engines });
    expect(transcribedBy(transcript.source as Extract<typeof transcript.source, { kind: 'recording' }>)).toBe(
      'Transcribed on this computer by whisper.cpp 1.8.2 (large-v3-turbo-q5_0); speakers by sherpa-onnx 1.12.0',
    );
    const segments = segmentsOf(added.workspace, transcript.id);
    expect(segments[0]).toMatchObject({ confidence: 0.9, unsureWords: [[24, 32]], startMs: 0, endMs: 40_000 });
    expect(codes(added.workspace)).toEqual([]);
  });

  it('marks the recordings transcribed when they are kept', () => {
    const added = value(addRecordedTranscript(recorded(intake()), 'se_2', input(), 'Sam Naidoo', T6));
    expect(added.deletedRecordingIds).toEqual([]);
    expect(added.workspace.files.fi_r1.audio?.transcribedAt).toBe(T6);
  });

  it('deletes the recordings in the same step when the client was told "deleted after transcription" (C10)', () => {
    const ws = recorded(intake({ kind: 'delete-after-transcription' }));
    expect(deletesOnAdding(ws, 'se_2')).toBe(true);
    const added = value(addRecordedTranscript(ws, 'se_2', input(), 'Sam Naidoo', T6));
    expect(added.deletedRecordingIds).toEqual(['fi_r1']);
    expect(added.workspace.files.fi_r1).toBeUndefined();
    expect(added.workspace.sessions.se_2.deletedRecordings).toEqual([
      { recordedAt: T5, durationMs: 600_000, deletedAt: T6, deletedBy: 'Sam Naidoo', reason: 'transcribed' },
    ]);
    expect(transcriptOf(added.workspace, 'se_2')).not.toBeNull();
    expect(codes(added.workspace)).toEqual([]);
  });

  it('keeps the speakers matched in the preview, and refuses a match to someone outside the session', () => {
    const ws = recorded(intake());
    const added = value(
      addRecordedTranscript(ws, 'se_2', input({ matches: { 'Speaker 1': 'pa_thandi', 'Speaker 9': 'pa_sam' } }), 'Sam', T6),
    );
    expect(added.matched).toEqual(['Speaker 1']);
    expect(speakerOf(added.workspace, 'se_2', 'Speaker 1')?.id).toBe('pa_thandi');
    expect(added.workspace.participants.pa_sam.speakerLabels).toEqual([]);
    expect(addRecordedTranscript(ws, 'se_2', input({ matches: { 'Speaker 1': 'pa_client' } }), 'Sam', T6)).toEqual({
      ok: false,
      error: 'That person isn’t in this session.',
    });
  });

  it('needs consent to transcription now, and never after a withdrawal (decision 16)', () => {
    const ws = recorded(intake());
    ws.consents.cr_2 = value(
      amendConsent(ws.consents.cr_2, { id: 'am_1', kind: 'withdrawal', by: 'Sam Naidoo', at: T6, reason: 'Asked to stop.' }),
    );
    expect(addRecordedTranscript(ws, 'se_2', input(), 'Sam', later(T6, 1000))).toEqual({
      ok: false,
      error: 'The client withdrew consent for this session.',
    });
  });

  it('refuses recordings from another session, still going, or named twice', () => {
    const ws = recorded(intake());
    expect(addRecordedTranscript(ws, 'se_1', input(), 'Sam', T6).ok).toBe(false);
    expect(addRecordedTranscript(ws, 'se_2', input({ recordingIds: ['fi_r1', 'fi_r1'] }), 'Sam', T6).ok).toBe(false);
    const going = value(start(ws, 'fi_r2', T6)).workspace;
    expect(addRecordedTranscript(going, 'se_2', input({ recordingIds: ['fi_r2'] }), 'Sam', T6)).toEqual({
      ok: false,
      error: 'A recording the transcript was made from hasn’t stopped.',
    });
  });

  it('refuses unsure words outside the text, and a transcript that doesn’t say what made it', () => {
    const ws = recorded(intake());
    const bad = input({ segments: [segment('Speaker 1', 0, 1000, 'Two words.', [[4, 40]])] });
    expect(addRecordedTranscript(ws, 'se_2', bad, 'Sam', T6)).toEqual({
      ok: false,
      error: 'A segment marks words that aren’t in it.',
    });
    const nameless = input({ transcriber: { name: '', version: '1', models: ['m'] } });
    expect(addRecordedTranscript(ws, 'se_2', nameless, 'Sam', T6).ok).toBe(false);
  });

  it('replaces a transcript under Phase 2’s rules: not while a finding in the record quotes it', () => {
    const ws = recorded(intake());
    const first = value(addRecordedTranscript(ws, 'se_2', input(), 'Sam', T6)).workspace;
    const again = value(
      addRecordedTranscript(first, 'se_2', input({ segments: [segment('Speaker 1', 0, 5000, 'Once more.')] }), 'Sam', T6),
    );
    expect(segmentsOf(again.workspace, transcriptOf(again.workspace, 'se_2')!.id).map((s) => s.text)).toEqual(['Once more.']);
    const quoted = segmentsOf(first, transcriptOf(first, 'se_2')!.id)[0];
    const withFinding = value(
      createFinding(
        first,
        'en_1',
        {
          kind: 'scalability',
          statement: 'About two thousand cartons a day in season.',
          status: 'confirmed',
          evidence: [{ kind: 'segment', segmentId: quoted.id, quote: 'two thousand cartons a day' }],
        },
        'Sam',
        T6,
      ),
    ).workspace;
    expect(addRecordedTranscript(withFinding, 'se_2', input(), 'Sam', T6).ok).toBe(false);
  });
});

describe('speakers: C11 for recordings, and short labels (decision 20, as changed at WP3)', () => {
  it('works out the warning now for a recorded transcript, so it follows the matching', () => {
    const added = value(addRecordedTranscript(recorded(intake()), 'se_2', input(), 'Sam', T6)).workspace;
    expect(speakerWarning(added, 'se_2')).toEqual({
      unaskedSpeakers: ['Speaker 1', 'Speaker 2', 'Speaker 3'],
      unnamedSpeakers: false,
      live: true,
      main: ['Speaker 1'],
      short: { labels: ['Speaker 2', 'Speaker 3'], ms: 15_000 },
    });
    const thandi = { ...added.participants.pa_thandi, speakerLabels: ['Speaker 1'] };
    const sam = { ...added.participants.pa_sam, speakerLabels: ['Speaker 2'] };
    const lerato = { ...added.participants.pa_lerato, speakerLabels: ['Speaker 3'] };
    const matched = { ...added, participants: { ...added.participants, pa_thandi: thandi, pa_sam: sam, pa_lerato: lerato } };
    // Lerato wasn't asked, so her label stays in the warning.
    expect(speakerWarning(matched, 'se_2')).toMatchObject({
      unaskedSpeakers: ['Speaker 3'],
      main: [],
      short: { labels: ['Speaker 3'] },
    });
  });

  it('keeps an imported transcript’s warning as it was at import', () => {
    const ws = intake();
    const imported = value(
      importTranscript(
        ws,
        'se_2',
        { source: { kind: 'pasted' }, segments: [{ speakerLabel: 'Guest', startMs: null, endMs: null, text: 'Hello.' }] },
        'Sam',
        T5,
      ),
    ).workspace;
    const matched = {
      ...imported,
      participants: { ...imported.participants, pa_thandi: { ...imported.participants.pa_thandi, speakerLabels: ['Guest'] } },
    };
    expect(speakerWarning(matched, 'se_2')).toMatchObject({ unaskedSpeakers: ['Guest'], live: false, main: ['Guest'] });
    expect(speakerWarning(intake(), 'se_2')).toBeNull();
  });

  it('sorts labels by talk time, with each label’s longest segment', () => {
    const talk = talkTimes([
      { speakerLabel: 'Speaker 2', startMs: 0, endMs: 5000 },
      { speakerLabel: 'Speaker 1', startMs: 5000, endMs: 20_000 },
      { speakerLabel: 'Speaker 2', startMs: 20_000, endMs: 32_000 },
      { speakerLabel: null, startMs: 32_000, endMs: 40_000 },
    ]);
    expect(talk).toEqual([
      { label: 'Speaker 2', ms: 17_000, segments: 2, longest: 2 },
      { label: 'Speaker 1', ms: 15_000, segments: 1, longest: 1 },
    ]);
    expect(splitShort(['Speaker 1', 'Speaker 2'], talk)).toEqual({
      main: [],
      short: { labels: ['Speaker 2', 'Speaker 1'], ms: 32_000 },
    });
    expect(SHORT_LABEL_MS).toBe(30_000);
    expect(splitShort(['A'], null)).toEqual({ main: ['A'], short: { labels: [], ms: 0 } });
  });
});

describe('retention: recordings past their time (decision 23) and waiting for a transcript (decision 22)', () => {
  it('"N days" counts from when it was recorded', () => {
    const ws = recorded(intake({ kind: 'days', days: 30 }));
    expect(keptUntil(ws, recordingsOf(ws, 'se_2')[0])).toEqual({ kind: 'date', at: later(T5, 30 * DAY) });
    expect(recordingsPastTime(ws, later(T5, 30 * DAY - 1)).due).toEqual([]);
    expect(recordingsPastTime(ws, later(T5, 30 * DAY)).due).toEqual([{ sessionId: 'se_2', fileId: 'fi_r1', why: 'days' }]);
  });

  it('"until the engagement ends" is up from the end date, in the session’s zone', () => {
    const ws = recorded(intake({ kind: 'until-engagement-ends' }));
    expect(keptUntil(ws, recordingsOf(ws, 'se_2')[0])).toEqual({ kind: 'engagement-ends' });
    ws.engagements.en_1.status = { state: 'ended', endedOn: '2026-12-01' };
    // 21:59 UTC on 30 November is still 30 November in Johannesburg (UTC+2); 22:00 is 1 December.
    expect(recordingsPastTime(ws, '2026-11-30T21:59:00.000Z').due).toEqual([]);
    expect(recordingsPastTime(ws, '2026-11-30T22:00:00.000Z').due).toEqual([
      { sessionId: 'se_2', fileId: 'fi_r1', why: 'engagement-ended' },
    ]);
  });

  it('lists a recording no longer agreed, by amendment or withdrawal, straight away', () => {
    const ws = recorded(intake());
    const off = structuredClone(ws);
    off.consents.cr_2 = value(
      amendConsent(off.consents.cr_2, {
        id: 'am_1',
        kind: 'change',
        by: 'Sam',
        at: T6,
        reason: 'Client asked.',
        given: { audioRecording: false },
      }),
    );
    expect(recordingsPastTime(off, T6).due).toEqual([{ sessionId: 'se_2', fileId: 'fi_r1', why: 'not-agreed' }]);
    const withdrawn = structuredClone(ws);
    withdrawn.consents.cr_2 = value(
      amendConsent(withdrawn.consents.cr_2, { id: 'am_1', kind: 'withdrawal', by: 'Sam', at: T6, reason: 'Asked to stop.' }),
    );
    expect(recordingsPastTime(withdrawn, T6).due).toEqual([{ sessionId: 'se_2', fileId: 'fi_r1', why: 'withdrawn' }]);
    expect(deletionReasonFor('withdrawn')).toBe('withdrawal');
    expect(deletionReasonFor('days')).toBe('retention');
  });

  it('lists a "deleted after transcription" recording a day on, waiting for its transcript or for adding it', () => {
    const ws = recorded(intake({ kind: 'delete-after-transcription' }));
    expect(keptUntil(ws, recordingsOf(ws, 'se_2')[0])).toEqual({ kind: 'transcription' });
    expect(recordingsPastTime(ws, later(T5, DAY - 1))).toEqual({ due: [], waiting: [] });
    expect(recordingsPastTime(ws, later(T5, DAY)).waiting).toEqual([
      { sessionId: 'se_2', fileId: 'fi_r1', waiting: 'transcription' },
    ]);
    expect(recordingsPastTime(ws, later(T5, DAY), new Set(['fi_r1'])).waiting).toEqual([
      { sessionId: 'se_2', fileId: 'fi_r1', waiting: 'adding' },
    ]);
  });

  it('leaves a recording still going alone', () => {
    const ws = value(start(intake({ kind: 'days', days: 1 }))).workspace;
    expect(recordingsPastTime(ws, later(T5, 10 * DAY))).toEqual({ due: [], waiting: [] });
  });
});

describe('workspace version 4', () => {
  it('migrates version 3: sessions get no deleted recordings, segments no unsure words, and nothing else changes', () => {
    const v3 = structuredClone(sampleWorkspace()) as unknown as Record<string, unknown> & {
      sessions: Record<string, Record<string, unknown>>;
      segments: Record<string, Record<string, unknown>>;
    };
    v3.version = 3;
    for (const s of Object.values(v3.sessions)) delete s.deletedRecordings;
    for (const s of Object.values(v3.segments)) delete s.unsureWords;
    const before = structuredClone(v3);
    const parsed = parseWorkspace(v3);
    expect(parsed.ok && parsed.access).toBe('editable');
    if (!parsed.ok) return;
    expect(parsed.workspace).toEqual(sampleWorkspace());
    expect(v3).toEqual(before);
  });

  it('checks a recording’s details, one recording at a time, and that its session lists it', () => {
    const ws = value(start(intake())).workspace;
    const broken = structuredClone(ws);
    broken.files.fi_r1.audio!.durationMs = MAX_RECORDING_MS + 1;
    expect(codes(broken)).toEqual(['recording.details']);
    const two = structuredClone(ws);
    two.files.fi_r2 = { ...two.files.fi_r1, id: 'fi_r2' };
    two.sessions.se_2.audioFileIds.push('fi_r2');
    expect(codes(two)).toEqual(['recording.inProgress']);
    const unlisted = structuredClone(ws);
    unlisted.sessions.se_2.audioFileIds = [];
    expect(codes(unlisted)).toEqual(['ref.missing']);
    const document = structuredClone(sampleWorkspace());
    document.files.fi_d = { ...ws.files.fi_r1, id: 'fi_d', owner: { kind: 'company' }, purpose: 'document' };
    expect(codes(document)).toEqual(['field.value']);
  });

  it('checks the deleted recordings’ lines, the recorded source and unsure words', () => {
    const ws = value(addRecordedTranscript(recorded(intake()), 'se_2', input(), 'Sam', T6)).workspace;
    const line = structuredClone(ws);
    line.sessions.se_2.deletedRecordings = [
      { recordedAt: T5, durationMs: 1, deletedAt: T6, deletedBy: '', reason: 'consultant' },
    ];
    expect(codes(line)).toEqual(['recording.deleted']);
    const source = structuredClone(ws);
    const t = transcriptOf(source, 'se_2')!;
    source.transcripts[t.id] = { ...t, source: { ...engines, kind: 'recording', recordings: [] } };
    expect(codes(source)).toEqual(['field.value']);
    const unsure = structuredClone(ws);
    const s = segmentsOf(unsure, t.id)[1];
    unsure.segments[s.id] = { ...s, unsureWords: [[5, 3]] };
    expect(codes(unsure)).toEqual(['field.value']);
  });

  it('needs the record locked by the time of a recording (C4)', () => {
    const ws = value(start(intake())).workspace;
    ws.consents.cr_2.lockedAt = later(T5, 1000);
    expect(codes(ws)).toEqual(['consent.lock']);
    ws.consents.cr_2.lockedAt = T4;
    expect(codes(ws)).toEqual([]);
  });
});
