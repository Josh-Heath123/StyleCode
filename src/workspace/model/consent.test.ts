/**
 * Consent rules settled in WP5 (docs/spec/CONSENT.md, "Rules"). Rules C1 and
 * C4 are also covered in rules.test.ts and review.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { canUseAi, checkSpeakers, classifyProvider, editConsent, missingStatements } from './consent';
import { promoteToKnowledge, removeTranscript } from './findings';
import { consentRecord, sampleWorkspace, T1, T2, T3 } from './fixtures';
import type { CompanyWorkspace } from './types';
import { validateWorkspace } from './validate';

const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);
const ANTHROPIC = 'Anthropic (api.anthropic.com)';

describe('C2: the client was told about everything they agreed to', () => {
  it('needs the statements for each item agreed, and that they can stop or delete', () => {
    const told = {
      recorded: false,
      transcribed: true,
      aiExtraction: false,
      processingLocal: true,
      processingExternal: false,
      retention: false,
      canStopOrDelete: false,
      externalProvider: null,
    };
    const record = consentRecord({ told });
    expect(missingStatements(record)).toEqual(['aiExtraction', 'canStopOrDelete']);
    const ws = sampleWorkspace();
    ws.consents.cr_1 = record;
    expect(codes(ws)).toEqual(['consent.told']);
  });

  it('needs the retention statement for audio recording', () => {
    const record = consentRecord();
    record.given.audioRecording = true;
    record.told.retention = false;
    expect(missingStatements(record)).toEqual(['retention']);
  });

  it('needs nothing when nothing was agreed', () => {
    const told = {
      recorded: false,
      transcribed: false,
      aiExtraction: false,
      processingLocal: false,
      processingExternal: false,
      retention: false,
      canStopOrDelete: false,
      externalProvider: null,
    };
    const none = { audioRecording: false, transcription: false, aiLocal: false, aiExternal: false, externalProvider: null };
    expect(missingStatements(consentRecord({ told, given: none, outcome: { kind: 'declined' } }))).toEqual([]);
  });
});

describe('C3: a confirmed record is confirmed again after any change', () => {
  it('clears the confirmation when what was recorded changes', () => {
    const record = consentRecord({ lockedAt: null });
    const edited = editConsent(record, { given: { ...record.given, aiLocal: false } }, T1);
    expect(edited.ok && edited.value.confirmed).toBeNull();
  });

  it('keeps it when only the attachment changes, or when confirming', () => {
    const record = consentRecord({ lockedAt: null });
    const attached = editConsent(record, { attachmentFileId: null }, T1);
    expect(attached.ok && attached.value.confirmed).toEqual(record.confirmed);
    const reconfirmed = editConsent(record, { askedBy: 'Sam C.', confirmed: { by: 'Sam C.', at: T1 } }, T1);
    expect(reconfirmed.ok && reconfirmed.value.confirmed).toEqual({ by: 'Sam C.', at: T1 });
  });
});

describe('C5 and C6: AI processing, local or external', () => {
  it('classifies providers: only a model at a loopback address is local', () => {
    expect(classifyProvider({ provider: 'ollama', baseUrl: 'http://localhost:11434' })).toEqual({ kind: 'local' });
    expect(classifyProvider({ provider: 'openai', baseUrl: 'http://127.0.0.1:1234/v1' })).toEqual({ kind: 'local' });
    expect(classifyProvider({ provider: 'ollama', baseUrl: 'http://192.168.1.20:11434' })).toEqual({
      kind: 'external',
      provider: 'Ollama (192.168.1.20)',
    });
    // Ollama's cloud models run on ollama.com, even through Ollama on this computer.
    for (const model of ['gpt-oss:120b-cloud', 'kimi-k2:cloud', 'Qwen3-Coder:480B-CLOUD']) {
      expect(classifyProvider({ provider: 'ollama', baseUrl: 'http://localhost:11434', model })).toEqual({
        kind: 'external',
        provider: 'Ollama Cloud (ollama.com)',
      });
    }
    expect(classifyProvider({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' })).toEqual({
      kind: 'local',
    });
    expect(classifyProvider({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'cloudy:7b' })).toEqual({
      kind: 'local',
    });
    expect(classifyProvider({ provider: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'some-cloud' })).toEqual({
      kind: 'local',
    });
    expect(classifyProvider({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com' })).toEqual({
      kind: 'external',
      provider: ANTHROPIC,
    });
    expect(classifyProvider({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' })).toEqual({
      kind: 'external',
      provider: 'OpenAI (api.openai.com)',
    });
    expect(classifyProvider({ provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1' })).toEqual({
      kind: 'external',
      provider: 'OpenAI-compatible service (api.groq.com)',
    });
  });

  it('allows local processing only with consent to AI on this computer', () => {
    const ws = sampleWorkspace();
    expect(canUseAi(ws, 'se_1', { kind: 'local' })).toEqual({ ok: true, value: true });
    expect(canUseAi(ws, 'se_1', { kind: 'external', provider: ANTHROPIC })).toEqual({
      ok: false,
      error: 'The client did not agree to an external AI provider. Use a model on this computer.',
    });
  });

  it('allows external processing only by the provider the client agreed to', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.given = { ...ws.consents.cr_1.given, aiExternal: true, externalProvider: ANTHROPIC };
    expect(canUseAi(ws, 'se_1', { kind: 'external', provider: 'anthropic (API.anthropic.com) ' }).ok).toBe(true);
    expect(canUseAi(ws, 'se_1', { kind: 'external', provider: 'OpenAI (api.openai.com)' })).toEqual({
      ok: false,
      error: `The client agreed to ${ANTHROPIC}, not OpenAI (api.openai.com).`,
    });
  });

  it('refuses AI for a declined, withdrawn or unconfirmed session, notes included (MVP Q15)', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.amendments = [{ id: 'am_1', kind: 'withdrawal', by: 'Sam', at: T2, reason: 'Client asked us to stop.' }];
    expect(canUseAi(ws, 'se_1', { kind: 'local' }).ok).toBe(false);
    ws.consents.cr_1 = consentRecord({ confirmed: null, lockedAt: null });
    expect(canUseAi(ws, 'se_1', { kind: 'local' }).ok).toBe(false);
  });

  it('refuses a proposal whose processing the consent did not allow', () => {
    const ws = sampleWorkspace();
    const origin = ws.findings.fd_risk.origin;
    if (origin.kind === 'ai') origin.processing = { kind: 'external', provider: ANTHROPIC };
    expect(codes(ws)).toEqual(['finding.aiConsent']);
    if (origin.kind === 'ai') (origin as unknown as Record<string, unknown>).processing = undefined;
    expect(codes(ws)).toEqual(['finding.origin']);
  });
});

describe('C11: speakers who were not asked for consent', () => {
  it('lists labels matched to neither an asked client nor the consultant side', () => {
    const ws = sampleWorkspace();
    ws.participants.pa_jo = { ...ws.participants.pa_client, id: 'pa_jo', name: 'Jo Baker', speakerLabels: ['Jo'] };
    const check = checkSpeakers(ws, 'se_1', ['Alex Owner', 'Sam', 'Jo', 'Guest 1', 'Guest 1', null]);
    expect(check).toEqual({ unaskedSpeakers: ['Jo', 'Guest 1'], unnamedSpeakers: true });
    expect(checkSpeakers(ws, 'se_1', ['Alex Owner', 'Sam'])).toEqual({ unaskedSpeakers: [], unnamedSpeakers: false });
  });

  it('keeps the warning on the transcript', () => {
    const ws = sampleWorkspace();
    ws.transcripts.tr_1.unaskedSpeakers = ['Guest 1'];
    expect(codes(ws)).toEqual([]);
    (ws.transcripts.tr_1 as unknown as Record<string, unknown>).unaskedSpeakers = undefined;
    expect(codes(ws)).toEqual(['field.type']);
  });
});

describe('C8: deleting the transcript after a withdrawal', () => {
  const withdrawn = () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.amendments = [
      { id: 'am_1', kind: 'withdrawal', by: 'Sam', at: T3, reason: 'Client asked us to delete it.' },
    ];
    const fact = promoteToKnowledge(ws, 'fd_peak', 'kf_1', 'Sam Consultant', T3);
    if (fact.ok) ws.knowledge.kf_1 = fact.value;
    // A finding resting on the transcript and on a note: it keeps its statement.
    ws.findings.fd_mixed = {
      ...ws.findings.fd_peak,
      id: 'fd_mixed',
      provenance: { kind: 'consultant' },
      evidence: [
        { kind: 'segment', segmentId: 'sg_2', quote: 'we keep stock in a spreadsheet' },
        { kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' },
      ],
    };
    return ws;
  };
  const LATER = '2026-11-05T09:00:00.000Z';

  it('removes the transcript and every copy of its words, leaving a valid workspace', () => {
    const removal = removeTranscript(withdrawn(), 'se_1', LATER);
    expect(removal.ok).toBe(true);
    if (!removal.ok) return;
    const { workspace } = removal.value;
    expect(workspace.transcripts).toEqual({});
    expect(workspace.segments).toEqual({});
    expect(JSON.stringify(workspace)).not.toContain('five times as many orders');
    expect(JSON.stringify(workspace)).not.toContain('keep stock in a spreadsheet');
    expect(validateWorkspace(workspace)).toEqual([]);
    expect(workspace.consents.cr_1.amendments).toHaveLength(1);
  });

  it('removes findings left without a basis, and lists what keeps a statement from the session', () => {
    const result = removeTranscript(withdrawn(), 'se_1', LATER);
    if (!result.ok) throw new Error(result.error);
    const removal = result.value;
    // fd_peak and fd_stock were said in the session and cited only the transcript.
    expect(removal.removedFindingIds.sort()).toEqual(['fd_peak', 'fd_stock']);
    expect(removal.keptFindingIds).toEqual(['fd_mixed']);
    expect(removal.workspace.findings.fd_mixed.evidence).toEqual([
      { kind: 'deleted', sessionId: 'se_1', deletedAt: LATER },
      { kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' },
    ]);
    // The fact keeps its statement, loses its quotes, and its source is marked deleted.
    expect(removal.factIds).toEqual(['kf_1']);
    expect(removal.workspace.knowledge.kf_1.source).toMatchObject({ findingId: null, quotes: [], deletedAt: LATER });
    expect(removal.workspace.knowledge.kf_1.statement).toBe('Orders peak in December, at about five times the usual volume.');
  });

  it('refuses a session without a transcript', () => {
    const ws = sampleWorkspace();
    ws.transcripts = {};
    expect(removeTranscript(ws, 'se_1', LATER).ok).toBe(false);
  });
});
