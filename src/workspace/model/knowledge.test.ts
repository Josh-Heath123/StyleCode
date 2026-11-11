import { describe, expect, it } from 'vitest';
import { addToKnowledge, factFrom, promoteToKnowledge, removeFinding, updateFact } from './findings.ts';
import { sampleWorkspace, T3 } from './fixtures.ts';
import { validateWorkspace } from './validate.ts';
import { parseWorkspace } from './workspace.ts';

/**
 * Workspace Phase 2, WP8: company knowledge (Phase 2 brief, decision 17).
 * Every person and company is role-played.
 */

const T5 = '2026-11-05T09:00:00.000Z';

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** The sample with fd_peak (confirmed, in the record) promoted to kf_1. */
function promoted() {
  const ws = sampleWorkspace();
  ws.knowledge.kf_1 = value(promoteToKnowledge(ws, 'fd_peak', 'kf_1', 'Sam Consultant', T3));
  return ws;
}

describe('promoting a finding', () => {
  it('copies its status onto the fact, and leaves the finding as it was', () => {
    const before = sampleWorkspace();
    const fact = value(promoteToKnowledge(before, 'fd_peak', 'kf_1', 'Sam Consultant', T3));
    expect(fact.status).toBe(before.findings.fd_peak.status);
    expect(fact.kind).toBe(before.findings.fd_peak.kind);
    expect(fact.provenance).toEqual(before.findings.fd_peak.provenance);
    expect(before).toEqual(sampleWorkspace());
    const ws = { ...before, knowledge: { kf_1: fact } };
    expect(validateWorkspace(ws)).toEqual([]);
    expect(factFrom(ws, 'fd_peak')?.id).toBe('kf_1');
    expect(factFrom(ws, 'fd_stock')).toBeUndefined();
  });

  it('copies an accepted AI proposal’s status too', () => {
    const ws = sampleWorkspace();
    const fact = value(promoteToKnowledge(ws, 'fd_stock', 'kf_2', 'Sam Consultant', T3));
    expect(fact.status).toBe(ws.findings.fd_stock.status);
  });

  it('refuses a finding that is company knowledge already, and a proposal under review', () => {
    expect(promoteToKnowledge(promoted(), 'fd_peak', 'kf_2', 'Sam Consultant', T3)).toMatchObject({
      ok: false,
      error: /company knowledge already/,
    });
    expect(promoteToKnowledge(sampleWorkspace(), 'fd_risk', 'kf_2', 'Sam Consultant', T3)).toMatchObject({ ok: false });
  });

  it('adds the fact to the workspace in one step, with a new id', () => {
    const after = addToKnowledge(sampleWorkspace(), 'fd_peak', 'kf_1', 'Sam Consultant', T3);
    expect(after.ok && after.value.knowledge.kf_1).toEqual(promoted().knowledge.kf_1);
    expect(addToKnowledge(promoted(), 'fd_stock', 'kf_1', 'Sam Consultant', T3)).toMatchObject({ ok: false, error: /exists/ });
  });

  it('can promote again once the fact is removed', () => {
    const ws = promoted();
    delete ws.knowledge.kf_1;
    expect(promoteToKnowledge(ws, 'fd_peak', 'kf_2', 'Sam Consultant', T3).ok).toBe(true);
  });

  it('keeps the fact, marked "source deleted", when the finding is deleted', () => {
    const after = value(removeFinding(promoted(), 'fd_peak', T5));
    expect(after.knowledge.kf_1.source).toMatchObject({ findingId: null, deletedAt: T5 });
    expect(after.knowledge.kf_1.status).toBe('confirmed');
    expect(validateWorkspace(after)).toEqual([]);
  });
});

