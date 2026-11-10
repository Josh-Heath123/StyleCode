import { describe, expect, it } from 'vitest';
import { amendConsent } from '../model/consent.ts';
import { sampleWorkspace, T3 } from '../model/fixtures.ts';
import type { CompanyWorkspace } from '../model/types.ts';
import { validateWorkspace } from '../model/validate.ts';
import {
  AI_STATUSES,
  chunkPassages,
  estimateTokens,
  extractionMessage,
  extractionSchema,
  extractionSystemPrompt,
  KIND_MEANINGS,
  type Passage,
} from './prompt.ts';
import { addProposals, checkProposals, engagementFindings, normaliseStatement, readReply, sessionPassages } from './proposals.ts';
import { extract } from './run.ts';
import { FINDING_KINDS } from '../model/types.ts';

/** Role-played: the sample workspace's session se_1, a shop's stock spreadsheet. */
const T4 = '2026-11-04T12:00:00.000Z';
const run = { provider: 'ollama', model: 'qwen3:4b', processing: { kind: 'local' } as const, at: T4 };

/** The sample workspace without its findings, so nothing counts as a repeat unless a test adds it. */
function fresh(): CompanyWorkspace {
  return { ...sampleWorkspace(), findings: {}, knowledge: {}, relations: {} };
}

describe('the passages the AI is given', () => {
  it('are the transcript with each speaker named and their side, then the notes', () => {
    expect(sessionPassages(fresh(), 'se_1')).toEqual([
      {
        ref: 'S1',
        kind: 'segment',
        id: 'sg_1',
        speaker: 'Alex Owner (client)',
        text: 'We get about five times as many orders in December.',
      },
      {
        ref: 'S2',
        kind: 'segment',
        id: 'sg_2',
        speaker: 'Alex Owner (client)',
        text: 'Right now we keep stock in a spreadsheet.',
      },
      { ref: 'S3', kind: 'segment', id: 'sg_3', speaker: 'Sam Consultant (consultant)', text: 'Who edits it?' },
      { ref: 'N1', kind: 'note', id: 'no_1', speaker: null, text: 'Ask about spreadsheet conflicts at month end.' },
    ]);
  });
});

describe('the prompt and schema', () => {
  it('come from the domain types: every kind with its meaning, and only the statuses the AI may give', () => {
    const schema = JSON.stringify(extractionSchema());
    for (const kind of FINDING_KINDS) expect(schema).toContain(`"${kind}"`);
    expect(AI_STATUSES).toEqual(['suggested', 'assumption', 'unresolved']);
    expect(schema).not.toContain('"confirmed"');
    const prompt = extractionSystemPrompt();
    for (const kind of FINDING_KINDS) expect(prompt).toContain(`- ${kind}: ${KIND_MEANINGS[kind]}`);
  });

  it('names each passage by its ref and speaker', () => {
    const passages = sessionPassages(fresh(), 'se_1');
    const message = extractionMessage('Stock', { index: 0, count: 1, context: [], passages });
    expect(message).toContain('[S1] Alex Owner (client): We get about five times');
    expect(message).toContain('[N1] Note: Ask about spreadsheet');
    expect(message).not.toContain('part 1 of');
  });
});

describe('splitting a long session', () => {
  const passages: Passage[] = Array.from({ length: 400 }, (_, i) => ({
    ref: `S${i + 1}`,
    kind: 'segment',
    id: `sg_${i + 1}`,
    speaker: 'Thandi Mokoena (client)',
    text: `Passage ${i + 1}: we run forty trucks between two depots and dispatch on a group chat every morning.`,
  }));

  it('keeps everything in one part when it fits', () => {
    const chunks = chunkPassages('Kick-off', passages.slice(0, 10), 8192);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ index: 0, count: 1, context: [] });
  });

  it('splits at passage boundaries, every passage once, each part repeating the end of the one before', () => {
    const chunks = chunkPassages('Kick-off', passages, 8192);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.flatMap((c) => c.passages)).toEqual(passages);
    for (const c of chunks.slice(1)) {
      expect(c.context.length).toBeGreaterThan(0);
      const before = chunks[c.index - 1].passages;
      expect(before.slice(-c.context.length)).toEqual(c.context);
    }
    const system = estimateTokens(extractionSystemPrompt());
    for (const c of chunks) expect(system + estimateTokens(extractionMessage('Kick-off', c)) + 3000).toBeLessThanOrEqual(8192);
  });

  it('uses fewer parts with a larger context', () => {
    expect(chunkPassages('Kick-off', passages, 32_768).length).toBeLessThan(chunkPassages('Kick-off', passages, 8192).length);
  });

  it('sends a passage too long for any part on its own', () => {
    const long = { ...passages[0], text: 'word '.repeat(20_000) };
    const chunks = chunkPassages('Kick-off', [passages[1], long, passages[2]], 4096);
    expect(chunks.map((c) => c.passages.map((p) => p.ref))).toEqual([['S2'], ['S1'], ['S3']]);
  });
});

