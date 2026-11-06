import { describe, expect, it } from 'vitest';
import { aiPermission, amendConsent, canCapture, consentState, editConsent, lockConsent } from './consent';
import { acceptProposal, isInRecord, recordGroups, rejectProposal, setStatus } from './findings';
import { consentRecord, sampleWorkspace, T0, T1, T2, T3 } from './fixtures';
import { validateWorkspace } from './validate';

describe('consent: what a session allows', () => {
  const blank = () => {
    const ws = sampleWorkspace();
    ws.transcripts = {};
    ws.segments = {};
    ws.findings = {};
    ws.relations = {};
    ws.consents.cr_1 = consentRecord({ lockedAt: null });
    return ws;
  };

  it('allows nothing without a confirmed record', () => {
    const ws = blank();
    ws.consents = {};
    expect(canCapture(ws, 'se_1', 'transcript-import')).toEqual({
      ok: false,
      error: 'Fill in the consent form for this session first.',
    });
    ws.consents.cr_1 = consentRecord({ confirmed: null, lockedAt: null });
    expect(canCapture(ws, 'se_1', 'transcript-import').ok).toBe(false);
    expect(aiPermission(ws, 'se_1')).toEqual({ local: false, external: false, externalProvider: null });
  });

  it('allows transcript import with consent to transcription, and recording only with consent to recording', () => {
    const ws = blank();
    expect(canCapture(ws, 'se_1', 'transcript-import').ok).toBe(true);
    expect(canCapture(ws, 'se_1', 'recording')).toEqual({ ok: false, error: 'The client did not agree to audio recording.' });
  });

  it('allows only notes when consent is declined', () => {
    const ws = blank();
    ws.consents.cr_1 = consentRecord({
      lockedAt: null,
      outcome: { kind: 'declined' },
      given: { audioRecording: false, transcription: false, aiLocal: false, aiExternal: false, externalProvider: null },
    });
    expect(canCapture(ws, 'se_1', 'transcript-import').ok).toBe(false);
    expect(aiPermission(ws, 'se_1').local).toBe(false);
  });

  it('refuses external AI unless the client agreed to it, naming the provider', () => {
    const ws = blank();
    expect(aiPermission(ws, 'se_1')).toEqual({ local: true, external: false, externalProvider: null });
    ws.consents.cr_1.given = {
      audioRecording: false,
      transcription: true,
      aiLocal: true,
      aiExternal: true,
      externalProvider: 'Anthropic',
    };
    expect(aiPermission(ws, 'se_1')).toEqual({ local: true, external: true, externalProvider: 'Anthropic' });
  });

  it('refuses a second transcript', () => {
    expect(canCapture(sampleWorkspace(), 'se_1', 'transcript-import')).toEqual({
      ok: false,
      error: 'This session already has a transcript.',
    });
  });
});

