/**
 * `npm run eval:build`: makes each consultation's `transcript.json` from its
 * platform export, and fills in its answer key's segment ids from the turns.
 * `--check` changes nothing and fails if either file is out of date (CI).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readTranscriptFile } from '../src/workspace/import/read.ts';
import { buildTranscript, fillSegments } from './dataset.ts';
import type { AnswerKey, Consultation } from './types.ts';

export const CONSULTATIONS = join(import.meta.dirname, 'consultations');

const sameJson = (text: string, value: unknown) => {
  try {
    return isDeepStrictEqual(JSON.parse(text), JSON.parse(json(value)));
  } catch {
    return false;
  }
};

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

async function build(check: boolean): Promise<string[]> {
  const problems: string[] = [];
  for (const id of readdirSync(CONSULTATIONS).sort()) {
    const dir = join(CONSULTATIONS, id);
    const consultation = JSON.parse(readFileSync(join(dir, 'consultation.json'), 'utf8')) as Consultation;
    const source = resolve(dir, consultation.source);
    const read = await readTranscriptFile(basename(source), new Uint8Array(readFileSync(source)), consultation);
    if (!read.ok) {
      problems.push(`${id}: ${read.error}`);
      continue;
    }
    const transcript = buildTranscript(id, consultation, read.value, basename(source));
    const keyPath = join(dir, 'answer-key.json');
    const filled = fillSegments(JSON.parse(readFileSync(keyPath, 'utf8')) as AnswerKey, transcript);
    if (filled.unknownTurns.length)
      problems.push(`${id}: the key cites turns that aren't in the transcript: ${filled.unknownTurns.join(', ')}`);
    for (const [file, value] of [
      ['transcript.json', transcript],
      ['answer-key.json', filled.key],
    ] as const) {
      const path = join(dir, file);
      let current = '';
      try {
        current = readFileSync(path, 'utf8');
      } catch {
        current = '';
      }
      // Compared as data, not text: Prettier lays the committed files out differently from JSON.stringify.
      if (sameJson(current, value)) continue;
      if (check) problems.push(`${id}/${file} is out of date: run npm run eval:build.`);
      else writeFileSync(path, json(value));
    }
    console.log(
      `${id}: ${transcript.segments.length} segments, ${transcript.segments.at(-1)?.turn.slice(1)} turns, ${filled.key.findings.length} findings in the key`,
    );
  }
  return problems;
}

const problems = await build(process.argv.includes('--check'));
for (const p of problems) console.error(p);
process.exitCode = problems.length ? 1 : 0;
