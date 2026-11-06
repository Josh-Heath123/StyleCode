/**
 * Tests for the model changes of Workspace Phase 1, WP4
 * (docs/phase-1/PHASE-1-BRIEF.md), one block per change.
 */
import { describe, expect, it } from 'vitest';
import { amendConsent, canUseAi, editConsent, missingStatements, toldIssues } from './consent';
import { promoteToKnowledge, removeEngagement, removeSession } from './findings';
import { consentRecord, sampleWorkspace, T0, T1, T2, T3 } from './fixtures';
import type { CompanyWorkspace, ConsentAmendment, ConsentRecord, Finding } from './types';
import { validateWorkspace } from './validate';
import { checkBeforeSave, editCompany } from './workspace';

const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);
const LATER = '2026-11-04T12:00:00.000Z';
const ANTHROPIC = 'Anthropic (api.anthropic.com)';

/** The sample workspace with nothing captured yet, so its consent record can be unlocked. */
function beforeCapture(record: Partial<ConsentRecord> = {}): CompanyWorkspace {
  const ws = sampleWorkspace();
  ws.transcripts = {};
  ws.segments = {};
  ws.findings = {};
  ws.relations = {};
  ws.consents.cr_1 = consentRecord({ lockedAt: null, ...record });
  return ws;
}

const change = (fields: Partial<Extract<ConsentAmendment, { kind: 'change' }>>, at = T3): ConsentAmendment => ({
  id: 'am_1',
  kind: 'change',
  by: 'Sam Consultant',
  at,
  reason: 'The client agreed by email.',
  ...fields,
});

describe('1: two statements for where the AI runs (decision 2)', () => {
  const everything = consentRecord().told;

  it('needs the local statement for local AI, and the external one for external AI', () => {
    const local = consentRecord({ told: { ...everything, processingLocal: false } });
    expect(missingStatements(local)).toEqual(['processingLocal']);
    const external = consentRecord({
      given: { ...consentRecord().given, aiLocal: false, aiExternal: true, externalProvider: ANTHROPIC },
    });
    // Told only that the AI runs on this computer.
    expect(missingStatements(external)).toEqual(['processingExternal']);
  });

  it('needs the external statement to have named the provider agreed to', () => {
    const record = consentRecord({
      told: { ...everything, processingExternal: true, externalProvider: 'OpenAI (api.openai.com)' },
      given: { ...consentRecord().given, aiExternal: true, externalProvider: ANTHROPIC },
    });
    expect(missingStatements(record)).toEqual(['processingExternal']);
    record.told.externalProvider = ' anthropic (API.anthropic.com) ';
    expect(missingStatements(record)).toEqual([]);
  });

  it('names a provider exactly when the client was told about external AI', () => {
    expect(toldIssues({ ...everything, processingExternal: true, externalProvider: null })).toMatchObject([
      { code: 'consent.provider' },
    ]);
    expect(toldIssues({ ...everything, externalProvider: ANTHROPIC })).toMatchObject([{ code: 'consent.provider' }]);
    expect(toldIssues({ ...everything, processingLocation: true })).toMatchObject([{ code: 'field.value' }]);
    const ws = sampleWorkspace();
    ws.consents.cr_1.told = { ...everything, processingExternal: true, externalProvider: ' ' };
    expect(codes(ws)).toEqual(['consent.provider']);
  });
});

