/**
 * Tests for the changes from the WP3 review (docs/spec/DOMAIN-MODEL.md,
 * "Changes after review"), one block per point.
 */
import { describe, expect, it } from 'vitest';
import { aiPermission, amendConsent, consentState } from './consent';
import { acceptProposal, editFinding, promoteToKnowledge, removeFindings, setStatus } from './findings';
import { consentRecord, sampleWorkspace, T0, T3 } from './fixtures';
import type { CompanyWorkspace, ConsentAmendment } from './types';
import { isQuoteLongEnough } from './util';
import { sharedIds, validateWorkspace } from './validate';
import { checkBeforeSave, createWorkspace, parseWorkspace } from './workspace';

const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);
const LATER = '2026-11-04T12:00:00.000Z';

function withFact(): CompanyWorkspace {
  const ws = sampleWorkspace();
  const fact = promoteToKnowledge(ws, 'fd_peak', 'kf_1', 'Sam Consultant', T3);
  if (!fact.ok) throw new Error(fact.error);
  ws.knowledge.kf_1 = fact.value;
  return ws;
}

describe('1: consent amendments are validated like the record', () => {
  const amend = (ws: CompanyWorkspace, fields: Record<string, unknown>) => {
    ws.consents.cr_1.amendments = [
      { id: 'am_1', kind: 'change', by: 'Sam', at: T3, reason: 'Client asked.', ...fields } as ConsentAmendment,
    ];
  };

  it('refuses external AI turned on without a named provider', () => {
    const ws = sampleWorkspace();
    amend(ws, { given: { aiExternal: true } });
    expect(codes(ws)).toEqual(['consent.provider']);
    const refused = amendConsent(consentRecord(), {
      id: 'am_1',
      kind: 'change',
      by: 'Sam',
      at: T3,
      reason: 'x',
      given: { aiExternal: true },
    });
    expect(refused).toEqual({ ok: false, error: 'Name the external AI provider the client agreed to.' });
  });

  it('refuses values that are not yes or no, and fields the form does not have', () => {
    const ws = sampleWorkspace();
    amend(ws, { given: { transcription: 'yes' } });
    expect(codes(ws)).toEqual(['field.type']);
    amend(ws, { given: { recordVideo: true } });
    expect(codes(ws)).toEqual(['field.value']);
  });

  it('refuses limits that are not described, and invalid retention', () => {
    const ws = sampleWorkspace();
    amend(ws, { outcome: { kind: 'limited', limits: ' ' } });
    expect(codes(ws)).toEqual(['consent.limits']);
    amend(ws, { retention: { kind: 'days', days: 0 } });
    expect(codes(ws)).toEqual(['consent.retention']);
  });

  it('checks the terms left after each amendment', () => {
    const ws = sampleWorkspace();
    amend(ws, { outcome: { kind: 'declined' } });
    expect(codes(ws)).toEqual(['consent.declined']);
    amend(ws, { given: { externalProvider: 'Anthropic' } });
    expect(codes(ws)).toEqual(['consent.provider']);
  });

  it('drops the provider when external AI is turned off', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.given = { ...ws.consents.cr_1.given, aiExternal: true, externalProvider: 'Anthropic' };
    amend(ws, { given: { aiExternal: false } });
    expect(codes(ws)).toEqual([]);
    expect(consentState(ws.consents.cr_1).given).toMatchObject({ aiExternal: false, externalProvider: null });
  });

  it('never reports external AI without a provider for a valid record', () => {
    const ws = sampleWorkspace();
    amend(ws, { given: { aiExternal: true, externalProvider: 'Anthropic' } });
    expect(codes(ws)).toEqual([]);
    expect(aiPermission(ws, 'se_1')).toEqual({ local: true, external: true, externalProvider: 'Anthropic' });
  });
});

