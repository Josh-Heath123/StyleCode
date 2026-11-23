import { describe, expect, it } from 'vitest';
import { exportEngagementMarkdown } from '../exportMarkdown.ts';
import { amendConsent } from './consent.ts';
import { amendFormFor, amendmentFrom, canTellOnAmend, consentFormFor, saveConsentForm } from './consentForm.ts';
import { addToKnowledge, factsFromEngagement, removeEngagement, removeFinding } from './findings.ts';
import { sampleWorkspace, T3 } from './fixtures.ts';
import type { CompanyWorkspace } from './types.ts';
import { validateWorkspace } from './validate.ts';
import { CURRENT_WORDING, wordingFor } from './wording.ts';
import { parseWorkspace } from './workspace.ts';

/** Workspace version 6 (Workspace Phase 4, decisions 13 and 22): `aiDesign` in wording draft-2, and a fact's engagement. */

const T5 = '2026-11-05T09:00:00.000Z';
const T6 = '2026-11-05T10:00:00.000Z';

function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

type Loose = Record<string, Record<string, Record<string, unknown>>> & { version: number };

/** The sample as version 5 left it: no `aiDesign`, and facts without their engagement. */
function version5(ws: CompanyWorkspace): Loose {
  const v5 = structuredClone(ws) as unknown as Loose;
  v5.version = 5;
  for (const c of Object.values(v5.consents)) delete (c.told as Record<string, unknown>).aiDesign;
  for (const f of Object.values(v5.knowledge)) if (f.source) delete (f.source as Record<string, unknown>).engagementId;
  return v5;
}

