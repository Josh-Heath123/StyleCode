/**
 * `npm run eval:transcripts -- <words run> [<speakers run>] [clean|hard]`:
 * makes the engine's transcripts and translated keys for the downstream test
 * (`downstream.ts`), into `eval/transcription/extraction/<words>+<speakers>.<version>/`,
 * for `npm run eval:run -- --model qwen3:4b --transcripts <that folder>`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnswerKey, Consultation } from '../types.ts';
import { engineTranscript, translateKey } from './downstream.ts';
import { readRun } from './runs.ts';

const HERE = import.meta.dirname;
const [wordsRun, speakersRun, version = 'clean'] = process.argv.slice(2);
if (!wordsRun) {
  console.error('Usage: npm run eval:transcripts -- <words run> [<speakers run>] [clean|hard]');
  process.exit(1);
}
const out = join(HERE, 'extraction', `${wordsRun}+${speakersRun ?? 'none'}.${version}`);
mkdirSync(out, { recursive: true });
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

for (const meeting of readdirSync(join(HERE, '..', 'consultations')).sort()) {
  const wordsFile = join(HERE, 'runs', wordsRun, `${meeting}.${version}.json`);
  const speakersFile = speakersRun && join(HERE, 'runs', speakersRun, `${meeting}.${version}.json`);
  if (!existsSync(wordsFile) || (speakersFile && !existsSync(speakersFile))) continue;
  const dir = join(HERE, '..', 'consultations', meeting);
  const consultation = JSON.parse(readFileSync(join(dir, 'consultation.json'), 'utf8')) as Consultation;
  const key = JSON.parse(readFileSync(join(dir, 'answer-key.json'), 'utf8')) as AnswerKey;
  const timeline = JSON.parse(readFileSync(join(HERE, '..', 'audio', `${meeting}.timeline.json`), 'utf8'))[version].turns;
  const words = readRun(JSON.parse(readFileSync(wordsFile, 'utf8'))).words!;
  const turns = speakersFile ? readRun(JSON.parse(readFileSync(speakersFile, 'utf8'))).turns! : null;
  const transcript = engineTranscript(
    meeting,
    consultation.title,
    consultation.timeZone,
    consultation.startsAt,
    timeline,
    words,
    turns,
    `${wordsRun}+${speakersRun ?? 'none'}.${version}`,
  );
  const translated = translateKey(key, timeline, transcript);
  writeFileSync(join(out, `${meeting}.transcript.json`), json(transcript));
  writeFileSync(join(out, `${meeting}.key.json`), json(translated));
  const empty = translated.findings.filter((f) => !f.segments.length).length;
  console.log(`${meeting}: ${transcript.segments.length} segments${empty ? `; ${empty} key findings with no segment` : ''}`);
}
