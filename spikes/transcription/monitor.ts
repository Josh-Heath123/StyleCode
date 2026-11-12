/**
 * Watching a run (Phase 3 brief, decision 8): the program's peak memory,
 * sampled every second with `tasklist` (Windows), and the GPU's clock,
 * temperature, memory and power, from `nvidia-smi` every second, logged
 * every 15 seconds as `EXTRACTION.md` logged them. No PowerShell.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

export interface GpuSample {
  atMs: number;
  clockMHz: number;
  temperatureC: number;
  memoryMiB: number;
  utilisation: number;
  powerW: number;
}

export interface Resources {
  peakRamMiB: number | null;
  peakGpuMemoryMiB: number | null;
  /** The GPU's memory before the run started, so the run's own share can be told apart. */
  gpuMemoryBeforeMiB: number | null;
  gpu: GpuSample[];
}

/** The GPU's state now, from `nvidia-smi`, or null without one. */
export function gpuNow(): GpuSample | null {
  const out = spawnSync(
    'nvidia-smi',
    ['--query-gpu=clocks.gr,temperature.gpu,memory.used,utilization.gpu,power.draw', '--format=csv,noheader,nounits'],
    { encoding: 'utf8' },
  );
  if (out.status !== 0) return null;
  const [clock, temp, mem, util, power] = out.stdout
    .trim()
    .split(',')
    .map((x) => Number(x.trim()));
  return { atMs: 0, clockMHz: clock, temperatureC: temp, memoryMiB: mem, utilisation: util, powerW: power };
}

/** A process's working set in MiB, from `tasklist`, or null if it has ended. */
function ramOf(pid: number): number | null {
  const out = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  const m = /"([\d.,\s ]+) K"/.exec(out.stdout ?? '');
  return m ? Number(m[1].replace(/[^\d]/g, '')) / 1024 : null;
}

/** Runs a program (never through a shell), watching it, and returns what it printed, its time and its resources. */
export async function runWatched(
  program: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string; wallMs: number; resources: Resources }> {
  const before = gpuNow();
  const gpu: GpuSample[] = [];
  let peakRam: number | null = null;
  let peakGpu: number | null = before?.memoryMiB ?? null;
  const started = Date.now();
  const child: ChildProcess = spawn(program, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stderr!.on('data', (d: Buffer) => (stderr += d.toString()));
  let tick = 0;
  const timer = setInterval(() => {
    if (child.pid) {
      const ram = ramOf(child.pid);
      if (ram !== null) peakRam = Math.max(peakRam ?? 0, ram);
    }
    const g = gpuNow();
    if (g) {
      peakGpu = Math.max(peakGpu ?? 0, g.memoryMiB);
      if (tick % 15 === 0) gpu.push({ ...g, atMs: Date.now() - started });
    }
    tick++;
  }, 1000);
  const code = await new Promise<number>((done, fail) => {
    child.on('error', fail);
    child.on('close', (c) => done(c ?? -1));
  });
  clearInterval(timer);
  return {
    code,
    stdout,
    stderr,
    wallMs: Date.now() - started,
    resources: { peakRamMiB: peakRam, peakGpuMemoryMiB: peakGpu, gpuMemoryBeforeMiB: before?.memoryMiB ?? null, gpu },
  };
}

/** The computer, as the results record it. */
export function hardware(): Record<string, string> {
  const gpu = spawnSync('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'], {
    encoding: 'utf8',
  });
  return {
    computer: 'Intel Core i7-12700H, 16 GB RAM, Windows 11',
    gpu: gpu.status === 0 ? gpu.stdout.trim() : 'none found',
    power: process.env.STYLECODE_POWER ?? 'not recorded (set STYLECODE_POWER, for example "plugged in, performance mode")',
  };
}