describe('editing a fact', () => {
  it('changes its statement, kind and status, and keeps its source and provenance', () => {
    const ws = promoted();
    const after = value(updateFact(ws, 'kf_1', { statement: '  Orders peak at Easter.  ', kind: 'risk', status: 'assumption' }));
    expect(after.knowledge.kf_1).toMatchObject({ statement: 'Orders peak at Easter.', kind: 'risk', status: 'assumption' });
    expect(after.knowledge.kf_1.source).toEqual(ws.knowledge.kf_1.source);
    expect(after.knowledge.kf_1.provenance).toEqual(ws.knowledge.kf_1.provenance);
    expect(after.findings).toBe(ws.findings);
    expect(validateWorkspace(after)).toEqual([]);
  });

  it('refuses an empty statement, an unknown kind or status, no change, and a fact that isn’t there', () => {
    const ws = promoted();
    expect(updateFact(ws, 'kf_1', { statement: '  ' })).toMatchObject({ ok: false, error: /needs a statement/ });
    expect(updateFact(ws, 'kf_1', { kind: 'wish' as never }).ok).toBe(false);
    expect(updateFact(ws, 'kf_1', { status: 'agreed' as never }).ok).toBe(false);
    expect(updateFact(ws, 'kf_1', { status: ws.knowledge.kf_1.status })).toMatchObject({ ok: false, error: /Nothing/ });
    expect(updateFact(ws, 'kf_x', { status: 'unresolved' })).toMatchObject({ ok: false, error: /does not exist/ });
  });

  it('keeps the kind and status when a change gives them as undefined', () => {
    const ws = promoted();
    const after = value(updateFact(ws, 'kf_1', { statement: 'Orders peak at Easter.', kind: undefined, status: undefined }));
    expect(after.knowledge.kf_1).toMatchObject({ kind: ws.knowledge.kf_1.kind, status: ws.knowledge.kf_1.status });
    expect(validateWorkspace(after)).toEqual([]);
  });

  it('a fact without a known status is a problem', () => {
    const ws = promoted();
    (ws.knowledge.kf_1 as { status: string }).status = 'agreed';
    expect(validateWorkspace(ws).map((p) => p.code)).toEqual(['field.value']);
  });
});

describe('workspace version 3', () => {
  const asVersion2 = (ws: ReturnType<typeof promoted>) => {
    const v2 = structuredClone(ws) as unknown as Record<string, unknown> & {
      knowledge: Record<string, Record<string, unknown>>;
    };
    v2.version = 2;
    for (const fact of Object.values(v2.knowledge)) delete fact.status;
    return v2;
  };

  it('migrates version 2: a fact takes its source finding’s status', () => {
    const ws = promoted();
    ws.findings.fd_peak.status = 'unresolved';
    const parsed = parseWorkspace(asVersion2(ws));
    expect(parsed.ok && parsed.access).toBe('editable');
    if (!parsed.ok) return;
    expect(parsed.workspace.version).toBe(3);
    expect(parsed.workspace.knowledge.kf_1.status).toBe('unresolved');
    expect(parsed.workspace).toEqual({ ...ws, knowledge: { kf_1: { ...ws.knowledge.kf_1, status: 'unresolved' } } });
  });

  it('migrates version 2: a fact whose source is gone is "suggested", claiming nothing was agreed', () => {
    const ws = value(removeFinding(promoted(), 'fd_peak', T5));
    const parsed = parseWorkspace(asVersion2(ws));
    expect(parsed.ok && parsed.workspace.knowledge.kf_1.status).toBe('suggested');
  });

  it('migrates version 1 through 2 to 3', () => {
    const v1 = asVersion2(promoted());
    v1.version = 1;
    delete (v1.knowledge.kf_1.source as Record<string, unknown>).sessionIds;
    const parsed = parseWorkspace(v1, { timeZone: 'Africa/Johannesburg' });
    expect(parsed.ok && parsed.access).toBe('editable');
    if (parsed.ok)
      expect(parsed.workspace.knowledge.kf_1).toMatchObject({ status: 'confirmed', source: { sessionIds: ['se_1'] } });
  });

  it('leaves a status it can’t read for the checks to report', () => {
    const v2 = asVersion2(promoted());
    v2.knowledge.kf_1.status = 7;
    const parsed = parseWorkspace(v2);
    expect(parsed.ok && parsed.access).toBe('read-only');
  });
});
