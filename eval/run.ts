/**
 * `npm run eval:run -- --model <name> [--context 8192] [--only <consultation>]`
 *
 * Runs StyleCode's extraction (`src/workspace/extraction`) on every
 * consultation through a local Ollama, using the AI server's own provider
 * code, and records each run in `eval/runs/<model>/<consultation>.json` for
 * `npm run eval:score`. Never run in CI: CI scores the recorded runs only.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { streamChat } from '../server/ai/providers.ts';
import { EXTRACTION_PROMPT_VERSION, type Passage } from '../src/workspace/extraction/prompt.ts';
import { extract } from '../src/workspace/extraction/run.ts';
import { checkProposals } from '../src/workspace/extraction/proposals.ts';
import { formatScore, scoreRun } from './scorer.ts';
import type { AnswerKey, Consultation, EvalTranscript, RecordedRun } from './types.ts';

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    context: { type: 'string', default: '8192' },
    only: { type: 'string' },
    url: { type: 'string', default: 'http://localhost:11434' },
    hardware: { type: 'string' },
    /** The folder the runs go in, under eval/runs/ (default: the model's name). */
    label: { type: 'string' },
  },
});
if (!values.model) throw new Error('Name the model: npm run eval:run -- --model qwen3:4b');
const model = values.model;
const contextSize = Number(values.context);
const hardware = values.hardware ?? `${cpus()[0]?.model.trim()}, ${Math.round(totalmem() / 2 ** 30)} GB RAM`;

const DIR = import.meta.dirname;
const CONSULTATIONS = join(DIR, 'consultations');
const out = join(DIR, 'runs', (values.label ?? model).replace(/[^a-z0-9.-]+/gi, '-'));
mkdirSync(out, { recursive: true });

/** The passages the AI is given, as the app gives them: the speaker with their side when known. */
function passagesOf(transcript: EvalTranscript, consultation: Consultation): Passage[] {
  const sides = new Map(consultation.participants.map((p) => [p.name, p.side]));
  return transcript.segments.map((s, i) => {
    const name = s.speakerLabel?.replace(/\s*\((guest|external)\)$/i, '') ?? null;
    const side = name ? sides.get(name) : undefined;
    return {
      ref: `S${i + 1}`,
      kind: 'segment',
      id: s.id,
      speaker: name && side ? `${name} (${side})` : s.speakerLabel,
      text: s.text,
    };
  });
}

for (const id of readdirSync(CONSULTATIONS).sort()) {
  if (values.only && values.only !== id) continue;
  const dir = join(CONSULTATIONS, id);
  const read = <T>(file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
  const consultation = read<Consultation>('consultation.json');
  const transcript = read<EvalTranscript>('transcript.json');
  const key = read<AnswerKey>('answer-key.json');
  const passages = passagesOf(transcript, consultation);

  const startedAt = new Date();
  const result = await extract({
    title: transcript.title,
    passages,
    contextSize,
    signal: new AbortController().signal,
    onProgress: ({ part, parts }) => process.stdout.write(`${id}: part ${part} of ${parts}…\n`),
    // A part that fails (a reply cut off, say) counts as unreadable, and the run goes on, so it is measured.
    send: async ({ system, message, schema }, signal) => {
      let reply = '';
      try {
        for await (const delta of streamChat(
          'ollama',
          { baseUrl: values.url!, model, contextSize },
          undefined,
          { system, messages: [{ role: 'user', content: message }], schema, maxTokens: 3000, think: false },
          signal,
        ))
          reply += delta;
      } catch (error) {
        console.error(`${id}: ${(error as Error).message}`);
        return '';
      }
      return reply;
    },
  });
  const durationMs = Date.now() - startedAt.getTime();

  const run: RecordedRun & { dropped: Record<string, number>; shown: number } = {
    consultation: id,
    provider: 'ollama',
    model,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    contextSize,
    chunks: result.parts,
    startedAt: startedAt.toISOString(),
    durationMs,
    unreadableReplies: result.unreadable,
    hardware,
    proposals: result.raw.map((p) => ({
      kind: String(p.kind),
      status: String(p.status),
      statement: String(p.statement ?? ''),
      evidence: p.evidence.map((e) => ({ segmentId: e.passage?.id ?? e.ref, quote: String(e.quote ?? '') })),
    })),
    ...(() => {
      const checked = checkProposals(result.raw, []);
      return { dropped: checked.dropped, shown: checked.proposals.length };
    })(),
  };
  writeFileSync(join(out, `${id}.json`), `${JSON.stringify(run, null, 2)}\n`);
  console.log(`\n${id}: ${run.proposals.length} proposals in ${(durationMs / 1000).toFixed(1)} s (${run.chunks} parts)\n`);
  console.log(formatScore(scoreRun(transcript, key, run.proposals)));
  console.log();
}
