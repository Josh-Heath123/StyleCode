/**
 * The hour-long meeting end to end, and sharing the GPU (Phase 3 brief,
 * decisions 8 and 10):
 *
 *   node --experimental-strip-types spikes/transcription/endtoend.ts <words candidate> <speakers model> <--count | --threshold x> [<other words candidate>...]
 *
 * 1. **One after the other:** words, then speakers, then putting them
 *    together, then extraction (qwen3:4b at 6144) on the result: the minutes
 *    from the end of the meeting to the proposals.
 * 2. **Words and speakers at once** (the speaker engine runs on the CPU),
 *    then putting them together and extraction.
 * 3. **Transcription during an extraction run** (decision 10): extraction of
 *    the typed hour-long meeting alone, then each words candidate alone, then
 *    each started while that extraction is under way. Both times, and the
 *    GPU's memory, against the times alone.
 *
 * The summary goes to eval/transcription/endtoend/<words>.json, saved after
 * each section. Started again, it keeps the sections already done and runs
 * the rest; a section that was stopped runs again whole, since its times only
 * mean something together.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOUR_MEETING,
  ROOT,
  beginDriver,
  coolGpu,
  extractionArgs,
  gpuLog,
  log,
  pause,
  startScript,
  step,
  unloadModel,
  type StepResult,
} from './steps.ts';

const [words, speakersModel, ...more] = process.argv.slice(2);
const speakerOption = more[0] === '--count' ? ['--count'] : more[0] === '--threshold' ? ['--threshold', more[1]] : null;
if (!words || !speakersModel || !speakerOption)
  throw new Error('endtoend.ts <words candidate> <speakers model> <--count | --threshold x> [<other words candidate>...]');
const others = more.slice(speakerOption.length);
const wordsArgs = (candidate: string, label: string) => ['words', candidate, HOUR_MEETING, 'clean', '--label', label];
const speakersArgs = (label: string) => ['speakers', speakersModel, HOUR_MEETING, 'clean', ...speakerOption, '--label', label];
const RUN = 'spikes/transcription/run.ts';
const OUT = join(ROOT, 'eval', 'transcription', 'endtoend');
const OUT_FILE = join(OUT, `${words}.json`);
const speakersSetting = `${speakersModel} ${speakerOption.join(' ')}`;
const before = existsSync(OUT_FILE) ? (JSON.parse(readFileSync(OUT_FILE, 'utf8')) as Record<string, unknown>) : null;
// Sections done before are kept only when they were measured with the same speakers setting.
const summary: Record<string, unknown> =
  before && before.speakers === speakersSetting ? before : { words, speakers: speakersSetting, at: new Date().toISOString() };
const save = () => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT_FILE}.part`, `${JSON.stringify(summary, null, 2)}\n`);
  renameSync(`${OUT_FILE}.part`, OUT_FILE);
};
const brief = (r: StepResult) => ({
  name: r.name,
  ok: r.code === 0,
  wallMs: r.wallMs,
  ...(r.code === 0 ? {} : { error: r.tail }),
});

beginDriver(`end to end: ${words} with ${speakersSetting}; also ${others.join(', ') || 'nothing'}`);
// A section, or a candidate's pair of runs, counts as done only when every step in it worked.
type Brief = { ok: boolean };
const allOk = (x: unknown): boolean => {
  const s = x as { ok?: boolean; steps?: Brief[]; alone?: Brief; during?: Brief; extraction?: Brief } | undefined;
  if (!s) return false;
  if (s.steps) return s.steps.every((b) => b.ok);
  if (s.alone) return [s.alone, s.during, s.extraction].every((b) => b?.ok);
  return s.ok === true;
};
const doneBefore = (section: string) => {
  if (!allOk(summary[section])) return false;
  log(`skip end to end ${section}: done before`);
  return true;
};

// 1. One after the other.
if (!doneBefore('sequential')) {
  await unloadModel();
  const gpu = gpuLog();
  const w = await step('e2e sequential: words', RUN, wordsArgs(words, `e2e-seq-${words}`));
  const s = await step('e2e sequential: speakers', RUN, speakersArgs(`e2e-seq-speakers-${words}`));
  const b = await step('e2e sequential: together', 'eval/transcription/build.ts', [
    `e2e-seq-${words}`,
    `e2e-seq-speakers-${words}`,
    'clean',
  ]);
  const e = await step(
    'e2e sequential: extraction',
    'eval/run.ts',
    extractionArgs(`p3-e2e-sequential-${words}`, 6144, [
      '--only',
      HOUR_MEETING,
      '--transcripts',
      `eval/transcription/extraction/e2e-seq-${words}+e2e-seq-speakers-${words}.clean`,
    ]),
  );
  const steps = [w, s, b, e];
  summary.sequential = {
    steps: steps.map(brief),
    totalMs: steps.reduce((n, x) => n + x.wallMs, 0),
    gpu: gpu.stop(),
  };
  save();
}

// 2. Words and speakers at once.
if (!doneBefore('parallel')) {
  await unloadModel();
  await coolGpu('e2e parallel: words and speakers at once');
  const gpu = gpuLog();
  log('start e2e parallel: words and speakers at once');
  const started = Date.now();
  const [w, s] = await Promise.all([
    startScript('e2e parallel: words', RUN, wordsArgs(words, `e2e-par-${words}`)).done,
    startScript('e2e parallel: speakers', RUN, speakersArgs(`e2e-par-speakers-${words}`)).done,
  ]);
  const both = Date.now() - started;
  for (const r of [w, s])
    log(`${r.code === 0 ? 'ok' : 'FAILED'} ${r.name}: ${(r.wallMs / 1000).toFixed(1)} s${r.code ? `: ${r.tail}` : ''}`);
  const b = await step('e2e parallel: together', 'eval/transcription/build.ts', [
    `e2e-par-${words}`,
    `e2e-par-speakers-${words}`,
    'clean',
  ]);
  const e = await step(
    'e2e parallel: extraction',
    'eval/run.ts',
    extractionArgs(`p3-e2e-parallel-${words}`, 6144, [
      '--only',
      HOUR_MEETING,
      '--transcripts',
      `eval/transcription/extraction/e2e-par-${words}+e2e-par-speakers-${words}.clean`,
    ]),
  );
  summary.parallel = {
    steps: [w, s, b, e].map(brief),
    wordsAndSpeakersMs: both,
    totalMs: both + b.wallMs + e.wallMs,
    gpu: gpu.stop(),
  };
  save();
}

// 3. Transcription during an extraction run.
if (!doneBefore('extractionAlone')) {
  await unloadModel();
  const gpu = gpuLog();
  const alone = await step(
    'extraction alone',
    'eval/run.ts',
    extractionArgs(`p3-gpu-extraction-alone-${words}`, 6144, ['--only', HOUR_MEETING]),
  );
  summary.extractionAlone = { ...brief(alone), gpu: gpu.stop() };
  save();
}
// Pairs that failed are dropped, and run again if their candidate is listed.
const contention = ((summary.contention ?? []) as Record<string, unknown>[]).filter(allOk);
summary.contention = contention;
for (const candidate of [words, ...others]) {
  if (contention.some((c) => c.candidate === candidate)) {
    log(`skip end to end contention ${candidate}: done before`);
    continue;
  }
  {
    await unloadModel();
    await coolGpu(`${candidate} alone`); // step() would too; here so the GPU log starts after the wait
    let gpu = gpuLog();
    const t = await step(`${candidate} alone`, RUN, wordsArgs(candidate, `gpu-alone-${candidate}`));
    const aloneGpu = gpu.stop();
    await unloadModel();
    await coolGpu(`extraction with ${candidate}`);
    gpu = gpuLog();
    // Start the transcription once extraction is sending its first part, so the model is on the GPU.
    let partStarted: () => void = () => undefined;
    const firstPart = new Promise<void>((r) => (partStarted = r));
    const e = startScript(
      `extraction with ${candidate}`,
      'eval/run.ts',
      extractionArgs(`p3-gpu-extraction-with-${candidate}`, 6144, ['--only', HOUR_MEETING]),
      (line) => {
        if (/part 1 of/.test(line)) partStarted();
      },
    );
    log(`start ${candidate} during extraction`);
    await Promise.race([firstPart, e.done]);
    await pause(10_000);
    const tw = await startScript(`${candidate} during extraction`, RUN, wordsArgs(candidate, `gpu-with-extraction-${candidate}`))
      .done;
    const ew = await e.done;
    for (const r of [tw, ew])
      log(`${r.code === 0 ? 'ok' : 'FAILED'} ${r.name}: ${(r.wallMs / 1000).toFixed(1)} s${r.code ? `: ${r.tail}` : ''}`);
    contention.push({
      candidate,
      alone: { ...brief(t), gpu: aloneGpu },
      during: brief(tw),
      extraction: brief(ew),
      gpu: gpu.stop(),
    });
    save();
  }
}
summary.complete = true;
save();
log('driver end to end done');
