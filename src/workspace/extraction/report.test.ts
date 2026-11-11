import { describe, expect, it } from 'vitest';
import { sampleWorkspace } from '../model/fixtures';
import { acceptReviewed, rejectReviewed } from '../model/record';
import type { CompanyWorkspace, Finding } from '../model/types';
import { reviewReport } from './report';

const AT = '2026-11-06T10:00:00.000Z';
const LATER = '2026-11-07T10:00:00.000Z';
function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** The sample with three pending proposals from se_1: two risks and an open question. */
function withProposals(): CompanyWorkspace {
  const ws = sampleWorkspace();
  const risk = ws.findings.fd_risk;
  const copy = (id: string, kind: Finding['kind']): Finding => ({
    ...risk,
    id,
    kind,
    origin: {
      ...(risk.origin as Extract<Finding['origin'], { kind: 'ai' }>),
      proposed: { ...(risk.origin as Extract<Finding['origin'], { kind: 'ai' }>).proposed, kind },
    },
  });
  ws.findings.fd_risk2 = copy('fd_risk2', 'risk');
  ws.findings.fd_open = copy('fd_open', 'open-question');
  return ws;
}

describe('the evaluation report (WP7)', () => {
  it('counts the session’s proposals by the kind the AI proposed, and what became of each', () => {
    let ws = withProposals();
    ws = value(acceptReviewed(ws, 'fd_risk', {}, 'Sam', AT));
    ws = value(acceptReviewed(ws, 'fd_risk2', { statement: 'Stock changes clash at month end.' }, 'Sam', AT));
    const report = reviewReport(ws, 'se_1');
    // The accepted finding of the sample (fd_stock) came from se_1 too: only its status was chosen, so it isn't edited.
    expect(report.total).toEqual({ kind: 'all', proposed: 4, accepted: 2, edited: 1, rejected: 0, pending: 1 });
    expect(report.byKind.map((r) => r.kind)).toEqual(['existing-system', 'open-question', 'risk']);
    expect(report.byKind.find((r) => r.kind === 'risk')).toMatchObject({ proposed: 2, accepted: 1, edited: 1 });
    ws = value(rejectReviewed(ws, 'fd_open', 'Sam', AT));
    expect(reviewReport(ws, 'se_1').total).toMatchObject({ rejected: 1, pending: 0 });
  });

  it('counts by the kind proposed; a status chosen on accepting, or an edit made later, isn’t "edited"', () => {
    let ws = withProposals();
    ws = value(acceptReviewed(ws, 'fd_open', { kind: 'risk' }, 'Sam', AT));
    const f = ws.findings.fd_open;
    expect(reviewReport(ws, 'se_1').byKind.find((r) => r.kind === 'open-question')).toMatchObject({ edited: 1 });
    ws = value(acceptReviewed(ws, 'fd_risk', {}, 'Sam', AT));
    ws.findings.fd_risk = { ...ws.findings.fd_risk, history: [{ field: 'statement', from: 'a', to: 'b', by: 'Sam', at: LATER }] };
    expect(reviewReport(ws, 'se_1').byKind.find((r) => r.kind === 'risk')).toMatchObject({ accepted: 1, edited: 0 });
    expect(f.kind).toBe('risk');
  });

  it('is empty for a session the AI never read', () => {
    expect(reviewReport(sampleWorkspace(), 'se_none').total.proposed).toBe(0);
  });
});
