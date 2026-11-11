import { describe, expect, it } from 'vitest';
import { sampleWorkspace, T3 } from './fixtures';
import {
  acceptReviewed,
  addRelation,
  createFinding,
  discardProposals,
  filteredRecord,
  linksOf,
  rejectReviewed,
  removeRelation,
  updateFinding,
} from './record';
import type { CompanyWorkspace } from './types';
import { validateWorkspace } from './validate';

const AT = '2026-11-06T10:00:00.000Z';
const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);
function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** The sample with its pending AI proposal gone, so every finding is in the record. */
function base(): CompanyWorkspace {
  const ws = sampleWorkspace();
  delete ws.findings.fd_risk;
  return ws;
}

describe('adding a finding by hand (MVP 6.4)', () => {
  it('records the consultant as its origin and provenance, with notes as evidence, valid', () => {
    const { workspace, id } = value(
      createFinding(
        base(),
        'en_1',
        {
          kind: 'future-consideration',
          statement: '  Stock across all three shops, later.  ',
          status: 'suggested',
          evidence: [{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' }],
        },
        'Sam Consultant',
        AT,
      ),
    );
    expect(workspace.findings[id]).toMatchObject({
      statement: 'Stock across all three shops, later.',
      provenance: { kind: 'consultant' },
      origin: { kind: 'consultant', by: 'Sam Consultant', at: AT },
      statusSet: { by: { kind: 'consultant', name: 'Sam Consultant' } },
      history: [],
    });
    expect(codes(workspace)).toEqual([]);
  });

  it('is "said in a session" when it quotes a transcript segment', () => {
    const { workspace, id } = value(
      createFinding(
        base(),
        'en_1',
        {
          kind: 'decision',
          statement: 'Count stock weekly.',
          status: 'confirmed',
          evidence: [{ kind: 'segment', segmentId: 'sg_2', quote: 'we keep stock in a spreadsheet' }],
        },
        'Sam',
        AT,
      ),
    );
    expect(workspace.findings[id].provenance).toEqual({ kind: 'said-in-session' });
    expect(codes(workspace)).toEqual([]);
  });

  it('refuses an empty statement, invented or too-short quotes, and evidence from another engagement', () => {
    const ws = base();
    const add = (evidence: Parameters<typeof createFinding>[2]['evidence'], statement = 'A finding.') =>
      createFinding(ws, 'en_1', { kind: 'risk', statement, status: 'assumption', evidence }, 'Sam', AT);
    expect(add([], ' ').ok).toBe(false);
    expect(add([{ kind: 'note', noteId: 'no_1', quote: 'conflicts at year end' }])).toMatchObject({
      ok: false,
      error: expect.stringContaining('appear in the note'),
    });
    expect(add([{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet' }])).toMatchObject({
      ok: false,
      error: expect.stringContaining('at least 3 words'),
    });
    // The whole note is always long enough.
    expect(add([{ kind: 'note', noteId: 'no_1', quote: 'Ask about spreadsheet conflicts at month end.' }]).ok).toBe(true);
    ws.engagements.en_2 = { ...ws.engagements.en_1, id: 'en_2' };
    expect(
      createFinding(
        ws,
        'en_2',
        {
          kind: 'risk',
          statement: 'x',
          status: 'assumption',
          evidence: [{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' }],
        },
        'Sam',
        AT,
      ).ok,
    ).toBe(false);
  });
});

describe('editing a finding (MVP 7.1)', () => {
  it('records each change with who and when, and changes nothing when nothing differs', () => {
    const ws = base();
    const edited = value(updateFinding(ws, 'fd_peak', { status: 'assumption', kind: 'performance' }, 'Sam', AT));
    expect(edited.findings.fd_peak.history).toMatchObject([
      { field: 'kind', from: 'scalability', to: 'performance', by: 'Sam', at: AT },
      { field: 'status', from: 'confirmed', to: 'assumption', by: 'Sam', at: AT },
    ]);
    expect(codes(edited)).toEqual([]);
    expect(updateFinding(ws, 'fd_peak', { status: 'confirmed' }, 'Sam', AT)).toEqual({ ok: true, value: ws });
  });
});

describe('the record, filtered (MVP 7.1)', () => {
  it('groups the findings in the record, and filters by kind and by session', () => {
    const ws = base();
    const all = filteredRecord(ws, 'en_1');
    expect(all.confirmed.map((f) => f.id)).toEqual(['fd_peak']);
    expect(all.assumptions.map((f) => f.id)).toEqual(['fd_stock']);
    expect(filteredRecord(ws, 'en_1', { kind: 'existing-system' }).confirmed).toEqual([]);
    expect(filteredRecord(ws, 'en_1', { sessionId: 'se_none' }).assumptions).toEqual([]);
    expect(filteredRecord(ws, 'en_1', { sessionId: 'se_1' }).assumptions.map((f) => f.id)).toEqual(['fd_stock']);
  });
});

describe('links (MVP 7.2)', () => {
  it('links two findings of one engagement, readable from both ends, and removes the link', () => {
    const ws = base();
    ws.relations = {};
    const { workspace, id } = value(addRelation(ws, { type: 'influences', fromId: 'fd_peak', toId: 'fd_stock' }, 'Sam', T3));
    expect(codes(workspace)).toEqual([]);
    expect(linksOf(workspace, 'fd_peak')).toMatchObject([{ outgoing: true, other: { id: 'fd_stock' } }]);
    expect(linksOf(workspace, 'fd_stock')).toMatchObject([{ outgoing: false, other: { id: 'fd_peak' } }]);
    expect(value(removeRelation(workspace, id)).relations).toEqual({});
  });

  it('refuses self-links, repeats (conflicts-with either way), findings outside the record, and other engagements', () => {
    const ws = sampleWorkspace(); // fd_risk is still a pending proposal here.
    ws.relations = {};
    expect(addRelation(ws, { type: 'refines', fromId: 'fd_peak', toId: 'fd_peak' }, 'Sam', AT).ok).toBe(false);
    expect(addRelation(ws, { type: 'refines', fromId: 'fd_peak', toId: 'fd_risk' }, 'Sam', AT).ok).toBe(false);
    const linked = value(addRelation(ws, { type: 'conflicts-with', fromId: 'fd_peak', toId: 'fd_stock' }, 'Sam', AT)).workspace;
    expect(addRelation(linked, { type: 'conflicts-with', fromId: 'fd_stock', toId: 'fd_peak' }, 'Sam', AT).ok).toBe(false);
    // A different kind of link between the same two is fine.
    expect(addRelation(linked, { type: 'depends-on', fromId: 'fd_stock', toId: 'fd_peak' }, 'Sam', AT).ok).toBe(true);
    linked.findings.fd_stock = { ...linked.findings.fd_stock, engagementId: 'en_2' };
    linked.engagements.en_2 = { ...linked.engagements.en_1, id: 'en_2' };
    expect(addRelation(linked, { type: 'influences', fromId: 'fd_peak', toId: 'fd_stock' }, 'Sam', AT)).toMatchObject({
      ok: false,
      error: 'Links stay within one engagement.',
    });
  });
});

describe('reviewing a proposal (MVP 6.2; Phase 2 brief, WP7)', () => {
  it('accepts with the AI’s status, or another the consultant chooses, recorded as theirs', () => {
    const ws = sampleWorkspace();
    const kept = value(acceptReviewed(ws, 'fd_risk', {}, 'Sam', AT)).findings.fd_risk;
    expect(kept.origin).toMatchObject({ review: { state: 'accepted', by: 'Sam', at: AT } });
    expect(kept.statusSet).toEqual({ by: { kind: 'consultant', name: 'Sam' }, at: AT });
    expect(kept.history).toEqual([]);
    const confirmed = value(acceptReviewed(ws, 'fd_risk', { status: 'confirmed' }, 'Sam', AT));
    expect(confirmed.findings.fd_risk.status).toBe('confirmed');
    expect(codes(confirmed)).toEqual([]);
  });

  it('accepts with edits, each in the history, the proposal kept as the AI made it', () => {
    const ws = sampleWorkspace();
    const after = value(
      acceptReviewed(
        ws,
        'fd_risk',
        {
          kind: 'operational-challenge',
          statement: '  Stock changes clash at month end. ',
          evidence: [{ kind: 'segment', segmentId: 'sg_2', quote: 'we keep stock in a spreadsheet' }],
        },
        'Sam',
        AT,
      ),
    );
    const f = after.findings.fd_risk;
    expect(f.statement).toBe('Stock changes clash at month end.');
    expect(f.history.map((h) => h.field)).toEqual(['kind', 'statement', 'evidence']);
    expect(f.provenance).toEqual({ kind: 'said-in-session' });
    expect(f.origin.kind === 'ai' && f.origin.proposed.kind).toBe('risk');
    expect(codes(after)).toEqual([]);
  });

  it('refuses evidence that isn’t in the passage, no evidence at all, and an empty statement', () => {
    const ws = sampleWorkspace();
    const bad = { kind: 'segment' as const, segmentId: 'sg_2', quote: 'we keep stock in a database' };
    expect(acceptReviewed(ws, 'fd_risk', { evidence: [bad] }, 'Sam', AT).ok).toBe(false);
    expect(acceptReviewed(ws, 'fd_risk', { evidence: [] }, 'Sam', AT).ok).toBe(false);
    expect(acceptReviewed(ws, 'fd_risk', { statement: '  ' }, 'Sam', AT).ok).toBe(false);
    expect(acceptReviewed(ws, 'fd_risk', {}, ' ', AT).ok).toBe(false);
  });

  it('rejects: kept, hidden, with who and when; only a pending proposal', () => {
    const ws = sampleWorkspace();
    const after = value(rejectReviewed(ws, 'fd_risk', 'Sam', AT));
    expect(after.findings.fd_risk.origin).toMatchObject({ review: { state: 'rejected', by: 'Sam', at: AT } });
    expect(codes(after)).toEqual([]);
    expect(rejectReviewed(after, 'fd_risk', 'Sam', AT).ok).toBe(false);
    expect(acceptReviewed(after, 'fd_risk', {}, 'Sam', AT).ok).toBe(false);
  });

  it('discards only proposals still waiting for review, and says when none is', () => {
    const ws = sampleWorkspace();
    const after = value(discardProposals(ws, ['fd_risk', 'fd_stock', 'fd_gone']));
    expect(Object.keys(after.findings).sort()).toEqual(['fd_peak', 'fd_stock']);
    expect(codes(after)).toEqual([]);
    expect(discardProposals(after, ['fd_risk', 'fd_stock']).ok).toBe(false);
  });
});