describe('2: AI proposals need consent to AI processing', () => {
  it('refuses a proposal from a session that allowed no AI processing', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.given.aiLocal = false;
    expect(codes(ws)).toEqual(['finding.aiConsent', 'finding.aiConsent']);
  });

  it('judges by the consent at the time the proposal was made', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.amendments = [{ id: 'am_1', kind: 'withdrawal', by: 'Sam', at: T3, reason: 'Client asked us to stop.' }];
    expect(codes(ws)).toEqual([]);
    const risk = ws.findings.fd_risk;
    if (risk.origin.kind === 'ai') risk.origin.at = LATER;
    risk.statusSet.at = LATER;
    expect(codes(ws)).toEqual(['finding.aiConsent']);
  });

  it('refuses local processing when only an external provider was agreed (WP5, rule C6)', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.given = { ...ws.consents.cr_1.given, aiLocal: false, aiExternal: true, externalProvider: 'Anthropic' };
    expect(codes(ws)).toEqual(['finding.aiConsent', 'finding.aiConsent']);
  });
});

describe('3: who changed a finding, and what the AI proposed', () => {
  it('records who and when for each change to statement, kind, status or evidence', () => {
    const ws = sampleWorkspace();
    const edited = editFinding(
      ws.findings.fd_peak,
      { statement: 'Orders peak in December.', kind: 'performance', status: 'confirmed' },
      'Sam',
      LATER,
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.history).toEqual([
      { field: 'kind', from: 'scalability', to: 'performance', by: 'Sam', at: LATER },
      {
        field: 'statement',
        from: 'Orders peak in December, at about five times the usual volume.',
        to: 'Orders peak in December.',
        by: 'Sam',
        at: LATER,
      },
    ]);
    ws.findings.fd_peak = edited.value;
    expect(validateWorkspace(ws)).toEqual([]);
    const status = setStatus(edited.value, 'assumption', 'Alex', LATER);
    expect(status.ok && status.value.history.at(-1)).toEqual({
      field: 'status',
      from: 'confirmed',
      to: 'assumption',
      by: 'Alex',
      at: LATER,
    });
    expect(status.ok && status.value.statusSet).toEqual({ by: { kind: 'consultant', name: 'Alex' }, at: LATER });
  });

  it('keeps what the AI proposed when the consultant edits a proposal while accepting it', () => {
    const ws = sampleWorkspace();
    const evidence = [{ kind: 'note' as const, noteId: 'no_1', quote: 'Ask about spreadsheet conflicts' }];
    const accepted = acceptProposal(ws.findings.fd_risk, 'Sam', T3, {
      statement: 'Stock changes may be lost.',
      status: 'assumption',
      evidence,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok || accepted.value.origin.kind !== 'ai') return;
    expect(accepted.value.origin.proposed).toEqual({
      kind: 'risk',
      statement: 'Two people editing one spreadsheet may lose stock changes.',
      status: 'suggested',
      evidence: [{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' }],
    });
    expect(accepted.value.history.map((c) => c.field)).toEqual(['statement', 'status', 'evidence']);
    ws.findings.fd_risk = accepted.value;
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it('refuses a change to an accepted proposal that is not in the history', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_stock.statement = 'Stock is in a spreadsheet.';
    expect(codes(ws)).toEqual(['finding.history']);
  });

  it("refuses a history that doesn't lead to the current values", () => {
    const ws = sampleWorkspace();
    ws.findings.fd_peak.history = [{ field: 'kind', from: 'scalability', to: 'performance', by: 'Sam', at: T3 }];
    expect(codes(ws)).toEqual(['finding.history']);
  });

  it("refuses a history that doesn't start from what the AI proposed", () => {
    const ws = sampleWorkspace();
    ws.findings.fd_stock.history[0] = { field: 'status', from: 'unresolved', to: 'assumption', by: 'Sam Consultant', at: T3 };
    expect(codes(ws)).toEqual(['finding.history']);
    ws.findings.fd_stock.history = [];
    expect(codes(ws)).toEqual(['finding.history']);
  });

  it('refuses a proposal under review that no longer reads as the AI proposed it', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_risk.statement = 'Something else entirely.';
    expect(codes(ws)).toEqual(['finding.history']);
  });

  it('checks the evidence the AI proposed, too', () => {
    const ws = sampleWorkspace();
    const risk = ws.findings.fd_risk;
    if (risk.origin.kind === 'ai')
      risk.origin.proposed.evidence = [{ kind: 'note', noteId: 'no_1', quote: 'conflicts every single day' }];
    risk.evidence = [{ kind: 'note', noteId: 'no_1', quote: 'conflicts every single day' }];
    expect(codes(ws)).toEqual(['evidence.invented', 'evidence.invented']);
  });
});

describe('5: company knowledge outlives its source', () => {
  it('keeps a copy of the source statement and quotes', () => {
    const ws = withFact();
    expect(ws.knowledge.kf_1.source).toEqual({
      findingId: 'fd_peak',
      deletedAt: null,
      engagementName: 'Online ordering',
      statement: 'Orders peak in December, at about five times the usual volume.',
      quotes: [{ text: 'about five times as many orders in December', sessionTitle: 'Kick-off', speakerLabel: 'Alex Owner' }],
    });
    expect(validateWorkspace(ws)).toEqual([]);
    expect(promoteToKnowledge(ws, 'fd_risk', 'kf_2', 'Sam', T3).ok).toBe(false);
  });

  it('stays valid when the finding is deleted, with its source marked "source deleted"', () => {
    const after = removeFindings(withFact(), ['fd_peak'], LATER);
    expect(after.knowledge.kf_1.source).toMatchObject({ findingId: null, deletedAt: LATER, statement: expect.any(String) });
    expect(after.relations).toEqual({});
    expect(validateWorkspace(after)).toEqual([]);
  });

  it('refuses a source that disappears without being marked deleted', () => {
    const ws = withFact();
    delete (ws.findings as Record<string, unknown>).fd_peak;
    ws.relations = {};
    expect(codes(ws)).toEqual(['ref.missing']);
  });

  it('refuses a fact without its copy of the source', () => {
    const ws = withFact();
    const source = ws.knowledge.kf_1.source;
    if (source) source.statement = '';
    expect(codes(ws)).toEqual(['fact.source']);
  });
});

describe('6: designs belong to one company', () => {
  it('finds a design linked from two companies', () => {
    const a = sampleWorkspace();
    const b = createWorkspace({ name: 'Other Ltd' }, T0);
    b.engagements.en_9 = { ...a.engagements.en_1, id: 'en_9', companyId: b.company.id };
    b.designs.de_9 = { ...a.designs.de_1, id: 'de_9', engagementId: 'en_9' };
    expect(validateWorkspace(b)).toEqual([]);
    expect(sharedIds([a, b])).toEqual(['doc_abc123']);
  });
});

describe('7: a quote is long enough to be evidence', () => {
  it('needs three words, unless it is the whole passage', () => {
    const text = 'We get about five times as many orders.';
    expect(isQuoteLongEnough(text, 'a')).toBe(false);
    expect(isQuoteLongEnough(text, 'many orders')).toBe(false);
    expect(isQuoteLongEnough(text, 'as many orders')).toBe(true);
    expect(isQuoteLongEnough('Yes.', 'yes')).toBe(true);
    expect(isQuoteLongEnough('Yes, fine.', '“Yes, fine.”')).toBe(true);
  });

  it('refuses a one-word quote as evidence', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_peak.evidence = [{ kind: 'segment', segmentId: 'sg_1', quote: 'a' }];
    expect(codes(ws)).toEqual(['evidence.short', 'finding.saidNeedsSegment']);
  });
});

describe('4: one bad entry does not lock a client out', () => {
  const damage: [string, (ws: CompanyWorkspace) => void][] = [
    ['an amendment', (ws) => ((ws.consents.cr_1 as unknown as Record<string, unknown>).amendments = [null])],
    ['the consent terms', (ws) => Object.assign(ws.consents.cr_1, { given: null, outcome: null, retention: null })],
    ['a change in the history', (ws) => ((ws.findings.fd_stock as unknown as Record<string, unknown>).history = [null])],
    ['a piece of evidence', (ws) => ((ws.findings.fd_peak as unknown as Record<string, unknown>).evidence = [null])],
    [
      "the AI's proposal",
      (ws) => ws.findings.fd_risk.origin.kind === 'ai' && Object.assign(ws.findings.fd_risk.origin, { proposed: null }),
    ],
    ['a fact source', (ws) => (ws.knowledge.kf_1 = { ...withFact().knowledge.kf_1, source: { findingId: 7 } as never })],
  ];

  for (const [what, harm] of damage) {
    it(`opens read-only with damage to ${what}`, () => {
      const ws = sampleWorkspace();
      harm(ws);
      const parsed = parseWorkspace(ws);
      expect(parsed.ok && parsed.access).toBe('read-only');
      expect(checkBeforeSave(ws).ok).toBe(false);
    });
  }
});
