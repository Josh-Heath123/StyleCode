import { describe, expect, it } from 'vitest';
import { amendConsent, consentState } from './consent.ts';
import { amendConsentForm, amendFormFor, amendIssues, canTellOnAmend, withdrawConsent } from './consentForm.ts';
import { createSession } from './entities.ts';
import { attachToConsent, removeConsentAttachment, removeFileRef } from './files.ts';
import { acceptProposal, isInRecord, keptFromSession, promoteToKnowledge, removeFact, removeFinding } from './findings.ts';
import { consentRecord, sampleWorkspace, T0, T2, T3 } from './fixtures.ts';
import { createFinding, updateFinding } from './record.ts';
import {
  deleteTranscript,
  findingsQuotingTranscript,
  importTranscript,
  matchSpeaker,
  replaceTranscript,
  segmentsOf,
  speakerLabelsOf,
  speakerOf,
  transcriptOf,
  type ParsedSegment,
  type TranscriptInput,
} from './transcripts.ts';
import type { CompanyWorkspace, ConsentAmendment, Finding } from './types.ts';
import { validateWorkspace } from './validate.ts';
import { CURRENT_WORDING } from './wording.ts';
import { parseWorkspace } from './workspace.ts';

/**
 * Workspace Phase 2, WP1: the model changes for transcripts (Phase 2 brief,
 * decisions 3, 4, 6, 9, 10, 12, 13, 15 and 18). Every person and company is
 * role-played.
 */

const T4 = '2026-11-05T08:00:00.000Z';
const T5 = '2026-11-05T09:00:00.000Z';

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const clean = (ws: CompanyWorkspace) => expect(validateWorkspace(ws)).toEqual([]);

/**
 * The sample workspace with a second session, Karoo Freight's kick-off as in
 * the samples: Thandi and Pieter were asked, Lerato wasn't, and the consent
 * record is confirmed but not locked yet.
 */
function withKickoff(changes: Partial<ReturnType<typeof consentRecord>> = {}): CompanyWorkspace {
  const ws = sampleWorkspace();
  ws.sessions.se_2 = {
    id: 'se_2',
    engagementId: 'en_1',
    title: 'Karoo Freight kick-off',
    startsAt: T4,
    timeZone: 'Africa/Johannesburg',
    audioFileIds: [],
    createdAt: T0,
    updatedAt: T0,
  };
  const person = (id: string, name: string, side: 'client' | 'consultant') => ({
    id,
    sessionId: 'se_2',
    name,
    role: '',
    organisation: side === 'client' ? 'Karoo Freight' : 'Naidoo Consulting',
    side,
    speakerLabels: [] as string[],
  });
  ws.participants.pa_sam = person('pa_sam', 'Sam Naidoo', 'consultant');
  ws.participants.pa_thandi = person('pa_thandi', 'Thandi Mokoena', 'client');
  ws.participants.pa_pieter = person('pa_pieter', 'Pieter van Wyk', 'client');
  ws.participants.pa_lerato = person('pa_lerato', 'Lerato Dlamini', 'client');
  ws.consents.cr_2 = consentRecord({
    id: 'cr_2',
    sessionId: 'se_2',
    askedParticipantIds: ['pa_thandi', 'pa_pieter'],
    confirmed: { by: 'Sam Naidoo', at: T4 },
    lockedAt: null,
    createdAt: T4,
    updatedAt: T4,
    ...changes,
  });
  return ws;
}

const seg = (speakerLabel: string | null, text: string, startMs: number | null = null): ParsedSegment => ({
  speakerLabel,
  startMs,
  endMs: startMs === null ? null : startMs + 2000,
  text,
});

const teams: TranscriptInput = {
  source: { kind: 'file', fileName: 'teams-transcript.vtt', format: 'vtt', platform: 'teams' },
  segments: [
    seg('Sam Naidoo', 'Thanks for making time today.', 0),
    seg('Thandi Mokoena', 'Our drivers lose signal on the N1 for hours at a time.', 3000),
    seg('Pieter van Wyk', 'Peak days are the last Friday of the month.', 9000),
    seg('Lerato Dlamini (Guest)', 'Sorry I am late, the link did not work.', 15000),
    seg('Thandi Mokoena', '   ', 18000), // Nothing said: left out.
  ],
};

const imported = (ws = withKickoff()) => value(importTranscript(ws, 'se_2', teams, 'Sam Naidoo', T5));

