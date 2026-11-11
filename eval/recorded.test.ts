import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTranscriptFile } from '../src/workspace/import/read.ts';
import { buildTranscript, fillSegments } from './dataset.ts';
import { readSettled, scoreRun } from './scorer.ts';
import type { AnswerKey, Consultation, EvalTranscript, RecordedRun } from './types.ts';

/**
 * The evaluation set as committed (Phase 2 brief, WP5): every consultation's
 * transcript and key are what the importer and `npm run eval:build` make
 * now, and a recorded run still scores as it did, so the harness can't
 * silently break.
 */
const DIR = import.meta.dirname;
const CONSULTATIONS = join(DIR, 'consultations');
const ids = readdirSync(CONSULTATIONS).sort();
const json = <T>(...path: string[]) => JSON.parse(readFileSync(join(...path), 'utf8')) as T;

describe('the evaluation set', () => {
  it('has the three consultations of decision 19 and the hour-long one of Phase 3', () => {
    expect(ids).toEqual(['bosveld-citrus-intake', 'karoo-freight-kickoff', 'umoya-school-portal', 'veldt-vets-booking']);
  });

  it.each(ids)('%s: the transcript and the key’s segments are up to date', async (id) => {
    const dir = join(CONSULTATIONS, id);
    const consultation = json<Consultation>(dir, 'consultation.json');
    const source = resolve(dir, consultation.source);
    const read = await readTranscriptFile(basename(source), new Uint8Array(readFileSync(source)), consultation);
    if (!read.ok) throw new Error(read.error);
    const transcript = buildTranscript(id, consultation, read.value, basename(source));
    expect(json(dir, 'transcript.json')).toEqual(transcript);
    const key = json<AnswerKey>(dir, 'answer-key.json');
    const filled = fillSegments(key, transcript);
    expect(filled.unknownTurns).toEqual([]);
    expect(key).toEqual(filled.key);
    expect(new Set(key.findings.map((f) => f.id)).size).toBe(key.findings.length);
  });
});

describe('a recorded run', () => {
  it('scores as it did when it was recorded', () => {
    const run = json<RecordedRun>(DIR, 'runs', 'qwen3-4b', 'karoo-freight-kickoff.json');
    const dir = join(CONSULTATIONS, run.consultation);
    const settled = readSettled(readFileSync(join(DIR, 'runs', 'qwen3-4b', 'karoo-freight-kickoff.matches.csv'), 'utf8'));
    const score = scoreRun(
      json<EvalTranscript>(dir, 'transcript.json'),
      json<AnswerKey>(dir, 'answer-key.json'),
      run.proposals,
      settled,
    );
    expect(score.unsettled).toBe(0);
    expect(score.total).toEqual(EXPECTED);
  });
});

/** Set when the run was recorded and its unclear matches settled; see eval/README.md. */
const EXPECTED = { kind: 'all', proposed: 13, correct: 13, invented: 0, expected: 20, found: 10 };