describe('the wording', () => {
  it('draft-2 is the current wording: draft-1’s statements unchanged, and aiDesign', () => {
    expect(CURRENT_WORDING).toBe('draft-2');
    const context = { provider: null, retention: { kind: 'until-engagement-ends' } } as const;
    const one = wordingFor('draft-1')!;
    const two = wordingFor('draft-2')!;
    expect(one.statements).not.toContain('aiDesign');
    expect(one.statement('aiDesign', context)).toBeNull();
    expect(two.statement('aiDesign', context)).toBe(
      'I may also use AI to help sketch the screens from what we agree. It sees my summary of what you said, not the recording or the transcript.',
    );
    for (const s of one.statements) expect(two.statement(s, context)).toBe(one.statement(s, context));
    expect(two.statements).toEqual([...one.statements.slice(0, 3), 'aiDesign', ...one.statements.slice(3)]);
  });

  it('a record can’t say the client was told a statement its wording doesn’t have', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.told.aiDesign = true;
    expect(validateWorkspace(ws).map((p) => p.code)).toEqual(['consent.wording']);
    ws.consents.cr_1.wordingVersion = 'draft-2';
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it('an amendment can’t record aiDesign as told in a wording without it, or in a wording this StyleCode doesn’t know', () => {
    const record = sampleWorkspace().consents.cr_1;
    const amendment = {
      id: 'am_1',
      kind: 'change' as const,
      by: 'Sam Consultant',
      at: T5,
      reason: 'Told them by email.',
      told: { aiDesign: true },
      wordingVersion: 'draft-1',
    };
    expect(amendConsent(record, amendment)).toMatchObject({ ok: false, error: /draft-1 doesn't have \(aiDesign\)/ });
    expect(amendConsent(record, { ...amendment, wordingVersion: 'draft-9' })).toMatchObject({ ok: false, error: /draft-9/ });
    const ws = sampleWorkspace();
    ws.consents.cr_1.amendments = [amendment];
    expect(validateWorkspace(ws).map((p) => p.code)).toEqual(['consent.wording']);
    ws.consents.cr_1.amendments = [{ ...amendment, wordingVersion: 'draft-2' }];
    expect(validateWorkspace(ws)).toEqual([]);
  });
});

describe('the consent form and Amend… with aiDesign', () => {
  it('a new record is shown wording draft-2, and can say aiDesign was told', () => {
    const ws = sampleWorkspace();
    delete (ws.consents as Record<string, unknown>).cr_1;
    const form = consentFormFor(ws, 'se_1');
    expect(form.told.aiDesign).toBe(false);
    const saved = value(
      saveConsentForm(
        ws,
        'se_1',
        {
          ...form,
          askedParticipantIds: ['pa_client'],
          told: { ...form.told, aiExtraction: true, aiDesign: true, processingLocal: true, canStopOrDelete: true },
          given: { ...form.given, aiLocal: true },
          confirm: true,
        },
        'Sam Consultant',
        T5,
      ),
    );
    const record = Object.values(saved.consents)[0];
    expect(record).toMatchObject({ wordingVersion: 'draft-2', told: { aiDesign: true } });
    // The sample's transcript and findings needed the record this test removed; the new record itself is valid.
    expect(validateWorkspace(saved).filter((p) => p.where.map === 'consents')).toEqual([]);
  });

  it('a locked draft-1 record can be amended to say aiDesign was newly told, in draft-2', () => {
    const ws = sampleWorkspace();
    const record = ws.consents.cr_1;
    const values = amendFormFor(record);
    expect(canTellOnAmend(record, values, 'aiDesign')).toBe(true);
    const amendment = value(
      amendmentFrom(record, { ...values, told: { ...values.told, aiDesign: true }, reason: 'Told them by email.' }, 'Sam', T5),
    );
    expect(amendment).toMatchObject({ told: { aiDesign: true }, wordingVersion: 'draft-2' });
    expect(amendment).not.toHaveProperty('given');
    const amended = value(amendConsent(record, amendment));
    expect(canTellOnAmend(amended, amendFormFor(amended), 'aiDesign')).toBe(false);
    expect(validateWorkspace({ ...ws, consents: { cr_1: amended } })).toEqual([]);
  });

  it('the export prints each record in its own wording: draft-1 without aiDesign, an amendment in draft-2 with it', () => {
    const ws = sampleWorkspace();
    const before = exportEngagementMarkdown(ws, 'en_1');
    expect(before).toContain('wording draft-1');
    expect(before).not.toContain('sketch the screens');
    const amendment = value(
      amendmentFrom(
        ws.consents.cr_1,
        {
          ...amendFormFor(ws.consents.cr_1),
          told: { ...amendFormFor(ws.consents.cr_1).told, aiDesign: true },
          reason: 'By email.',
        },
        'Sam',
        T5,
      ),
    );
    ws.consents.cr_1 = value(amendConsent(ws.consents.cr_1, amendment));
    const after = exportEngagementMarkdown(ws, 'en_1');
    expect(after).toContain('draft-2');
    expect(after).toContain('I may also use AI to help sketch the screens from what we agree.');
  });
});

describe('a company fact records its engagement', () => {
  it('a promotion sets it, and the export finds the fact after its finding and its engagement are gone', () => {
    let ws = value(addToKnowledge(sampleWorkspace(), 'fd_peak', 'kf_1', 'Sam Consultant', T3));
    expect(ws.knowledge.kf_1.source?.engagementId).toBe('en_1');
    ws = value(removeFinding(ws, 'fd_peak', T5));
    expect(factsFromEngagement(ws, 'en_1').map((f) => f.id)).toEqual(['kf_1']);
    ws = value(removeEngagement(ws, 'en_1', T6)).workspace;
    expect(ws.knowledge.kf_1.source).toMatchObject({ engagementId: 'en_1', findingId: null });
    expect(validateWorkspace(ws)).toEqual([]);
  });

  it('refuses an engagement that isn’t an id or null', () => {
    const ws = value(addToKnowledge(sampleWorkspace(), 'fd_peak', 'kf_1', 'Sam Consultant', T3));
    (ws.knowledge.kf_1.source as unknown as Record<string, unknown>).engagementId = 42;
    expect(validateWorkspace(ws).map((p) => p.code)).toEqual(['fact.source']);
  });
});

describe('migrating version 5', () => {
  it('every consent record has aiDesign not told; amendments are left as they were', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.amendments = [
      {
        id: 'am_1',
        kind: 'change',
        by: 'Sam',
        at: T5,
        reason: 'Told retention again.',
        told: { retention: true },
        wordingVersion: 'draft-1',
      },
    ];
    const parsed = parseWorkspace(version5(ws));
    expect(parsed.ok && parsed.access).toBe('editable');
    if (!parsed.ok) return;
    expect(parsed.workspace.version).toBe(6);
    expect(parsed.workspace.consents.cr_1.told.aiDesign).toBe(false);
    expect(parsed.workspace.consents.cr_1.wordingVersion).toBe('draft-1');
    expect(parsed.workspace.consents.cr_1.amendments).toEqual(ws.consents.cr_1.amendments);
  });

  it('a fact takes its finding’s engagement, else its sessions’, else none', () => {
    let ws = value(addToKnowledge(sampleWorkspace(), 'fd_peak', 'kf_1', 'Sam Consultant', T3));
    ws = value(addToKnowledge(ws, 'fd_stock', 'kf_2', 'Sam Consultant', T3));
    ws = value(removeFinding(ws, 'fd_stock', T5));
    ws.knowledge.kf_3 = {
      ...ws.knowledge.kf_2,
      id: 'kf_3',
      source: { ...ws.knowledge.kf_2.source!, sessionIds: ['se_gone'], quotes: [] },
    };
    const parsed = parseWorkspace(version5(ws));
    expect(parsed.ok && parsed.access).toBe('editable');
    if (!parsed.ok) return;
    const source = (id: string) => parsed.workspace.knowledge[id].source?.engagementId;
    expect([source('kf_1'), source('kf_2'), source('kf_3')]).toEqual(['en_1', 'en_1', null]);
  });

  it('a version 6 workspace opens unchanged', () => {
    const ws = sampleWorkspace();
    const parsed = parseWorkspace(structuredClone(ws));
    expect(parsed.ok && parsed.workspace).toEqual(ws);
  });
});