describe('reading and checking proposals', () => {
  const passages = sessionPassages(fresh(), 'se_1');
  const reply = (findings: unknown[]) => JSON.stringify({ findings });
  const proposal = (fields: Record<string, unknown> = {}) => ({
    kind: 'existing-system',
    status: 'suggested',
    statement: 'Stock is kept in a spreadsheet.',
    evidence: [{ ref: 'S2', quote: 'we keep stock in a spreadsheet' }],
    ...fields,
  });

  it('reads a reply, tolerating code fences, and refuses one that isn’t the JSON asked for', () => {
    expect(readReply('```json\n' + reply([proposal()]) + '\n```', passages)).toHaveLength(1);
    expect(readReply('Sorry, I can’t help.', passages)).toBeNull();
    expect(readReply('{"items": []}', passages)).toBeNull();
    expect(readReply(reply([proposal({ evidence: [{ ref: '[s2]', quote: 'x' }] })]), passages)?.[0].evidence[0].passage?.id).toBe(
      'sg_2',
    );
  });

  it('keeps a proposal that passes every check, with its evidence as segments and notes', () => {
    const raw = readReply(
      reply([
        proposal({
          evidence: [
            { ref: 'S2', quote: 'keep stock in a spreadsheet' },
            { ref: 'N1', quote: 'spreadsheet conflicts at month end' },
          ],
        }),
      ]),
      passages,
    )!;
    const { proposals, dropped } = checkProposals(raw, []);
    expect(Object.values(dropped).every((n) => n === 0)).toBe(true);
    expect(proposals[0].evidence).toEqual([
      { kind: 'segment', segmentId: 'sg_2', quote: 'keep stock in a spreadsheet' },
      { kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' },
    ]);
  });

  it('drops what fails, counting each reason', () => {
    const raw = readReply(
      reply([
        proposal({ evidence: [{ ref: 'S9', quote: 'we keep stock in a spreadsheet' }] }),
        proposal({ evidence: [{ ref: 'S2', quote: 'we keep stock in a database' }] }),
        proposal({ evidence: [{ ref: 'S2', quote: 'spreadsheet' }] }),
        proposal({ evidence: [] }),
        proposal({ statement: '  ' }),
        proposal({ kind: 'wish' }),
        proposal({ status: 'confirmed' }),
        proposal(),
        proposal({ statement: 'STOCK is kept, in a spreadsheet', evidence: [{ ref: 'S1', quote: 'five times as many orders' }] }),
      ]),
      passages,
    )!;
    const { proposals, dropped } = checkProposals(raw, []);
    expect(proposals).toHaveLength(1);
    expect(dropped).toEqual({
      'unknown-passage': 1,
      'quote-not-found': 1,
      'quote-too-short': 1,
      'no-evidence': 1,
      'no-statement': 1,
      'bad-kind': 1,
      'bad-status': 1,
      repeat: 1,
    });
  });

  it('drops a repeat of a finding already in the engagement, in the record, under review or rejected', () => {
    const ws = sampleWorkspace();
    const existing = engagementFindings(ws, 'se_1');
    expect(existing.length).toBeGreaterThan(0);
    const raw = readReply(
      reply([
        // The same statement as an accepted finding, ignoring case and punctuation.
        proposal({
          statement: 'stock is tracked in a spreadsheet that two people edit',
          evidence: [{ ref: 'S1', quote: 'five times as many orders' }],
        }),
        // The same kind and evidence as the pending risk.
        proposal({
          kind: 'risk',
          statement: 'Month-end conflicts.',
          evidence: [{ ref: 'N1', quote: 'spreadsheet conflicts at month end' }],
        }),
        // Another kind with the same evidence isn't a repeat.
        proposal({
          kind: 'operational-challenge',
          statement: 'Month-end conflicts.',
          evidence: [{ ref: 'N1', quote: 'spreadsheet conflicts at month end' }],
        }),
      ]),
      passages,
    )!;
    const { proposals, dropped } = checkProposals(raw, existing);
    expect(dropped.repeat).toBe(2);
    expect(proposals.map((p) => p.kind)).toEqual(['operational-challenge']);
    expect(normaliseStatement('  Stock, is “kept”!  ')).toBe('stock is kept');
  });
});

describe('storing proposals', () => {
  const checked = () =>
    checkProposals(
      readReply(
        JSON.stringify({
          findings: [
            {
              kind: 'existing-system',
              status: 'suggested',
              statement: 'Stock is kept in a spreadsheet.',
              evidence: [{ ref: 'S2', quote: 'keep stock in a spreadsheet' }],
            },
            {
              kind: 'risk',
              status: 'assumption',
              statement: 'Edits may clash at month end.',
              evidence: [{ ref: 'N1', quote: 'spreadsheet conflicts at month end' }],
            },
          ],
        }),
        sessionPassages(fresh(), 'se_1'),
      )!,
      [],
    ).proposals;

  it('adds them as pending AI proposals that keep what the AI proposed, and the workspace stays valid', () => {
    const result = addProposals(fresh(), 'se_1', checked(), run);
    if (!result.ok) throw new Error(result.error);
    const [a, b] = result.value.ids.map((id) => result.value.workspace.findings[id]);
    expect(a).toMatchObject({
      engagementId: 'en_1',
      status: 'suggested',
      provenance: { kind: 'said-in-session' },
      statusSet: { by: { kind: 'ai', provider: 'ollama', model: 'qwen3:4b' }, at: T4 },
      history: [],
      origin: { kind: 'ai', processing: { kind: 'local' }, inputSessionIds: ['se_1'], review: { state: 'pending' } },
    });
    expect(a.origin.kind === 'ai' && a.origin.proposed.statement).toBe('Stock is kept in a spreadsheet.');
    // Only a note: nobody said it in the session, so it is the AI's suggestion.
    expect(b.provenance).toEqual({ kind: 'ai-suggested' });
    expect(validateWorkspace(result.value.workspace)).toEqual([]);
  });

  it('is refused when consent doesn’t allow that processing at that time (rule C5)', () => {
    const external = addProposals(fresh(), 'se_1', checked(), {
      ...run,
      processing: { kind: 'external', provider: 'Anthropic (api.anthropic.com)' },
    });
    expect(external).toEqual({
      ok: false,
      error: 'The client did not agree to an external AI provider. Use a model on this computer.',
    });

    const ws = fresh();
    const withdrawn = amendConsent(ws.consents.cr_1, {
      id: 'am_1',
      kind: 'withdrawal',
      by: 'Sam Consultant',
      at: T3,
      reason: 'Asked to stop.',
    });
    if (!withdrawn.ok) throw new Error(withdrawn.error);
    ws.consents.cr_1 = withdrawn.value;
    expect(addProposals(ws, 'se_1', checked(), run)).toEqual({
      ok: false,
      error: 'The client withdrew consent for this session.',
    });
  });
});

describe('running an extraction', () => {
  it('sends each part, reports progress, and merges what comes back', async () => {
    const passages = sessionPassages(fresh(), 'se_1');
    const progress: string[] = [];
    const sent: string[] = [];
    const result = await extract({
      title: 'Stock',
      passages,
      contextSize: 8192,
      signal: new AbortController().signal,
      onProgress: ({ part, parts }) => progress.push(`${part}/${parts}`),
      send: async ({ message, schema }) => {
        sent.push(message);
        expect(schema).toEqual(extractionSchema());
        return JSON.stringify({ findings: [{ kind: 'budget', status: 'suggested', statement: 'x', evidence: [] }] });
      },
    });
    expect(progress).toEqual(['1/1']);
    expect(sent[0]).toContain('[S1]');
    expect(result).toMatchObject({ parts: 1, unreadable: 0 });
    expect(result.raw).toHaveLength(1);
  });

  it('counts a reply that isn’t JSON, and stops when cancelled', async () => {
    const passages = sessionPassages(fresh(), 'se_1');
    const unreadable = await extract({
      title: 'Stock',
      passages,
      contextSize: 8192,
      signal: new AbortController().signal,
      send: async () => 'No.',
    });
    expect(unreadable).toMatchObject({ raw: [], unreadable: 1 });

    const controller = new AbortController();
    const cancelled = extract({
      title: 'Stock',
      passages,
      contextSize: 8192,
      signal: controller.signal,
      send: async () => {
        controller.abort();
        return '{"findings": []}';
      },
    });
    await expect(cancelled).rejects.toThrow();
  });
});