describe('workspace version 2', () => {
  it('migrates version 1: each session gets the time zone given, and nothing else changes', () => {
    const v1 = sampleWorkspace() as unknown as Record<string, unknown> & { sessions: Record<string, Record<string, unknown>> };
    v1.version = 1;
    delete v1.sessions.se_1.timeZone;
    const before = structuredClone(v1);
    const parsed = parseWorkspace(v1, { timeZone: 'Europe/London' });
    expect(parsed.ok && parsed.access).toBe('editable');
    if (!parsed.ok) return;
    expect(parsed.workspace.version).toBe(3);
    expect(parsed.workspace.sessions.se_1.timeZone).toBe('Europe/London');
    expect({ ...parsed.workspace, version: 1, sessions: before.sessions }).toEqual(before);
    expect(v1).toEqual(before); // The input isn't changed.
  });

  it('migrates version 1 company facts: they keep the sessions their quotes name', () => {
    const ws = sampleWorkspace();
    ws.knowledge.kf_1 = value(promoteToKnowledge(ws, 'fd_peak', 'kf_1', 'Sam Consultant', T3));
    const v1 = structuredClone(ws) as unknown as Record<string, unknown> & {
      knowledge: Record<string, { source: Record<string, unknown> }>;
    };
    v1.version = 1;
    delete v1.knowledge.kf_1.source.sessionIds;
    const parsed = parseWorkspace(v1, { timeZone: 'Africa/Johannesburg' });
    expect(parsed.ok && parsed.access).toBe('editable');
    if (parsed.ok) expect(parsed.workspace.knowledge.kf_1.source?.sessionIds).toEqual(['se_1']);
  });

  it('migrates a version 1 workspace with problems too, so it opens read-only with only its real problems', () => {
    const v1 = sampleWorkspace() as unknown as Record<string, unknown> & { sessions: Record<string, Record<string, unknown>> };
    v1.version = 1;
    delete v1.sessions.se_1.timeZone;
    v1.sessions.se_1.title = '';
    const parsed = parseWorkspace(v1, { timeZone: 'Africa/Johannesburg' });
    expect(parsed.ok && parsed.access).toBe('read-only');
    if (parsed.ok) expect(parsed.problems.map((p) => p.code)).toEqual(['session.title']);
  });

  it('uses the computer’s zone when none is given, and leaves a later version’s zones alone', () => {
    const v1 = sampleWorkspace() as unknown as Record<string, unknown> & { sessions: Record<string, Record<string, unknown>> };
    v1.version = 1;
    delete v1.sessions.se_1.timeZone;
    const parsed = parseWorkspace(v1);
    expect(parsed.ok && parsed.workspace.sessions.se_1.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const v2 = parseWorkspace(sampleWorkspace(), { timeZone: 'Europe/London' });
    expect(v2.ok && v2.workspace.sessions.se_1.timeZone).toBe('Africa/Johannesburg');
  });

  it('checks the session’s time zone and the txt source format', () => {
    const ws = sampleWorkspace();
    ws.sessions.se_1.timeZone = 'Mars/Olympus_Mons';
    expect(validateWorkspace(ws).map((p) => p.code)).toEqual(['field.value']);
    const txt = sampleWorkspace();
    txt.transcripts.tr_1.source = { kind: 'file', fileName: 'zoom.txt', format: 'txt', platform: 'zoom' };
    clean(txt);
    (txt.transcripts.tr_1.source as { format: string }).format = 'pdf';
    expect(validateWorkspace(txt).map((p) => p.code)).toEqual(['field.value']);
  });

  it('gives a new session the time zone asked for, or the computer’s', () => {
    const ws = sampleWorkspace();
    const given = value(createSession(ws, 'en_1', { title: 'Follow-up', startsAt: T4, timeZone: 'Asia/Kolkata' }, T4));
    expect(given.workspace.sessions[given.id].timeZone).toBe('Asia/Kolkata');
    const own = value(createSession(ws, 'en_1', { title: 'Follow-up', startsAt: T4 }, T4));
    expect(own.workspace.sessions[own.id].timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(createSession(ws, 'en_1', { title: 'x', startsAt: T4, timeZone: 'Nowhere/Here' }, T4).ok).toBe(false);
  });
});

describe('importing a transcript', () => {
  it('keeps the segments in order, locks the consent record and records the source', () => {
    const { workspace, transcriptId } = imported();
    clean(workspace);
    const transcript = transcriptOf(workspace, 'se_2');
    expect(transcript).toMatchObject({ id: transcriptId, source: teams.source, importedBy: 'Sam Naidoo', importedAt: T5 });
    expect(segmentsOf(workspace, transcriptId).map((s) => [s.index, s.speakerLabel, s.startMs, s.text])).toEqual([
      [0, 'Sam Naidoo', 0, 'Thanks for making time today.'],
      [1, 'Thandi Mokoena', 3000, 'Our drivers lose signal on the N1 for hours at a time.'],
      [2, 'Pieter van Wyk', 9000, 'Peak days are the last Friday of the month.'],
      [3, 'Lerato Dlamini (Guest)', 15000, 'Sorry I am late, the link did not work.'],
    ]);
    expect(workspace.consents.cr_2.lockedAt).toBe(T5);
  });

  it('matches labels equal to a participant’s name, and keeps the speakers who weren’t asked as a warning (C11)', () => {
    const { workspace, speakers, matched } = imported();
    expect(matched).toEqual(['Sam Naidoo', 'Thandi Mokoena', 'Pieter van Wyk', 'Lerato Dlamini (Guest)']);
    expect(speakerOf(workspace, 'se_2', 'Thandi Mokoena')?.id).toBe('pa_thandi');
    // Teams adds "(Guest)" to people from outside, so she is matched; but she wasn't asked, so C11 still lists her.
    expect(speakerOf(workspace, 'se_2', 'Lerato Dlamini (Guest)')?.id).toBe('pa_lerato');
    expect(speakers).toEqual({ unaskedSpeakers: ['Lerato Dlamini (Guest)'], unnamedSpeakers: false });
    expect(transcriptOf(workspace, 'se_2')).toMatchObject({
      unaskedSpeakers: ['Lerato Dlamini (Guest)'],
      unnamedSpeakers: false,
    });
    expect(speakerLabelsOf(workspace, 'se_2')).toEqual([
      'Sam Naidoo',
      'Thandi Mokoena',
      'Pieter van Wyk',
      'Lerato Dlamini (Guest)',
    ]);
  });

  it('matches a name whatever its spacing and case, but not one two people share, nor a label someone has', () => {
    const ws = withKickoff();
    ws.participants.pa_pieter.speakerLabels = ['THANDI  mokoena'];
    ws.participants.pa_thandi2 = { ...ws.participants.pa_thandi, id: 'pa_thandi2', name: 'Lerato Dlamini (Guest)' };
    ws.participants.pa_lerato2 = { ...ws.participants.pa_lerato, id: 'pa_lerato2' };
    const input: TranscriptInput = {
      source: { kind: 'pasted' },
      segments: [
        seg('THANDI  mokoena', 'Words one two.'),
        seg('lerato dlamini', 'Words three four.'),
        seg(' sam naidoo ', 'Hi.'),
      ],
    };
    const result = value(importTranscript(ws, 'se_2', input, 'Sam Naidoo', T5));
    expect(result.matched).toEqual(['sam naidoo']); // Trimmed; Thandi's label is Pieter's already; two Leratos.
    expect(speakerOf(result.workspace, 'se_2', 'THANDI  mokoena')?.id).toBe('pa_pieter');
    expect(speakerOf(result.workspace, 'se_2', 'lerato dlamini')).toBeNull();
  });

  it('matches a name Teams marked “(Guest)” or “(External)”, but nothing else added to it', () => {
    const input: TranscriptInput = {
      source: { kind: 'pasted' },
      segments: [
        seg('Pieter van Wyk (External)', 'Words one two.'),
        seg('thandi mokoena  (GUEST)', 'Words three four.'),
        seg('Lerato Dlamini (Visitor)', 'Words five six.'),
        seg('(Guest)', 'Words seven eight.'),
      ],
    };
    const { workspace, matched, speakers } = value(importTranscript(withKickoff(), 'se_2', input, 'Sam Naidoo', T5));
    expect(matched).toEqual(['Pieter van Wyk (External)', 'thandi mokoena  (GUEST)']);
    expect(speakerOf(workspace, 'se_2', 'Pieter van Wyk (External)')?.id).toBe('pa_pieter');
    expect(speakers.unaskedSpeakers).toEqual(['Lerato Dlamini (Visitor)', '(Guest)']);
  });

  it('notes segments without a speaker, so they can’t be checked', () => {
    const input: TranscriptInput = {
      source: { kind: 'pasted' },
      segments: [seg(null, 'Someone said this.'), seg('  ', 'And this.')],
    };
    const { workspace, speakers } = value(importTranscript(withKickoff(), 'se_2', input, 'Sam Naidoo', T5));
    expect(speakers).toEqual({ unaskedSpeakers: [], unnamedSpeakers: true });
    expect(segmentsOf(workspace, transcriptOf(workspace, 'se_2')!.id).map((s) => s.speakerLabel)).toEqual([null, null]);
    clean(workspace);
  });

  it('is refused without consent to transcription (C1), with the reason, and nothing changes', () => {
    const refused = (ws: CompanyWorkspace) => {
      const result = importTranscript(ws, 'se_2', teams, 'Sam Naidoo', T5);
      expect(result.ok).toBe(false);
      return result.ok ? '' : result.error;
    };
    expect(refused(withKickoff({ confirmed: null }))).toMatch(/Confirm the consent form/);
    expect(
      refused(withKickoff({ given: { ...consentRecord().given, transcription: false, aiLocal: false, audioRecording: true } })),
    ).toMatch(/did not agree to transcription/);
    expect(refused(withKickoff({ outcome: { kind: 'declined' } }))).toMatch(/declined/);
    const none = withKickoff();
    delete none.consents.cr_2;
    expect(refused(none)).toMatch(/Fill in the consent form/);
    expect(refused(imported().workspace)).toMatch(/already has a transcript/);
  });

  it('is refused when nothing was said, when a time is wrong, or without the consultant’s name', () => {
    const ws = withKickoff();
    const input = (segments: ParsedSegment[]): TranscriptInput => ({ source: { kind: 'pasted' }, segments });
    expect(importTranscript(ws, 'se_2', input([seg('A', '  ')]), 'Sam', T5)).toMatchObject({
      ok: false,
      error: /nothing anyone said/,
    });
    expect(
      importTranscript(ws, 'se_2', input([{ speakerLabel: 'A', startMs: 5000, endMs: 1000, text: 'Hello there.' }]), 'Sam', T5),
    ).toMatchObject({ ok: false, error: /ends before it starts/ });
    expect(importTranscript(ws, 'se_2', input([seg('A', 'Hi.', -1)]), 'Sam', T5).ok).toBe(false);
    expect(importTranscript(ws, 'se_2', teams, '  ', T5).ok).toBe(false);
  });

  it('keeps the first lock time when the record was locked already', () => {
    const ws = withKickoff({ lockedAt: T4 });
    expect(imported(ws).workspace.consents.cr_2.lockedAt).toBe(T4);
  });
});

describe('matching speakers (MVP 4.3; decision 13)', () => {
  it('gives a label to one participant, taking it from anyone who had it, and can unmatch it', () => {
    let ws = imported().workspace;
    ws = value(matchSpeaker(ws, 'se_2', 'Lerato Dlamini (Guest)', 'pa_lerato'));
    expect(speakerOf(ws, 'se_2', 'Lerato Dlamini (Guest)')?.id).toBe('pa_lerato');
    ws = value(matchSpeaker(ws, 'se_2', 'Thandi Mokoena', 'pa_pieter'));
    expect(ws.participants.pa_thandi.speakerLabels).toEqual([]);
    expect(ws.participants.pa_pieter.speakerLabels).toEqual(['Pieter van Wyk', 'Thandi Mokoena']);
    ws = value(matchSpeaker(ws, 'se_2', 'Thandi Mokoena', null));
    expect(speakerOf(ws, 'se_2', 'Thandi Mokoena')).toBeNull();
    clean(ws);
  });

  it('works on a locked record, never changes who was asked, and keeps the import’s warning', () => {
    const before = imported().workspace;
    const ws = value(matchSpeaker(before, 'se_2', 'Lerato Dlamini (Guest)', 'pa_thandi'));
    expect(ws.consents).toBe(before.consents);
    expect(ws.transcripts).toBe(before.transcripts);
    expect(transcriptOf(ws, 'se_2')?.unaskedSpeakers).toEqual(['Lerato Dlamini (Guest)']);
  });

  it('refuses someone from another session, and changes nothing when nothing differs', () => {
    const ws = imported().workspace;
    expect(matchSpeaker(ws, 'se_2', 'Thandi Mokoena', 'pa_client').ok).toBe(false);
    expect(matchSpeaker(ws, 'se_2', ' ', 'pa_thandi').ok).toBe(false);
    expect(value(matchSpeaker(ws, 'se_2', 'Thandi Mokoena', 'pa_thandi'))).toBe(ws);
  });
});

/** A finding of the consultant's quoting the kick-off's second segment. */
function quoting(ws: CompanyWorkspace): { workspace: CompanyWorkspace; id: string } {
  const segment = segmentsOf(ws, transcriptOf(ws, 'se_2')!.id)[1];
  return value(
    createFinding(
      ws,
      'en_1',
      {
        kind: 'constraint',
        statement: 'Drivers have no signal for hours on the N1.',
        status: 'confirmed',
        evidence: [{ kind: 'segment', segmentId: segment.id, quote: 'lose signal on the N1' }],
      },
      'Sam Naidoo',
      T5,
    ),
  );
}

/** An AI proposal under review quoting the kick-off's third segment. */
function proposal(ws: CompanyWorkspace): CompanyWorkspace {
  const segment = segmentsOf(ws, transcriptOf(ws, 'se_2')!.id)[2];
  const evidence = [{ kind: 'segment' as const, segmentId: segment.id, quote: 'last Friday of the month' }];
  const f: Finding = {
    id: 'fd_ai_peak',
    engagementId: 'en_1',
    kind: 'scalability',
    statement: 'Peak days are month ends.',
    status: 'suggested',
    statusSet: { by: { kind: 'ai', provider: 'ollama', model: 'qwen2.5:7b' }, at: T5 },
    provenance: { kind: 'said-in-session' },
    evidence,
    origin: {
      kind: 'ai',
      provider: 'ollama',
      model: 'qwen2.5:7b',
      processing: { kind: 'local' },
      inputSessionIds: ['se_2'],
      at: T5,
      proposed: { kind: 'scalability', statement: 'Peak days are month ends.', status: 'suggested', evidence },
      review: { state: 'pending' },
    },
    history: [],
    createdAt: T5,
    updatedAt: T5,
  };
  return { ...ws, findings: { ...ws.findings, [f.id]: f } };
}

describe('replacing and deleting a transcript (decision 6)', () => {
  it('replaces it while no finding in the record quotes it, removing proposals that quoted it', () => {
    const ws = proposal(imported().workspace);
    clean(ws);
    const input: TranscriptInput = {
      ...teams,
      source: { kind: 'file', fileName: 'teams-graph-transcript.vtt', format: 'vtt', platform: 'teams' },
    };
    const result = value(replaceTranscript(ws, 'se_2', input, 'Sam Naidoo', '2026-11-05T10:00:00.000Z'));
    expect(result.removedProposalIds).toEqual(['fd_ai_peak']);
    expect(result.workspace.findings.fd_ai_peak).toBeUndefined();
    expect(transcriptOf(result.workspace, 'se_2')?.source).toMatchObject({ fileName: 'teams-graph-transcript.vtt' });
    expect(Object.values(result.workspace.transcripts).filter((t) => t.sessionId === 'se_2')).toHaveLength(1);
    expect(result.workspace.consents.cr_2.lockedAt).toBe(T5); // Locked when first imported.
    clean(result.workspace);
  });

  it('refuses to replace one that a finding in the record quotes, saying so', () => {
    const { workspace } = quoting(imported().workspace);
    expect(findingsQuotingTranscript(workspace, 'se_2').map((f) => f.statement)).toEqual([
      'Drivers have no signal for hours on the N1.',
    ]);
    expect(replaceTranscript(workspace, 'se_2', teams, 'Sam Naidoo', T5)).toMatchObject({
      ok: false,
      error: /A finding in the record quotes this transcript/,
    });
    expect(replaceTranscript(withKickoff(), 'se_2', teams, 'Sam Naidoo', T5).ok).toBe(false);
  });

  it('deletes it with every copy of its words, removing proposals and listing what keeps a statement (C8)', () => {
    const base = quoting(proposal(imported().workspace));
    // The consultant's finding also quotes a note, so it keeps a statement from the session.
    let ws = base.workspace;
    ws = {
      ...ws,
      notes: {
        ...ws.notes,
        no_2: { id: 'no_2', sessionId: 'se_2', text: 'No signal on the N1 for hours', writtenAt: T5, updatedAt: T5 },
      },
    };
    ws = value(
      updateFinding(
        ws,
        base.id,
        { evidence: [...ws.findings[base.id].evidence, { kind: 'note', noteId: 'no_2', quote: 'No signal on the N1' }] },
        'Sam Naidoo',
        T5,
      ),
    );
    const deleted = value(deleteTranscript(ws, 'se_2', '2026-11-06T08:00:00.000Z'));
    expect(deleted.removedProposalIds).toEqual(['fd_ai_peak']);
    expect(deleted.keptFindingIds).toEqual([base.id]);
    expect(transcriptOf(deleted.workspace, 'se_2')).toBeNull();
    expect(JSON.stringify(deleted.workspace)).not.toContain('lose signal');
    // Provenance follows what is left: a note, so it is the consultant's again (decision 9).
    expect(deleted.workspace.findings[base.id].provenance).toEqual({ kind: 'consultant' });
    clean(deleted.workspace);
  });
});

describe('provenance follows the evidence (decision 9)', () => {
  it('is "said in a session" while a finding quotes the transcript, and what it was created as otherwise', () => {
    const { workspace, id } = quoting(imported().workspace);
    expect(workspace.findings[id].provenance).toEqual({ kind: 'said-in-session' });
    const ws = value(updateFinding(workspace, id, { evidence: [] }, 'Sam Naidoo', T5));
    expect(ws.findings[id].provenance).toEqual({ kind: 'consultant' });
    expect(ws.findings[id].history.map((c) => c.field)).toEqual(['evidence']); // The evidence change explains it.
    clean(ws);
    const back = value(updateFinding(ws, id, { evidence: workspace.findings[id].evidence }, 'Sam Naidoo', T5));
    expect(back.findings[id].provenance).toEqual({ kind: 'said-in-session' });
  });

  it('makes an AI proposal accepted without its quote from the transcript AI-suggested', () => {
    const ws = proposal(imported().workspace);
    const accepted = value(acceptProposal(ws.findings.fd_ai_peak, 'Sam Naidoo', T5, { evidence: [] }));
    expect(accepted.provenance).toEqual({ kind: 'ai-suggested' });
  });

  it('is checked when a workspace is read', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_peak.provenance = { kind: 'consultant' };
    expect(validateWorkspace(ws).map((p) => p.code)).toEqual(['finding.provenance']);
  });
});

describe('deleting a finding (decision 15)', () => {
  it('deletes a finding in the record with its links; facts promoted from it say "source deleted"', () => {
    const ws = sampleWorkspace();
    const linked = structuredClone(ws);
    expect(Object.values(linked.relations).some((r) => r.fromId === 'fd_peak' || r.toId === 'fd_peak')).toBe(true);
    linked.knowledge.kf_1 = value(promoteToKnowledge(linked, 'fd_peak', 'kf_1', 'Sam Consultant', T3));
    const after = value(removeFinding(linked, 'fd_peak', T5));
    expect(after.findings.fd_peak).toBeUndefined();
    expect(Object.values(after.relations).some((r) => r.fromId === 'fd_peak' || r.toId === 'fd_peak')).toBe(false);
    expect(after.knowledge.kf_1.source).toMatchObject({ findingId: null, deletedAt: T5 });
    clean(after);
  });

  it('refuses a proposal under review: it is rejected instead', () => {
    expect(removeFinding(sampleWorkspace(), 'fd_risk', T5)).toMatchObject({ ok: false, error: /Reject a proposal instead/ });
    expect(removeFinding(sampleWorkspace(), 'fd_none', T5).ok).toBe(false);
  });
});

describe('amendments that change how long audio is kept (decision 10)', () => {
  /** A locked record with audio recording agreed, kept until the engagement ends. */
  const recorded = () => consentRecord({ given: { ...consentRecord().given, audioRecording: true } });
  const change = (fields: Partial<Extract<ConsentAmendment, { kind: 'change' }>>): ConsentAmendment => ({
    id: 'am_1',
    kind: 'change',
    by: 'Sam Consultant',
    at: T5,
    reason: 'The client asked for a shorter time.',
    ...fields,
  });

  it('needs the retention statement told in the new words', () => {
    expect(amendConsent(recorded(), change({ retention: { kind: 'days', days: 30 } }))).toMatchObject({
      ok: false,
      error: /told how long audio is kept in the old words/,
    });
    const told = change({ retention: { kind: 'days', days: 30 }, told: { retention: true }, wordingVersion: 'draft-1' });
    expect(amendConsent(recorded(), told).ok).toBe(true);
  });

  it('doesn’t need it when audio recording isn’t agreed, or the retention doesn’t change', () => {
    expect(amendConsent(consentRecord(), change({ retention: { kind: 'days', days: 30 } })).ok).toBe(true);
    expect(amendConsent(recorded(), change({ retention: { kind: 'until-engagement-ends' } })).ok).toBe(true);
  });

  it('needs it when audio is agreed after the retention changed while it wasn’t (review of Slice A)', () => {
    // Told "7 days"; the retention changes while audio is off, then audio is turned on.
    const record = consentRecord({ retention: { kind: 'days', days: 7 } });
    const first = change({ retention: { kind: 'until-engagement-ends' } });
    const amended = value(amendConsent(record, first));
    const audioOn = change({ id: 'am_2', at: '2026-11-05T10:00:00.000Z', given: { audioRecording: true } });
    expect(amendConsent(amended, audioOn)).toMatchObject({ ok: false, error: /old words/ });
    const toldAgain = { ...audioOn, told: { retention: true }, wordingVersion: 'draft-1' };
    expect(amendConsent(amended, toldAgain).ok).toBe(true);
    const ws = sampleWorkspace();
    ws.consents.cr_1 = { ...amended, amendments: [...amended.amendments, audioOn] };
    expect(validateWorkspace(ws).map((p) => p.code)).toEqual(['consent.told']);
    // Back to the retention they were told needs nothing new.
    const back = change({
      id: 'am_2',
      at: '2026-11-05T10:00:00.000Z',
      given: { audioRecording: true },
      retention: { kind: 'days', days: 7 },
    });
    expect(amendConsent(amended, back).ok).toBe(true);
  });

  it('is checked when a workspace is read', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1 = { ...recorded(), amendments: [change({ retention: { kind: 'days', days: 30 } })] };
    expect(validateWorkspace(ws).map((p) => p.code)).toEqual(['consent.told']);
  });
});