describe('consent: locking and amendments', () => {
  it('can be edited until it is locked, and only amended after', () => {
    const draft = consentRecord({ lockedAt: null });
    expect(editConsent(draft, { askedBy: 'Sam C.' }, T1).ok).toBe(true);
    const locked = lockConsent(draft, T2);
    expect(locked.ok && locked.value.lockedAt).toBe(T2);
    if (!locked.ok) return;
    expect(editConsent(locked.value, { askedBy: 'Someone else' }, T3).ok).toBe(false);
    expect(lockConsent(locked.value, T3)).toEqual(locked);
  });

  it('cannot lock a draft', () => {
    expect(lockConsent(consentRecord({ confirmed: null, lockedAt: null }), T2).ok).toBe(false);
  });

  it('applies amendments in order, from their date', () => {
    const record = consentRecord();
    const amended = amendConsent(record, {
      id: 'am_1',
      kind: 'change',
      by: 'Sam',
      at: T3,
      reason: 'Client agreed by email.',
      told: { processingExternal: true, externalProvider: 'OpenAI' },
      wordingVersion: 'draft-1',
      given: { aiExternal: true, externalProvider: 'OpenAI' },
    });
    expect(amended.ok).toBe(true);
    if (!amended.ok) return;
    expect(consentState(amended.value, T2).given.aiExternal).toBe(false);
    expect(consentState(amended.value).given).toMatchObject({ aiExternal: true, externalProvider: 'OpenAI' });
    expect(record.amendments).toEqual([]);
  });

  it('records a withdrawal as a dated entry that stops everything after it', () => {
    const withdrawn = amendConsent(consentRecord(), {
      id: 'am_1',
      kind: 'withdrawal',
      by: 'Sam',
      at: T3,
      reason: 'Client asked us to stop.',
    });
    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    expect(consentState(withdrawn.value)).toMatchObject({ withdrawn: true, given: { transcription: false, aiLocal: false } });
    expect(consentState(withdrawn.value, T2).given.transcription).toBe(true);
    expect(amendConsent(withdrawn.value, { id: 'am_2', kind: 'change', by: 'Sam', at: T3, reason: 'Again.' }).ok).toBe(false);
  });

  it('refuses amendments that are undated, unexplained or before the lock', () => {
    const record = consentRecord();
    expect(amendConsent(record, { id: 'am_1', kind: 'withdrawal', by: 'Sam', at: T0, reason: 'Early.' }).ok).toBe(false);
    expect(amendConsent(record, { id: 'am_1', kind: 'withdrawal', by: 'Sam', at: T3, reason: ' ' }).ok).toBe(false);
    // A change to an unlocked record is an edit, not an amendment.
    expect(
      amendConsent(consentRecord({ lockedAt: null }), { id: 'am_1', kind: 'change', by: 'Sam', at: T3, reason: 'x' }).ok,
    ).toBe(false);
  });
});

describe('findings: review', () => {
  it('becomes confirmed only through the consultant, recording who and when', () => {
    const ws = sampleWorkspace();
    const accepted = acceptProposal(ws.findings.fd_risk, 'Sam Consultant', T3, { status: 'confirmed' });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.statusSet).toEqual({ by: { kind: 'consultant', name: 'Sam Consultant' }, at: T3 });
    expect(accepted.value.origin).toMatchObject({ review: { state: 'accepted', by: 'Sam Consultant', at: T3 } });
    expect(isInRecord(accepted.value)).toBe(true);
    ws.findings.fd_risk = accepted.value;
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it('keeps the AI proposed status unless the consultant chooses another', () => {
    const accepted = acceptProposal(sampleWorkspace().findings.fd_risk, 'Sam', T3);
    expect(accepted.ok && accepted.value.status).toBe('suggested');
  });

  it('keeps a rejected proposal out of the record', () => {
    const ws = sampleWorkspace();
    const rejected = rejectProposal(ws.findings.fd_risk, 'Sam', T3);
    expect(rejected.ok && isInRecord(rejected.value)).toBe(false);
    if (!rejected.ok) return;
    expect(acceptProposal(rejected.value, 'Sam', T3).ok).toBe(false);
    ws.findings.fd_risk = rejected.value;
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it('needs a name, and only reviews pending proposals', () => {
    const ws = sampleWorkspace();
    expect(acceptProposal(ws.findings.fd_risk, ' ', T3).ok).toBe(false);
    expect(acceptProposal(ws.findings.fd_peak, 'Sam', T3).ok).toBe(false);
  });

  it('changes status in the record only, recording who and when', () => {
    const ws = sampleWorkspace();
    expect(setStatus(ws.findings.fd_risk, 'confirmed', 'Sam', T3).ok).toBe(false);
    const changed = setStatus(ws.findings.fd_stock, 'confirmed', 'Sam', T3);
    expect(changed.ok && changed.value.statusSet.by).toEqual({ kind: 'consultant', name: 'Sam' });
  });
});

describe("findings: the engagement's record", () => {
  it('groups accepted findings as confirmed, assumptions and open, leaving out pending proposals', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_q = {
      ...ws.findings.fd_peak,
      id: 'fd_q',
      kind: 'open-question',
      statement: 'Do they deliver?',
      status: 'confirmed',
      provenance: { kind: 'consultant' },
      evidence: [],
    };
    const groups = recordGroups(ws, 'en_1');
    expect(groups.confirmed.map((f) => f.id)).toEqual(['fd_peak']);
    expect(groups.assumptions.map((f) => f.id)).toEqual(['fd_stock']);
    expect(groups.open.map((f) => f.id)).toEqual(['fd_q']);
    expect(groups.suggested).toEqual([]);
  });
});