describe('2: amendments record what the client was newly told (decision 3)', () => {
  const external = { aiExternal: true, externalProvider: ANTHROPIC };

  it('lets the client agree to external AI after being told by email', () => {
    const told = change({
      told: { processingExternal: true, externalProvider: ANTHROPIC },
      wordingVersion: 'draft-1',
      given: external,
    });
    const amended = amendConsent(consentRecord(), told);
    expect(amended.ok).toBe(true);
    if (!amended.ok) return;
    const ws = sampleWorkspace();
    ws.consents.cr_1 = amended.value;
    expect(codes(ws)).toEqual([]);
    expect(canUseAi(ws, 'se_1', { kind: 'external', provider: ANTHROPIC }).ok).toBe(true);
    // Not before the amendment.
    expect(canUseAi(ws, 'se_1', { kind: 'external', provider: ANTHROPIC }, T2).ok).toBe(false);
  });

  it("refuses a yes to something the client hasn't been told, in the model and the validator", () => {
    expect(amendConsent(consentRecord(), change({ given: external }))).toEqual({
      ok: false,
      error: "The client wasn't told about this (processingExternal), so they can't agree to it.",
    });
    const ws = sampleWorkspace();
    ws.consents.cr_1.amendments = [change({ given: external })];
    expect(codes(ws)).toEqual(['consent.told']);
  });

  it('counts what an earlier amendment told the client', () => {
    const first = amendConsent(
      consentRecord(),
      change({ told: { processingExternal: true, externalProvider: ANTHROPIC }, wordingVersion: 'draft-1' }, T3),
    );
    if (!first.ok) throw new Error(first.error);
    const second = amendConsent(first.value, { ...change({ given: external }, LATER), id: 'am_2' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const ws = sampleWorkspace();
    ws.consents.cr_1 = second.value;
    expect(codes(ws)).toEqual([]);
  });

  it('names the wording shown whenever it records what the client was told, and never takes a statement back', () => {
    const noWording = change({ told: { recorded: true } });
    expect(amendConsent(consentRecord(), noWording).ok).toBe(false);
    expect(amendConsent(consentRecord(), change({ wordingVersion: 'draft-1' })).ok).toBe(false);
    expect(amendConsent(consentRecord(), change({ told: { recorded: false }, wordingVersion: 'draft-1' })).ok).toBe(false);
    expect(amendConsent(consentRecord(), change({ told: { processingExternal: true }, wordingVersion: 'draft-1' })).ok).toBe(
      false,
    );
    const ws = sampleWorkspace();
    ws.consents.cr_1.amendments = [noWording];
    expect(codes(ws)).toEqual(['consent.wording']);
  });
});

describe('3: withdrawal on a record that is not locked yet', () => {
  const withdrawal: ConsentAmendment = { id: 'am_1', kind: 'withdrawal', by: 'Sam Consultant', at: T3, reason: 'Asked to stop.' };

  it('is recorded as a dated amendment, and locks the record', () => {
    const withdrawn = amendConsent(consentRecord({ lockedAt: null }), withdrawal);
    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    expect(withdrawn.value.lockedAt).toBe(T3);
    expect(withdrawn.value.amendments).toEqual([withdrawal]);
    const ws = beforeCapture();
    ws.consents.cr_1 = withdrawn.value;
    expect(codes(ws)).toEqual([]);
    expect(editConsent(withdrawn.value, { askedBy: 'Someone else' }, LATER).ok).toBe(false);
  });

  it('needs a confirmed record, dated after it was confirmed', () => {
    expect(amendConsent(consentRecord({ lockedAt: null, confirmed: null }), withdrawal).ok).toBe(false);
    const confirmedLate = consentRecord({ lockedAt: null, confirmed: { by: 'Sam Consultant', at: T3 } });
    expect(amendConsent(confirmedLate, { ...withdrawal, at: T1 }).ok).toBe(false);
  });
});

describe('4: the future-consideration finding kind', () => {
  it('is a kind the consultant can give a finding', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_peak.kind = 'future-consideration';
    expect(codes(ws)).toEqual([]);
  });
});

/** A second session in the same engagement, with a note, and a finding resting on both sessions' notes. */
function twoSessions(): CompanyWorkspace {
  const ws = sampleWorkspace();
  ws.sessions.se_2 = { ...ws.sessions.se_1, id: 'se_2', title: 'Follow-up', startsAt: T3, createdAt: T3, updatedAt: T3 };
  ws.notes.no_2 = {
    id: 'no_2',
    sessionId: 'se_2',
    text: 'Delivery vans leave at six every morning.',
    writtenAt: T3,
    updatedAt: T3,
  };
  const both: Finding = {
    id: 'fd_both',
    engagementId: 'en_1',
    kind: 'constraint',
    statement: 'Orders must be ready before the vans leave, even at month end.',
    status: 'assumption',
    statusSet: { by: { kind: 'consultant', name: 'Sam Consultant' }, at: LATER },
    provenance: { kind: 'consultant' },
    evidence: [
      { kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' },
      { kind: 'note', noteId: 'no_2', quote: 'vans leave at six' },
    ],
    origin: { kind: 'consultant', by: 'Sam Consultant', at: LATER },
    history: [
      {
        field: 'evidence',
        from: [{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' }],
        to: [
          { kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' },
          { kind: 'note', noteId: 'no_2', quote: 'vans leave at six' },
        ],
        by: 'Sam Consultant',
        at: LATER,
      },
    ],
    createdAt: LATER,
    updatedAt: LATER,
  };
  ws.findings.fd_both = both;
  return ws;
}

describe('5: deleting a session (decision 4)', () => {
  it('removes the session and everything in it, and the findings that rested only on it', () => {
    const removal = removeSession(sampleWorkspace(), 'se_1', LATER);
    if (!removal.ok) throw new Error(removal.error);
    const ws = removal.value.workspace;
    for (const map of [
      'sessions',
      'participants',
      'consents',
      'transcripts',
      'segments',
      'notes',
      'findings',
      'relations',
    ] as const) {
      expect(ws[map], map).toEqual({});
    }
    expect(removal.value.removedFindingIds.sort()).toEqual(['fd_peak', 'fd_risk', 'fd_stock']);
    expect(Object.keys(ws.engagements)).toEqual(['en_1']);
    expect(checkBeforeSave(ws)).toEqual({ ok: true });
  });

  it("keeps a finding's evidence from other sessions, and leaves none of the deleted session's words in it", () => {
    const removal = removeSession(twoSessions(), 'se_1', LATER);
    if (!removal.ok) throw new Error(removal.error);
    const { workspace: ws, keptFindingIds } = removal.value;
    expect(keptFindingIds).toEqual(['fd_both']);
    expect(ws.findings.fd_both.evidence).toEqual([
      { kind: 'deleted', sessionId: 'se_1', deletedAt: LATER },
      { kind: 'note', noteId: 'no_2', quote: 'vans leave at six' },
    ]);
    expect(JSON.stringify(ws.findings)).not.toMatch(/month end"|spreadsheet conflicts/);
    expect(Object.keys(ws.sessions)).toEqual(['se_2']);
    expect(codes(ws)).toEqual([]);
  });

  it('keeps company knowledge promoted from a removed finding, marked "source deleted", with its quotes', () => {
    const before = sampleWorkspace();
    const fact = promoteToKnowledge(before, 'fd_peak', 'kf_1', 'Sam Consultant', T3);
    if (!fact.ok) throw new Error(fact.error);
    before.knowledge.kf_1 = fact.value;
    const removal = removeSession(before, 'se_1', LATER);
    if (!removal.ok) throw new Error(removal.error);
    expect(removal.value.factIds).toEqual(['kf_1']);
    expect(removal.value.workspace.knowledge.kf_1.source).toMatchObject({
      findingId: null,
      deletedAt: LATER,
      quotes: fact.value.source?.quotes,
    });
    expect(codes(removal.value.workspace)).toEqual([]);
  });

  it("removes the session's files, and lists them", () => {
    const ws = sampleWorkspace();
    ws.files.fi_form = {
      id: 'fi_form',
      owner: { kind: 'session', sessionId: 'se_1' },
      purpose: 'consent-attachment',
      name: 'Signed form.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 1200,
      addedBy: 'Sam Consultant',
      addedAt: T0,
    };
    ws.consents.cr_1.attachmentFileId = 'fi_form';
    const removal = removeSession(ws, 'se_1', LATER);
    if (!removal.ok) throw new Error(removal.error);
    expect(removal.value.removedFileIds).toEqual(['fi_form']);
    expect(removal.value.workspace.files).toEqual({});
  });

  it('refuses a session that does not exist', () => {
    expect(removeSession(sampleWorkspace(), 'se_none', LATER).ok).toBe(false);
  });
});

describe('6: deleting an engagement', () => {
  it('removes its findings, sessions, designs and files, and leaves other engagements alone', () => {
    const ws = twoSessions();
    ws.engagements.en_2 = { ...ws.engagements.en_1, id: 'en_2', name: 'Stock system' };
    ws.sessions.se_3 = { ...ws.sessions.se_1, id: 'se_3', engagementId: 'en_2', title: 'Stock walk-through' };
    ws.files.fi_brief = {
      id: 'fi_brief',
      owner: { kind: 'engagement', engagementId: 'en_1' },
      purpose: 'document',
      name: 'Brief.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 3400,
      addedBy: 'Sam Consultant',
      addedAt: T0,
    };
    const fact = promoteToKnowledge(ws, 'fd_peak', 'kf_1', 'Sam Consultant', T3);
    if (!fact.ok) throw new Error(fact.error);
    ws.knowledge.kf_1 = fact.value;

    const removal = removeEngagement(ws, 'en_1', LATER);
    if (!removal.ok) throw new Error(removal.error);
    const after = removal.value.workspace;
    expect(Object.keys(after.engagements)).toEqual(['en_2']);
    expect(Object.keys(after.sessions)).toEqual(['se_3']);
    expect(after.findings).toEqual({});
    expect(after.designs).toEqual({});
    expect(after.notes).toEqual({});
    expect(after.files).toEqual({});
    expect(removal.value.removedFindingIds.sort()).toEqual(['fd_both', 'fd_peak', 'fd_risk', 'fd_stock']);
    expect(removal.value.removedFileIds).toEqual(['fi_brief']);
    expect(removal.value.factIds).toEqual(['kf_1']);
    expect(after.knowledge.kf_1.source).toMatchObject({ findingId: null, deletedAt: LATER });
    expect(codes(after)).toEqual([]);
  });

  it('refuses an engagement that does not exist', () => {
    expect(removeEngagement(sampleWorkspace(), 'en_none', LATER).ok).toBe(false);
  });
});

describe('editing the company profile', () => {
  it('changes the fields given, trims the name, and refuses an empty one', () => {
    const ws = sampleWorkspace();
    const edited = editCompany(ws, { name: '  Harbour Bakeries ', notes: 'Prefers calls after 2pm.' }, LATER);
    if (!edited.ok) throw new Error(edited.error);
    expect(edited.value.company).toMatchObject({ name: 'Harbour Bakeries', notes: 'Prefers calls after 2pm.', updatedAt: LATER });
    expect(codes(edited.value)).toEqual([]);
    expect(editCompany(ws, { name: ' ' }, LATER).ok).toBe(false);
  });

  it('returns the same workspace when nothing changes', () => {
    const ws = sampleWorkspace();
    expect(editCompany(ws, { name: 'Harbour Bakery', industry: 'Food retail' }, LATER)).toEqual({ ok: true, value: ws });
  });
});