describe('the consent attachment (decision 12)', () => {
  const file = (id: string) => ({ id, name: 'signed-consent.pdf', mediaType: 'application/pdf', sizeBytes: 2048 });

  it('attaches one file to a locked record, keeping its confirmation, and replaces it', () => {
    const ws = sampleWorkspace();
    const first = value(attachToConsent(ws, 'se_1', file('fi_consent1'), 'Sam Consultant', T5));
    expect(first.replacedFileId).toBeNull();
    expect(first.workspace.consents.cr_1).toMatchObject({
      attachmentFileId: 'fi_consent1',
      confirmed: ws.consents.cr_1.confirmed,
      lockedAt: T2,
    });
    expect(first.workspace.files.fi_consent1).toMatchObject({
      purpose: 'consent-attachment',
      owner: { kind: 'session', sessionId: 'se_1' },
    });
    clean(first.workspace);
    const second = value(attachToConsent(first.workspace, 'se_1', file('fi_consent2'), 'Sam Consultant', T5));
    expect(second.replacedFileId).toBe('fi_consent1');
    expect(second.workspace.files.fi_consent1).toBeUndefined();
    clean(second.workspace);
    // Only through the record: the files list can't take it away on its own.
    expect(removeFileRef(second.workspace, 'fi_consent2').ok).toBe(false);
    const removed = value(removeConsentAttachment(second.workspace, 'se_1'));
    expect(removed.removedFileId).toBe('fi_consent2');
    expect(removed.workspace.consents.cr_1.attachmentFileId).toBeNull();
    expect(removed.workspace.consents.cr_1.confirmed).toEqual(ws.consents.cr_1.confirmed);
    clean(removed.workspace);
  });

  it('attaches to a draft record too, and is refused without a record or a name', () => {
    const ws = withKickoff({ confirmed: null });
    expect(attachToConsent(ws, 'se_2', file('fi_c1'), 'Sam', T5).ok).toBe(true);
    const none = withKickoff();
    delete none.consents.cr_2;
    expect(attachToConsent(none, 'se_2', file('fi_c1'), 'Sam', T5).ok).toBe(false);
    expect(attachToConsent(ws, 'se_2', file('fi_c1'), ' ', T5).ok).toBe(false);
    expect(removeConsentAttachment(ws, 'se_2').ok).toBe(false);
  });

  it('reports an attachment no record names', () => {
    const ws = value(attachToConsent(sampleWorkspace(), 'se_1', file('fi_consent1'), 'Sam Consultant', T5)).workspace;
    ws.consents.cr_1 = { ...ws.consents.cr_1, attachmentFileId: null };
    expect(validateWorkspace(ws).map((p) => p.code)).toEqual(['consent.attachment']);
  });
});

