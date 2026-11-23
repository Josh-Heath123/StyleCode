import { describe, expect, it } from 'vitest';
import { findingsForDesign, leftOutMessage, toldAiDesign } from './designContext.ts';
import { consentRecord, sampleWorkspace, T0, T2, T3 } from './fixtures.ts';
import type { AiProcessing, CompanyWorkspace, ConsentRecord, Evidence, Finding } from './types.ts';
import { validateWorkspace } from './validate.ts';

/** Workspace Phase 4, decisions 13 and 14: which confirmed findings the canvas AI may be given. */

const T4 = '2026-11-04T12:00:00.000Z';
const LOCAL: AiProcessing = { kind: 'local' };
const ANTHROPIC: AiProcessing = { kind: 'external', provider: 'Anthropic (api.anthropic.com)' };
const OPENAI = 'OpenAI (api.openai.com)';

/** Told everything, including `aiDesign`, in wording draft-2. */
const TOLD_ALL = {
  recorded: true,
  transcribed: true,
  aiExtraction: true,
  aiDesign: true,
  processingLocal: true,
  processingExternal: false,
  retention: true,
  canStopOrDelete: true,
  externalProvider: null,
};

/** The sample with a second session (se_2, a note no_2), each session's consent as given, and no findings but `extra`. */
function workspace(se1: Partial<ConsentRecord>, se2: Partial<ConsentRecord> = se1, extra: Finding[] = []): CompanyWorkspace {
  const ws = sampleWorkspace();
  ws.sessions.se_2 = { ...ws.sessions.se_1, id: 'se_2', title: 'Follow-up', audioFileIds: [], deletedRecordings: [] };
  ws.participants.pa_client2 = { ...ws.participants.pa_client, id: 'pa_client2', sessionId: 'se_2', speakerLabels: [] };
  ws.notes.no_2 = { ...ws.notes.no_1, id: 'no_2', sessionId: 'se_2', text: 'They want a big Pay button.' };
  ws.consents = {
    cr_1: consentRecord(se1),
    cr_2: consentRecord({ id: 'cr_2', sessionId: 'se_2', askedParticipantIds: ['pa_client2'], ...se2 }),
  };
  ws.findings = Object.fromEntries(extra.map((f) => [f.id, f]));
  ws.relations = {};
  return ws;
}

const draft2 = (more: Partial<ConsentRecord> = {}): Partial<ConsentRecord> => ({
  wordingVersion: 'draft-2',
  told: TOLD_ALL,
  ...more,
});

function finding(id: string, evidence: Evidence[], more: Partial<Finding> = {}): Finding {
  return {
    id,
    engagementId: 'en_1',
    kind: 'design-preference',
    statement: `Finding ${id}.`,
    status: 'confirmed',
    statusSet: { by: { kind: 'consultant', name: 'Sam Consultant' }, at: T3 },
    provenance: evidence.length ? { kind: 'said-in-session' } : { kind: 'consultant' },
    evidence,
    origin: { kind: 'consultant', by: 'Sam Consultant', at: T3 },
    history: [],
    createdAt: T3,
    updatedAt: T3,
    ...more,
  } as Finding;
}

const inSe1: Evidence = { kind: 'segment', segmentId: 'sg_1', quote: 'about five times as many orders in December' };
const inSe2: Evidence = { kind: 'note', noteId: 'no_2', quote: 'a big Pay button' };

const ids = (r: { findings: Finding[] }) => r.findings.map((f) => f.id);

