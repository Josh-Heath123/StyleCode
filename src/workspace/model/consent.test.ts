/**
 * Consent rules settled in WP5 (docs/spec/CONSENT.md, "Rules"). Rules C1 and
 * C4 are also covered in rules.test.ts and review.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { canUseAi, classifyProvider, editConsent, missingStatements } from './consent';
import { consentRecord, sampleWorkspace, T1, T2 } from './fixtures';
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
      processingLocation: true,
      retention: false,
      canStopOrDelete: false,
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
      processingLocation: false,
      retention: false,
      canStopOrDelete: false,
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