describe('the Amend… form (decision 10)', () => {
  const PROVIDER = 'Anthropic (api.anthropic.com)';
  const T6 = '2026-11-06T08:00:00.000Z';

  it('starts from the record as it stands, with nothing newly told', () => {
    const values = amendFormFor(sampleWorkspace().consents.cr_1);
    expect(values.given).toEqual(consentRecord().given);
    expect(Object.values(values.told).some((v) => v === true)).toBe(false);
    expect(values.reason).toBe('');
  });

  it('checks each new “yes” against what the client has been told, then records only what changed', () => {
    const ws = sampleWorkspace();
    const record = ws.consents.cr_1;
    let values = amendFormFor(record);
    values = {
      ...values,
      given: { ...values.given, aiExternal: true, externalProvider: PROVIDER },
      reason: 'They agreed by email.',
    };
    expect(amendIssues(record, values)).toEqual([
      { place: 'aiExternal', message: 'Tick what you told them: the external AI provider.' },
    ]);
    expect(amendConsentForm(ws, 'se_1', values, 'Sam Consultant', T6).ok).toBe(false);
    expect(canTellOnAmend(record, values, 'processingExternal')).toBe(true);
    expect(canTellOnAmend(record, values, 'transcribed')).toBe(false); // Told already.
    values = { ...values, told: { ...values.told, processingExternal: true, externalProvider: PROVIDER } };
    expect(amendIssues(record, values)).toEqual([]);
    const after = value(amendConsentForm(ws, 'se_1', values, 'Sam Consultant', T6));
    const [amendment] = after.consents.cr_1.amendments;
    expect(amendment).toMatchObject({
      kind: 'change',
      by: 'Sam Consultant',
      at: T6,
      reason: 'They agreed by email.',
      told: { processingExternal: true, externalProvider: PROVIDER },
      wordingVersion: CURRENT_WORDING,
      given: { aiExternal: true, externalProvider: PROVIDER },
    });
    expect(amendment).not.toHaveProperty('retention');
    expect(amendment).not.toHaveProperty('outcome');
    // The original stays as it was; what it allows now follows the amendment.
    expect(after.consents.cr_1.given).toEqual(record.given);
    expect(consentState(after.consents.cr_1).given.aiExternal).toBe(true);
    expect(after.consents.cr_1.confirmed).toEqual(record.confirmed);
    clean(after);
  });

  it('asks for a new retention to be told in its new words', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1 = { ...ws.consents.cr_1, given: { ...ws.consents.cr_1.given, audioRecording: true } };
    const record = ws.consents.cr_1;
    let values = { ...amendFormFor(record), retention: { kind: 'days', days: 30 } as const, reason: 'A shorter time.' };
    expect(canTellOnAmend(record, values, 'retention')).toBe(true);
    expect(amendIssues(record, values).map((i) => i.place)).toEqual(['retention']);
    expect(amendConsentForm(ws, 'se_1', values, 'Sam Consultant', T6)).toMatchObject({ ok: false, error: /old words/ });
    values = { ...values, told: { ...values.told, retention: true } };
    expect(amendIssues(record, values)).toEqual([]);
    const after = value(amendConsentForm(ws, 'se_1', values, 'Sam Consultant', T6));
    expect(consentState(after.consents.cr_1).retention).toEqual({ kind: 'days', days: 30 });
    clean(after);
  });

  it('refuses a change that changes nothing, one without a reason or a name, and one after a withdrawal', () => {
    const ws = sampleWorkspace();
    const values = amendFormFor(ws.consents.cr_1);
    expect(amendConsentForm(ws, 'se_1', { ...values, reason: 'No reason' }, 'Sam Consultant', T6)).toMatchObject({
      ok: false,
      error: /Nothing has changed/,
    });
    const off = { ...values, given: { ...values.given, aiLocal: false } };
    expect(amendConsentForm(ws, 'se_1', off, 'Sam Consultant', T6)).toMatchObject({ ok: false, error: /Say why/ });
    expect(amendConsentForm(ws, 'se_1', { ...off, reason: 'No AI.' }, ' ', T6)).toMatchObject({
      ok: false,
      error: /Give your name/,
    });
    const withdrawn = value(withdrawConsent(ws, 'se_1', 'They changed their mind.', 'Sam Consultant', T5));
    expect(amendConsentForm(withdrawn, 'se_1', { ...off, reason: 'No AI.' }, 'Sam Consultant', T6)).toMatchObject({
      ok: false,
      error: /withdrawn/,
    });
  });
});

