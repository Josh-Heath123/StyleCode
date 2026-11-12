/**
 * Shared by WP3's drivers (`extraction.ts`, `endtoend.ts`, `live.ts`): running
 * the repository's own scripts as steps, timing them, and logging the GPU
 * across several steps at once. Programs are spawned with argument arrays,
 * never through a shell.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SPIKE_HOME } from './files.ts';
import { gpuNow, hardware, type GpuSample } from './monitor.ts';

export const ROOT = join(import.meta.dirname, '..', '..');
export const MEETINGS = ['karoo-freight-kickoff', 'umoya-school-portal', 'veldt-vets-booking', 'bosveld-citrus-intake'];
export const SHORT_MEETINGS = MEETINGS.slice(0, 3);
export const HOUR_MEETING = 'bosveld-citrus-intake';
export const MODEL = 'qwen3:4b';

/** The hardware line eval/run.ts records with each extraction run. */
export const HARDWARE = (() => {
  const h = hardware();
  return `${h.computer}; ${h.gpu}; ${h.power}`;
})();

/**
 * The progress log: each step's start, end and outcome, by name and time only,
 * never what an engine heard. Git-ignored (`*.log`).
 */
export const LOG = join(ROOT, 'eval', 'transcription', 'progress.log');
export function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(LOG, `${stamped}\n`);
}

/**
 * Starts a driver: clears the work folders a stopped run left behind (only one
 * driver runs at a time), and logs the start.
 */
export function beginDriver(line: string): void {
  rmSync(join(SPIKE_HOME, 'work'), { recursive: true, force: true });
  mkdirSync(SPIKE_HOME, { recursive: true });
  log(`driver ${line} (pid ${process.pid}, power: ${process.env.STYLECODE_POWER ?? 'not recorded'})`);
}

/** Where eval/run.ts records a meeting's extraction run under a label. */
export const extractionResult = (label: string, meeting: string) =>
  join(ROOT, 'eval', 'runs', label.replace(/[^a-z0-9.-]+/gi, '-'), `${meeting}.json`);

export interface StepResult {
  name: string;
  code: number;
  startedMs: number;
  wallMs: number;
  /** The last lines printed: timings and errors only (the scripts never print what an engine heard). */
  tail: string;
  /** True when the step was skipped because its result was already on disk. */
  skipped?: boolean;
}

/** Starts one of the repository's TypeScript scripts with Node; `done` resolves when it ends. */
export function startScript(
  name: string,
  script: string,
  args: string[],
  onLine?: (line: string) => void,
): { child: ChildProcess; done: Promise<StepResult> } {
  const startedMs = Date.now();
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', join(ROOT, script), ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const take = (d: Buffer) => {
    const text = d.toString();
    out += text;
    if (onLine) for (const line of text.split('\n')) if (line.trim()) onLine(line);
  };
  child.stdout!.on('data', take);
  child.stderr!.on('data', take);
  const done = new Promise<StepResult>((resolve) => {
    const finish = (code: number, extra = '') =>
      resolve({
        name,
        code,
        startedMs,
        wallMs: Date.now() - startedMs,
        tail: (out + extra).trim().split('\n').slice(-4).join(' | '),
      });
    child.on('close', (c) => finish(c ?? -1));
    child.on('error', (e) => finish(-1, e.message));
  });
  return { child, done };
}

/**
 * Runs a step to its end, logging its start and outcome. A failed step is
 * logged and returned, not thrown. With `result`, the step is skipped when that
 * file already exists, so a stopped batch can be started again.
 */
export async function step(name: string, script: string, args: string[], result?: string): Promise<StepResult> {
  if (result && existsSync(result)) {
    log(`skip ${name}: done before`);
    return { name, code: 0, startedMs: Date.now(), wallMs: 0, tail: '', skipped: true };
  }
  log(`start ${name}`);
  const r = await startScript(name, script, args).done;
  log(
    `${r.code === 0 ? 'ok' : 'FAILED'} ${name}: ${(r.wallMs / 1000).toFixed(1)} s${r.code === 0 ? '' : ` (exit ${r.code}): ${r.tail}`}`,
  );
  return r;
}

/** The extraction run of eval/run.ts with the app's settings (qwen3:4b, think off), recorded under eval/runs/<label>/. */
export const extractionArgs = (label: string, context: number, extra: string[] = []) => [
  '--model',
  MODEL,
  '--context',
  String(context),
  '--label',
  label,
  '--hardware',
  HARDWARE,
  ...extra,
];

/** Samples the GPU every second until stopped; keeps every 15th sample and the peak memory. */
export function gpuLog(): { stop: () => { peakMemoryMiB: number | null; samples: GpuSample[] } } {
  const started = Date.now();
  const samples: GpuSample[] = [];
  let peak: number | null = null;
  let tick = 0;
  const timer = setInterval(() => {
    const g = gpuNow();
    if (g) {
      peak = Math.max(peak ?? 0, g.memoryMiB);
      if (tick % 15 === 0) samples.push({ ...g, atMs: Date.now() - started });
    }
    tick++;
  }, 1000);
  return {
    stop: () => {
      clearInterval(timer);
      return { peakMemoryMiB: peak, samples };
    },
  };
}

/** Asks Ollama to unload a model, so a step starts with the GPU as an idle laptop has it. */
export async function unloadModel(): Promise<void> {
  await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({ model: MODEL, keep_alive: 0 }),
  }).catch(() => undefined);
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
