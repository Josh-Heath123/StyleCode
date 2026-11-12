/**
 * Shared by WP3's drivers (`extraction.ts`, `endtoend.ts`, `live.ts`): running
 * the repository's own scripts as steps, timing them, and logging the GPU
 * across several steps at once. Programs are spawned with argument arrays,
 * never through a shell.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
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

const LOG = join(SPIKE_HOME, 'measure.log');
export function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  mkdirSync(SPIKE_HOME, { recursive: true });
  appendFileSync(LOG, `${stamped}\n`);
}

export interface StepResult {
  name: string;
  code: number;
  startedMs: number;
  wallMs: number;
  /** The last lines printed: timings and errors only (the scripts never print what an engine heard). */
  tail: string;
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

/** Runs a step to its end, logging the outcome. A failed step is logged and returned, not thrown. */
export async function step(name: string, script: string, args: string[]): Promise<StepResult> {
  const result = await startScript(name, script, args).done;
  log(
    `${result.code === 0 ? 'ok' : 'FAILED'} ${name}: ${(result.wallMs / 1000).toFixed(1)} s${result.code === 0 ? '' : ` (exit ${result.code}): ${result.tail}`}`,
  );
  return result;
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
