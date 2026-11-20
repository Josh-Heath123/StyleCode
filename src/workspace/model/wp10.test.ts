import { describe, expect, it } from 'vitest';
import { addToKnowledge, enterFact, factsFromEngagement, removeFinding } from './findings.ts';
import { sampleWorkspace, T3 } from './fixtures.ts';
import type { CompanyWorkspace } from './types.ts';
import { validateWorkspace } from './validate.ts';

/** Workspace Phase 3, WP10: facts entered directly (decision 28), and an engagement's facts for its export (decision 27). */

const T5 = '2026-11-05T09:00:00.000Z';

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('entering a fact directly', () => {
  it('is entered by the consultant, with no source, and is valid', () => {
    const ws = value(
      enterFact(
        sampleWorkspace(),
        'kf_9',
        { statement: '  They close the depot in December.  ', kind: 'constraint', status: 'confirmed' },
        'Sam Consultant',
        T5,
      ),
    );
    expect(ws.knowledge.kf_9).toEqual({
      id: 'kf_9',
      statement: 'They close the depot in December.',
      kind: 'constraint',
      status: 'confirmed',
      provenance: { kind: 'consultant' },
      source: null,
      createdBy: 'Sam Consultant',
      createdAt: T5,
    });
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it('refuses an empty statement, an unknown kind or status, no name, and an id in use', () => {
    const ws = sampleWorkspace();
    const fact = { statement: 'They close the depot in December.', kind: 'constraint', status: 'confirmed' } as const;
    expect(enterFact(ws, 'kf_9', { ...fact, statement: ' ' }, 'Sam', T5)).toMatchObject({ ok: false, error: /statement/ });
    expect(enterFact(ws, 'kf_9', { ...fact, kind: 'rumour' as never }, 'Sam', T5)).toMatchObject({ ok: false, error: /kind/ });
    expect(enterFact(ws, 'kf_9', { ...fact, status: 'maybe' as never }, 'Sam', T5)).toMatchObject({ ok: false, error: /status/ });
    expect(enterFact(ws, 'kf_9', fact, ' ', T5)).toMatchObject({ ok: false, error: /name/ });
    const once = value(enterFact(ws, 'kf_9', fact, 'Sam', T5));
    expect(enterFact(once, 'kf_9', fact, 'Sam', T5)).toMatchObject({ ok: false, error: /exists/ });
  });
});

/** The sample with a second engagement and session, and a fact promoted there whose finding is gone. */
function twoEngagements(): CompanyWorkspace {
  let ws = value(addToKnowledge(sampleWorkspace(), 'fd_peak', 'kf_1', 'Sam Consultant', T3));
  ws = value(enterFact(ws, 'kf_2', { statement: 'Entered directly.', kind: 'constraint', status: 'suggested' }, 'Sam', T3));
  const en_2 = { ...ws.engagements.en_1, id: 'en_2', name: 'Second engagement' };
  const se_2 = { ...ws.sessions.se_1, id: 'se_2', engagementId: 'en_2', audioFileIds: [], deletedRecordings: [] };
  const elsewhere = {
    ...ws.knowledge.kf_1,
    id: 'kf_3',
    statement: 'From the other engagement.',
    source: {
      ...ws.knowledge.kf_1.source!,
      findingId: null,
      deletedAt: T5,
      engagementId: 'en_2',
      engagementName: 'Second engagement',
      sessionIds: ['se_2'],
    },
  };
  return {
    ...ws,
    engagements: { ...ws.engagements, en_2 },
    sessions: { ...ws.sessions, se_2 },
    knowledge: { ...ws.knowledge, kf_3: elsewhere },
  };
}

describe('an engagement’s company facts', () => {
  it('lists those promoted from its findings, and none entered directly or from another engagement', () => {
    const ws = twoEngagements();
    expect(factsFromEngagement(ws, 'en_1').map((f) => f.id)).toEqual(['kf_1']);
    expect(factsFromEngagement(ws, 'en_2').map((f) => f.id)).toEqual(['kf_3']);
  });

  it('still lists a fact once its finding is deleted, through the engagement it records (version 6)', () => {
    const ws = value(removeFinding(twoEngagements(), 'fd_peak', T5));
    expect(ws.knowledge.kf_1.source?.findingId).toBeNull();
    expect(factsFromEngagement(ws, 'en_1').map((f) => f.id)).toEqual(['kf_1']);
  });
});
