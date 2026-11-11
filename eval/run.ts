/**
 * `npm run eval:run -- --model <name> [--context 8192] [--think off|on|default] [--cpu] [--only <consultation>] [--transcripts <folder>]`
 *
 * Runs StyleCode's extraction (`src/workspace/extraction`) on every
 * consultation through a local Ollama, using the AI server's own provider
 * code, and records each run in `eval/runs/<model>/<consultation>.json` for
 * `npm run eval:score`. Never run in CI: CI scores the recorded runs only.
 *
 * `--transcripts` runs it on an engine's transcripts instead of the typed ones
 * (Phase 3, the downstream test): `<folder>/<consultation>.transcript.json`,
 * scored against `<folder>/<consultation>.key.json` (`npm run eval:transcripts`).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
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
    /** Ollama's `think`: "off" is what the app sends; "on" lets a thinking model reason first; "default" leaves it out. */
    think: { type: 'string', default: 'off' },
    /** Keep the model off the GPU, to measure a computer without one. */
    cpu: { type: 'boolean', default: false },
    /** The reply limit for each part, in tokens: the app's is 3000. A thinking model's reasoning counts against it. */
    'max-tokens': { type: 'string', default: '3000' },
    /** A folder of engine transcripts and translated keys, from `npm run eval:transcripts`. */
    transcripts: { type: 'string' },
  },
});
if (!values.model) throw new Error('Name the model: npm run eval:run -- --model qwen3:4b');
const model = values.model;
const contextSize = Number(values.context);
const maxTokens = Number(values['max-tokens']);
const think = ({ off: false, on: true, default: undefined } as const)[values.think as 'off' | 'on' | 'default'];
if (think === undefined && values.think !== 'default') throw new Error('--think is off, on or default');
const hardware =
  values.hardware ?? `${cpus()[0]?.model.trim()}, ${Math.round(totalmem() / 2 ** 30)} GB RAM${values.cpu ? ', CPU only' : ''}`;

// --cpu: Ollama's num_gpu 0 keeps every layer on the CPU. The provider code stays as the app runs it;
// only the request body gains the option.
if (values.cpu) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    if (String(input).endsWith('/api/chat') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as { options?: Record<string, unknown> };
      init = { ...init, body: JSON.stringify({ ...body, options: { ...body.options, num_gpu: 0 } }) };
    }
    return realFetch(input, init);
  };
}

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

// Unload the model first: Ollama keeps a loaded model's options, so a model left on the CPU by a --cpu
// run would stay there.
const loaded = (await fetch(new URL('/api/ps', values.url))
  .then((r) => r.json())
  .catch(() => ({ models: [] }))) as { models?: { name: string }[] };
if (loaded.models?.some((m) => m.name === model))
  await fetch(new URL('/api/generate', values.url), { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) });

// Load the model before the clock starts: these meetings are minutes long, so a load of several seconds
// would weigh far more in them than it does in an hour-long meeting.
try {
  for await (const _ of streamChat(
    'ollama',
    { baseUrl: values.url!, model, contextSize },
    undefined,
    {
      system: 'Reply with {}.',
      messages: [{ role: 'user', content: 'Ready?' }],
      schema: { type: 'object' },
      maxTokens: 16,
      ...(think === undefined ? {} : { think }),
    },
    new AbortController().signal,
  ));
} catch {
  // A thinking model may run out of its few tokens; it is loaded all the same.
}

for (const id of readdirSync(CONSULTATIONS).sort()) {
  if (values.only && values.only !== id) continue;
  const dir = join(CONSULTATIONS, id);
  const read = <T>(file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
  const consultation = read<Consultation>('consultation.json');
  const other = values.transcripts ? resolve(values.transcripts) : null;
  if (other && !existsSync(join(other, `${id}.transcript.json`))) continue;
  const transcriptFile = other ? join(other, `${id}.transcript.json`) : join(dir, 'transcript.json');
  const keyFile = other ? join(other, `${id}.key.json`) : join(dir, 'answer-key.json');
  const transcript = JSON.parse(readFileSync(transcriptFile, 'utf8')) as EvalTranscript;
  const key = JSON.parse(readFileSync(keyFile, 'utf8')) as AnswerKey;
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
          {
            system,
            messages: [{ role: 'user', content: message }],
            schema,
            maxTokens,
            ...(think === undefined ? {} : { think }),
          },
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
    think: think ?? 'default',
    ...(maxTokens === 3000 ? {} : { maxTokens }),
    ...(values.cpu ? { cpuOnly: true } : {}),
    ...(other
      ? {
          transcriptFile: relative(DIR, transcriptFile).split(sep).join('/'),
          keyFile: relative(DIR, keyFile).split(sep).join('/'),
        }
      : {}),
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