describe('what keeps a statement from a session (decision 11)', () => {
  it('lists the findings with evidence from the session, and the facts quoting it or promoted from them', () => {
    const ws = sampleWorkspace();
    ws.knowledge.kf_1 = value(promoteToKnowledge(ws, 'fd_peak', 'kf_1', 'Sam Consultant', T3));
    const kept = keptFromSession(ws, 'se_1');
    expect(kept.findings.map((f) => f.id)).toContain('fd_peak');
    expect(kept.findings.every(isInRecord)).toBe(true); // Proposals under review aren't in the record.
    expect(kept.facts.map((f) => f.id)).toEqual(['kf_1']);
    expect(keptFromSession(ws, 'se_none')).toEqual({ findings: [], facts: [] });
  });

  it('still lists a fact after the transcript its finding rested on is deleted (review of Slice A)', () => {
    const ws = sampleWorkspace();
    ws.knowledge.kf_1 = value(promoteToKnowledge(ws, 'fd_peak', 'kf_1', 'Sam Consultant', T3));
    expect(ws.knowledge.kf_1.source?.sessionIds).toEqual(['se_1']);
    const after = value(deleteTranscript(ws, 'se_1', T5)).workspace;
    expect(after.knowledge.kf_1.source).toMatchObject({ findingId: null, quotes: [], sessionIds: ['se_1'] });
    expect(keptFromSession(after, 'se_1').facts.map((f) => f.id)).toEqual(['kf_1']);
    clean(after);
  });

  it('removes a fact as an ordinary step', () => {
    const ws = sampleWorkspace();
    ws.knowledge.kf_1 = value(promoteToKnowledge(ws, 'fd_peak', 'kf_1', 'Sam Consultant', T3));
    const after = value(removeFact(ws, 'kf_1'));
    expect(after.knowledge.kf_1).toBeUndefined();
    expect(removeFact(after, 'kf_1').ok).toBe(false);
    clean(after);
  });
});
