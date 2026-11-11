/**
 * What the AI is asked when it proposes findings (MVP 6.1; Phase 2 brief,
 * WP6 and decision 7): one session's passages, its transcript segments and
 * its notes, in parts that fit the model's context, and a JSON schema built
 * from the domain types, as the editor's assistant builds its schema from the
 * property registry. Pure: no React, no DOM, no network.
 */
import { FINDING_KINDS, type FindingKind, type FindingStatus } from '../model/types.ts';

/** Changes whenever the prompt or the schema does, so measurements name the prompt they used. */
export const EXTRACTION_PROMPT_VERSION = '2';

/** Statuses the AI may propose (decision 8). Only the consultant confirms. */
export const AI_STATUSES = ['suggested', 'assumption', 'unresolved'] as const satisfies readonly FindingStatus[];
export type AiStatus = (typeof AI_STATUSES)[number];

/** What each kind means (vision §2), as the model is told. */
export const KIND_MEANINGS: Record<FindingKind, string> = {
  'business-requirement': 'what the business needs the project to achieve or support, in business terms',
  'functional-requirement': 'something the software must do: a feature, a screen, a step a user can take',
  'non-functional-requirement':
    'a quality the software must have: usability, availability, language, accessibility, maintainability',
  expectation: 'what the client expects of the project or the consultant: timing, involvement, deliverables',
  objective: 'a business goal or outcome the client wants, often measurable',
  'operational-challenge': 'a problem in how the client works today',
  'existing-system': 'software, hardware or a process the client already uses',
  budget: 'money: a budget, a cost limit, who approves spending',
  performance: 'speed or response time the software must meet',
  scalability: 'volumes, growth and peaks the software must handle',
  security: 'security, privacy or data-protection needs, including personal information',
  'design-preference': 'how the client wants the software to look or feel',
  constraint: 'a limit the solution must respect: technical, legal, practical or time',
  'open-question': 'a question that was raised and not answered in the meeting',
  risk: 'something that could go wrong or threaten the project',
  decision: 'something agreed or decided in the meeting',
  'future-consideration': 'something for a later phase or project, not this one',
};

const STATUS_MEANINGS: Record<AiStatus, string> = {
  suggested: 'the usual choice: the client stated it, or it was agreed in the meeting (the consultant confirms it later)',
  assumption: 'said as a belief that still has to be checked ("I think", "probably", "we would have to check")',
  unresolved: 'only for an open question: something asked and not answered, or left to find out',
};

/** One passage the AI may cite: a transcript segment or a note. `ref` is how the prompt names it. */
export interface Passage {
  ref: string;
  kind: 'segment' | 'note';
  /** The segment's or note's id in the workspace. */
  id: string;
  /** Who said it, for example "Thandi Mokoena (client)", or null for a note or an unnamed speaker. */
  speaker: string | null;
  text: string;
}

/** The reply's shape. Providers that support it constrain generation to it; every reply is checked again anyway. */
export function extractionSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...FINDING_KINDS] },
            status: { type: 'string', enum: [...AI_STATUSES] },
            statement: { type: 'string' },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                properties: { ref: { type: 'string' }, quote: { type: 'string' } },
                required: ['ref', 'quote'],
                additionalProperties: false,
              },
            },
          },
          required: ['kind', 'status', 'statement', 'evidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['findings'],
    additionalProperties: false,
  };
}

