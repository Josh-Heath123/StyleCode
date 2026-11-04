/**
 * Tests for the fixes from the Phase 0 independent review (WP9), one per finding.
 */
import { describe, expect, it } from 'vitest';
import { amendConsent, canCapture } from './consent';
import { consentRecord, sampleWorkspace, T0, T1, T3 } from './fixtures';
import type { CompanyWorkspace, FileRef } from './types';
import { sharedIds, validateWorkspace } from './validate';
import { checkBeforeSave, createWorkspace, parseWorkspace } from './workspace';

const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);
const LATER = '2026-11-04T12:00:00.000Z';

const file = (id: string, overrides: Partial<FileRef>): FileRef => ({
  id,
  owner: { kind: 'session', sessionId: 'se_1' },
  purpose: 'document',
  name: `${id}.bin`,
  mediaType: 'application/octet-stream',
  sizeBytes: 10,
  addedBy: 'Sam',
  addedAt: T1,
  ...overrides,
});

describe('amendments obey rule C2, told before agreed', () => {
  it('refuses an amendment agreeing to something the client was not told', () => {
    const record = consentRecord();
    record.told.recorded = false;
    const amended = amendConsent(record, {
      id: 'am_1',
      kind: 'change',
      by: 'Sam',
      at: T3,
      reason: 'Client agreed to recording.',
      given: { audioRecording: true },
    });
    expect(amended).toEqual({ ok: false, error: "The client wasn't told about this (recorded), so they can't agree to it." });
  });

  it('reports it in the validator, so recording is not allowed by a stored amendment', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.told.recorded = false;
    ws.consents.cr_1.amendments = [
      { id: 'am_1', kind: 'change', by: 'Sam', at: T3, reason: 'Agreed later.', given: { audioRecording: true } },
    ];
    expect(codes(ws)).toEqual(['consent.told']);
  });
});

describe('a damaged file entry does not lock the client out', () => {
  for (const [what, place] of [
    ['listed as audio', (ws: CompanyWorkspace) => (ws.sessions.se_1.audioFileIds = ['fi_bad'])],
    ['attached to the consent record', (ws: CompanyWorkspace) => (ws.consents.cr_1.attachmentFileId = 'fi_bad')],
  ] as const) {
    it(`opens read-only when a file without an owner is ${what}`, () => {
      const ws = sampleWorkspace();
      ws.files.fi_bad = { ...file('fi_bad', {}), owner: null } as unknown as FileRef;
      place(ws);
      const parsed = parseWorkspace(ws);
      expect(parsed.ok && parsed.access).toBe('read-only');
      expect(checkBeforeSave(ws).ok).toBe(false);
    });
  }
});

describe('rule C5 covers every session the AI was given', () => {
  it('refuses a proposal made from a declined session, even if it cites nothing there', () => {
    const ws = sampleWorkspace();
    ws.sessions.se_2 = { ...ws.sessions.se_1, id: 'se_2', title: 'Follow-up' };
    ws.participants.pa_c2 = { ...ws.participants.pa_client, id: 'pa_c2', sessionId: 'se_2' };
    const none = { audioRecording: false, transcription: false, aiLocal: false, aiExternal: false, externalProvider: null };
    ws.consents.cr_2 = consentRecord({
      id: 'cr_2',
      sessionId: 'se_2',
      askedParticipantIds: ['pa_c2'],
      given: none,
      outcome: { kind: 'declined' },
      lockedAt: null,
    });
    const origin = ws.findings.fd_risk.origin;
    if (origin.kind === 'ai') origin.inputSessionIds = ['se_1', 'se_2'];
    expect(codes(ws)).toEqual(['finding.aiConsent']);
  });

  it('refuses a proposal citing a session it was not given', () => {
    const ws = sampleWorkspace();
    const origin = ws.findings.fd_risk.origin;
    if (origin.kind === 'ai') origin.inputSessionIds = [];
    expect(codes(ws)).toEqual(['finding.origin']);
  });
});

describe('files say what they are for', () => {
  it('needs a known purpose, and audio listed on a session to be audio', () => {
    const ws = sampleWorkspace();
    ws.files.fi_1 = file('fi_1', { purpose: 'other' as never });
    expect(codes(ws)).toEqual(['field.value']);
    ws.files.fi_1 = file('fi_1', { purpose: 'document' });
    ws.sessions.se_1.audioFileIds = ['fi_1'];
    expect(codes(ws)).toEqual(['ref.missing']);
  });

  it('needs consent to recording for audio (rule C1)', () => {
    const ws = sampleWorkspace();
    ws.files.fi_a = file('fi_a', { purpose: 'audio', mediaType: 'audio/webm' });
    ws.sessions.se_1.audioFileIds = ['fi_a'];
    expect(codes(ws)).toEqual(['consent.required']);
    ws.consents.cr_1.given.audioRecording = true;
    expect(codes(ws)).toEqual([]);
  });

  it('accepts a consent attachment only if it is one', () => {
    const ws = sampleWorkspace();
    ws.files.fi_e = file('fi_e', { purpose: 'document' });
    ws.consents.cr_1.attachmentFileId = 'fi_e';
    expect(codes(ws)).toEqual(['ref.missing']);
    ws.files.fi_e.purpose = 'consent-attachment';
    expect(codes(ws)).toEqual([]);
  });
});

describe('smaller validator gaps', () => {
  it('refuses a consultant finding marked AI-suggested', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_peak.provenance = { kind: 'ai-suggested' };
    expect(codes(ws)).toContain('finding.provenance');
  });

  it('counts "conflicts with" in both directions as one link', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_risk.origin = { ...ws.findings.fd_stock.origin };
    ws.relations = {
      re_1: { id: 're_1', type: 'conflicts-with', fromId: 'fd_peak', toId: 'fd_stock', createdBy: 'Sam', createdAt: T3 },
      re_2: { id: 're_2', type: 'conflicts-with', fromId: 'fd_stock', toId: 'fd_peak', createdBy: 'Sam', createdAt: T3 },
    };
    expect(codes(ws)).toContain('relation.duplicate');
  });

  it('refuses the same person asked twice', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.askedParticipantIds = ['pa_client', 'pa_client'];
    expect(codes(ws)).toEqual(['consent.asked']);
  });

  it('never treats an amendment with an unreadable date as in force', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.amendments = [{ id: 'am_1', kind: 'withdrawal', by: 'Sam', at: 'garbage', reason: 'x' }];
    expect(codes(ws)).toEqual(['field.time']);
    expect(
      canCapture({ ...ws, transcripts: {}, segments: {}, findings: {}, relations: {} }, 'se_1', 'transcript-import').ok,
    ).toBe(true);
  });

  it('finds ids from one company kept in another company, even after the entity is deleted', () => {
    const a = sampleWorkspace();
    const b = createWorkspace({ name: 'Other Ltd' }, T0);
    b.engagements.en_9 = { ...a.engagements.en_1, id: 'en_9', companyId: b.company.id };
    b.findings.fd_9 = {
      ...a.findings.fd_peak,
      id: 'fd_9',
      engagementId: 'en_9',
      provenance: { kind: 'consultant' },
      evidence: [{ kind: 'deleted', sessionId: 'se_1', deletedAt: LATER }],
    };
    expect(validateWorkspace(b)).toEqual([]);
    expect(sharedIds([a, b])).toEqual(['se_1']);
  });
});