describe('which findings a canvas request may use (decision 14)', () => {
  it('the fixtures are valid workspaces', () => {
    expect(validateWorkspace(workspace(draft2(), draft2(), [finding('fd_a', [inSe1])]))).toEqual([]);
  });

  it('uses a confirmed finding whose session was told aiDesign on the form and allows this AI', () => {
    const r = findingsForDesign(workspace(draft2(), draft2(), [finding('fd_a', [inSe1])]), 'en_1', LOCAL);
    expect(ids(r)).toEqual(['fd_a']);
    expect(Object.values(r.leftOut).every((n) => n === 0)).toBe(true);
  });

  it('leaves one out when aiDesign wasn’t told (a draft-1 record)', () => {
    const ws = workspace({}, {}, [finding('fd_a', [inSe1])]);
    const r = findingsForDesign(ws, 'en_1', LOCAL);
    expect(ids(r)).toEqual([]);
    expect(r.leftOut['not-told']).toBe(1);
  });

  it('uses one once aiDesign is told by an amendment, and not before it', () => {
    const told: Partial<ConsentRecord> = {
      amendments: [
        {
          id: 'am_1',
          kind: 'change',
          by: 'Sam Consultant',
          at: T4,
          reason: 'Told them by email about sketching screens.',
          told: { aiDesign: true },
          wordingVersion: 'draft-2',
        },
      ],
    };
    const ws = workspace(told, told, [finding('fd_a', [inSe1])]);
    expect(validateWorkspace(ws)).toEqual([]);
    expect(toldAiDesign(ws, 'se_1')).toBe(true);
    expect(ids(findingsForDesign(ws, 'en_1', LOCAL))).toEqual(['fd_a']);
    expect(findingsForDesign(ws, 'en_1', LOCAL, T3).leftOut['not-told']).toBe(1);
  });

  it('leaves one out when its session declined or withdrew consent', () => {
    const declined = draft2({
      given: { audioRecording: false, transcription: false, aiLocal: false, aiExternal: false, externalProvider: null },
      outcome: { kind: 'declined' },
    });
    expect(
      findingsForDesign(workspace(declined, declined, [finding('fd_a', [inSe1])]), 'en_1', LOCAL).leftOut['not-allowed'],
    ).toBe(1);
    const withdrawn = draft2({
      amendments: [{ id: 'am_1', kind: 'withdrawal', by: 'Sam Consultant', at: T4, reason: 'The client asked to stop.' }],
    });
    const ws = workspace(withdrawn, withdrawn, [finding('fd_a', [inSe1])]);
    expect(validateWorkspace(ws)).toEqual([]);
    expect(findingsForDesign(ws, 'en_1', LOCAL).leftOut['not-allowed']).toBe(1);
    // Before the withdrawal, it was allowed.
    expect(ids(findingsForDesign(ws, 'en_1', LOCAL, T3))).toEqual(['fd_a']);
  });

  it('leaves one out for an external provider when its session allows AI on this computer only', () => {
    const r = findingsForDesign(workspace(draft2(), draft2(), [finding('fd_a', [inSe1])]), 'en_1', ANTHROPIC);
    expect(r.leftOut['not-allowed']).toBe(1);
    expect(leftOutMessage(r.leftOut, ANTHROPIC)).toBe('1 finding left out: its session doesn’t allow this provider.');
  });

  it('leaves one out for the wrong provider, and uses it for the one the client agreed to', () => {
    const external = draft2({
      told: { ...TOLD_ALL, processingExternal: true, externalProvider: OPENAI },
      given: { audioRecording: false, transcription: true, aiLocal: false, aiExternal: true, externalProvider: OPENAI },
    });
    const ws = workspace(external, external, [finding('fd_a', [inSe1])]);
    expect(validateWorkspace(ws)).toEqual([]);
    expect(findingsForDesign(ws, 'en_1', ANTHROPIC).leftOut['not-allowed']).toBe(1);
    expect(ids(findingsForDesign(ws, 'en_1', { kind: 'external', provider: OPENAI }))).toEqual(['fd_a']);
    // AI on this computer wasn't agreed either.
    expect(findingsForDesign(ws, 'en_1', LOCAL).leftOut['not-allowed']).toBe(1);
  });

  it('leaves out a finding resting on two sessions when only one allows it', () => {
    const ws = workspace(draft2(), {}, [finding('fd_both', [inSe1, inSe2]), finding('fd_one', [inSe1])]);
    const r = findingsForDesign(ws, 'en_1', LOCAL);
    expect(ids(r)).toEqual(['fd_one']);
    expect(r.leftOut['not-told']).toBe(1);
  });

  it('leaves out an AI-proposed finding when a session it was given doesn’t allow it, though its evidence does', () => {
    const proposed = finding('fd_ai', [inSe1], {
      provenance: { kind: 'said-in-session' },
      origin: {
        kind: 'ai',
        provider: 'ollama',
        model: 'qwen3:4b',
        processing: LOCAL,
        inputSessionIds: ['se_1', 'se_2'],
        at: T2,
        proposed: { kind: 'design-preference', statement: 'Finding fd_ai.', status: 'suggested', evidence: [inSe1] },
        review: { state: 'accepted', by: 'Sam Consultant', at: T3 },
      },
      history: [{ field: 'status', from: 'suggested', to: 'confirmed', by: 'Sam Consultant', at: T3 }],
    });
    // se_2 allows the AI that proposed it, but wasn't told aiDesign.
    const ws = workspace(draft2(), {}, [proposed]);
    expect(validateWorkspace(ws)).toEqual([]);
    expect(findingsForDesign(ws, 'en_1', LOCAL).leftOut['not-told']).toBe(1);
    expect(ids(findingsForDesign(workspace(draft2(), draft2(), [proposed]), 'en_1', LOCAL))).toEqual(['fd_ai']);
  });

  it('sends a finding resting on no session to an AI on this computer only', () => {
    const own = finding('fd_own', []);
    const ws = workspace({}, {}, [own]);
    expect(ids(findingsForDesign(ws, 'en_1', LOCAL))).toEqual(['fd_own']);
    const r = findingsForDesign(ws, 'en_1', ANTHROPIC);
    expect(ids(r)).toEqual([]);
    expect(r.leftOut['no-session']).toBe(1);
  });

  it('leaves out a finding resting on a session since deleted, whose consent record went with it', () => {
    const gone = finding('fd_gone', [{ kind: 'deleted', sessionId: 'se_gone', deletedAt: T4 }]);
    const r = findingsForDesign(workspace(draft2(), draft2(), [gone]), 'en_1', LOCAL);
    expect(r.leftOut['session-deleted']).toBe(1);
  });

  it('never offers or counts findings that aren’t confirmed, under review, rejected or in another engagement', () => {
    const pending = finding('fd_p', [inSe1], {
      status: 'suggested',
      provenance: { kind: 'ai-suggested' },
      origin: {
        kind: 'ai',
        provider: 'ollama',
        model: 'qwen3:4b',
        processing: LOCAL,
        inputSessionIds: ['se_1'],
        at: T2,
        proposed: { kind: 'design-preference', statement: 'Finding fd_p.', status: 'confirmed', evidence: [inSe1] },
        review: { state: 'pending' },
      },
    });
    const ws = workspace(draft2(), draft2(), [
      finding('fd_assumed', [inSe1], { status: 'assumption' }),
      finding('fd_open', [inSe1], { status: 'unresolved' }),
      finding('fd_said', [inSe1], { status: 'suggested' }),
      pending,
      finding('fd_other', [inSe1], { engagementId: 'en_2' }),
    ]);
    const r = findingsForDesign(ws, 'en_1', LOCAL);
    expect(ids(r)).toEqual([]);
    expect(Object.values(r.leftOut).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('lists them oldest first', () => {
    const ws = workspace(draft2(), draft2(), [
      finding('fd_b', [inSe1], { createdAt: T3 }),
      finding('fd_a', [inSe1], { createdAt: T0 }),
    ]);
    expect(ids(findingsForDesign(ws, 'en_1', LOCAL))).toEqual(['fd_a', 'fd_b']);
  });
});

describe('the left-out message', () => {
  it('says how many and why, one sentence per reason, and nothing when none was left out', () => {
    const none = { 'session-deleted': 0, 'not-allowed': 0, 'not-told': 0, 'no-session': 0 };
    expect(leftOutMessage(none, LOCAL)).toBeNull();
    expect(leftOutMessage({ ...none, 'not-allowed': 3 }, ANTHROPIC)).toBe(
      '3 findings left out: their sessions don’t allow this provider.',
    );
    expect(leftOutMessage({ ...none, 'not-allowed': 2, 'not-told': 1 }, LOCAL)).toBe(
      '2 findings left out: their sessions don’t allow AI on this computer. 1 finding left out: the client wasn’t told the AI may help sketch the screens.',
    );
    expect(leftOutMessage({ ...none, 'no-session': 2, 'session-deleted': 1 }, ANTHROPIC)).toBe(
      '1 finding left out: a session it came from was deleted. 2 findings left out: they cite no session, so they go only to an AI on this computer.',
    );
  });
});