/** The instructions, the same for every part. */
export function extractionSystemPrompt(): string {
  const kinds = FINDING_KINDS.map((k) => `- ${k}: ${KIND_MEANINGS[k]}`).join('\n');
  const statuses = AI_STATUSES.map((s) => `- ${s}: ${STATUS_MEANINGS[s]}`).join('\n');
  return `You help a software consultant write up a meeting with a client. You read passages from the meeting's transcript and the consultant's notes, and list the findings a careful consultant would record about the client's project.

Rules:
- Use only what the passages say. Never add facts, numbers or names that aren't there.
- Each finding is one statement in plain English: one full sentence that makes sense on its own, naming what it is about. Keep the client's numbers and names.
- Each finding cites the passages it comes from, by ref (such as S12 or N3), and quotes the words it rests on from each: at least three words, copied exactly as written in that passage.
- When something is corrected or changed later in the meeting, record the final version and cite both passages.
- Leave out greetings, small talk, the consent check at the start of the meeting, and the consultant's own to-do items.
- Leave out anything that was explicitly ruled out, unless ruling it out is itself a decision.
- Something the consultant proposed that the client hasn't agreed to is "suggested"; say in the statement that the consultant proposed it.
- List each finding once. If there are none, return an empty list.

Kinds:
${kinds}

Statuses (choose one for each finding; you never confirm a finding: the consultant does):
${statuses}

Reply with JSON only: {"findings": [{"kind": "...", "status": "...", "statement": "...", "evidence": [{"ref": "S1", "quote": "..."}]}]}`;
}

/** One part of a session, as sent: the passages it covers, and those repeated from the part before for context. */
export interface Chunk {
  index: number;
  count: number;
  /** Passages repeated from the end of the previous part. */
  context: Passage[];
  passages: Passage[];
}

const line = (p: Passage) => `[${p.ref}] ${p.speaker ? `${p.speaker}: ` : p.kind === 'note' ? 'Note: ' : ''}${p.text}`;

/** The message for one part. */
export function extractionMessage(title: string, chunk: Chunk): string {
  const parts = [`Meeting: ${title}`];
  if (chunk.count > 1) parts.push(`This is part ${chunk.index + 1} of ${chunk.count}.`);
  if (chunk.context.length) {
    parts.push(
      `For context, the end of the previous part (its findings are already listed; cite these only together with a new passage):\n${chunk.context.map(line).join('\n')}`,
    );
    parts.push(`New passages:\n${chunk.passages.map(line).join('\n')}`);
  } else parts.push(`Passages:\n${chunk.passages.map(line).join('\n')}`);
  return parts.join('\n\n');
}

/** A rough token count: English runs at about four characters a token, so this errs on the long side. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

/** Room kept for the reply, in tokens. */
export const REPLY_TOKENS = 3000;
/** The share of a part's room repeated from the part before, so a finding spread across the boundary isn't lost. */
export const OVERLAP_SHARE = 0.15;

/**
 * The most context a part is sized for, in tokens, whatever the model allows.
 * Smaller parts found more: a model proposes about twenty findings a reply,
 * however long the part (`docs/research/EXTRACTION.md`).
 */
export const PART_CONTEXT = 6144;

/**
 * Splits a session's passages into parts at passage boundaries, each fitting
 * `PART_CONTEXT`, or the model's context (`contextSize` in the AI settings)
 * if that is smaller, with the instructions and room for the reply. Each
 * part after the first repeats the end of the one before. A passage longer
 * than a whole part goes alone.
 */
export function chunkPassages(title: string, passages: readonly Passage[], contextSize: number): Chunk[] {
  const fixed =
    estimateTokens(extractionSystemPrompt()) +
    estimateTokens(extractionMessage(title, { index: 0, count: 2, context: [], passages: [] })) +
    200;
  const room = Math.max(500, Math.min(contextSize, PART_CONTEXT) - REPLY_TOKENS - fixed);
  const overlap = Math.floor(room * OVERLAP_SHARE);
  const cost = (p: Passage) => estimateTokens(line(p)) + 1;

  const groups: { context: Passage[]; passages: Passage[] }[] = [];
  let i = 0;
  while (i < passages.length) {
    const context: Passage[] = [];
    if (groups.length) {
      let used = 0;
      for (let j = i - 1; j >= 0 && context.length < i; j--) {
        if (used + cost(passages[j]) > overlap) break;
        used += cost(passages[j]);
        context.unshift(passages[j]);
      }
    }
    let used = context.reduce((sum, p) => sum + cost(p), 0);
    const own: Passage[] = [];
    while (i < passages.length && (own.length === 0 || used + cost(passages[i]) <= room)) {
      used += cost(passages[i]);
      own.push(passages[i]);
      i++;
    }
    groups.push({ context, passages: own });
  }
  return groups.map((g, index) => ({ index, count: groups.length, ...g }));
}
