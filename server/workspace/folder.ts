import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { constants, homedir, uptime } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';

/**
 * Where the consultant's client data lives (ADR-0006, ADR-0008, ADR-0009).
 *
 * - `npm start` (the built app) uses `~/StyleCode Data`, the real folder.
 * - `npm run dev` uses `~/StyleCode Data (development)`, so development never
 *   touches real client data.
 * - `STYLECODE_WORKSPACE` overrides both (the browser tests use a temporary folder).
 *
 * The folder may not be inside this repository or any git repository, so
 * client data can never be committed. A folder that a cloud service syncs is
 * allowed, with a warning, because syncing sends client data off the computer.
 */
export type WorkspaceMode = 'start' | 'development';

export const FOLDER_NAMES: Record<WorkspaceMode, string> = {
  start: 'StyleCode Data',
  development: 'StyleCode Data (development)',
};

export interface FolderEnvironment {
  env: Record<string, string | undefined>;
  home: string;
  platform: NodeJS.Platform;
}

const here = (): FolderEnvironment => ({ env: process.env, home: homedir(), platform: process.platform });

/** The data folder for a mode, as an absolute path. */
export function resolveDataFolder(mode: WorkspaceMode, environment: FolderEnvironment = here()): string {
  const chosen = environment.env.STYLECODE_WORKSPACE?.trim();
  if (chosen) return resolve(chosen);
  return join(environment.home, FOLDER_NAMES[mode]);
}

/** A reason the data folder can't be used. The server refuses to start with it. */
export class DataFolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataFolderError';
  }
}

const caseInsensitive = (platform: NodeJS.Platform) => platform === 'win32' || platform === 'darwin';

/** Whether `inner` is `outer` or inside it. */
export function isInside(inner: string, outer: string, platform: NodeJS.Platform = process.platform): boolean {
  const fold = (p: string) => {
    const full = resolve(p);
    const trimmed = full.length > parse(full).root.length ? full.replace(/[\\/]+$/, '') : full;
    return caseInsensitive(platform) ? trimmed.toLowerCase() : trimmed;
  };
  const a = fold(inner);
  const b = fold(outer);
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

/** The folders a path goes through, from itself up to the root of its drive. */
function folderAndParents(path: string): string[] {
  const out: string[] = [];
  for (let dir = resolve(path); ; dir = dirname(dir)) {
    out.push(dir);
    if (dirname(dir) === dir) return out;
  }
}

/** The real path of a folder, or of its nearest existing parent, so links and junctions can't hide a repository. */
function realPathOfNearest(path: string): string | null {
  for (const dir of folderAndParents(path)) {
    if (!existsSync(dir)) continue;
    try {
      const real = realpathSync.native(dir);
      return join(real, resolve(path).slice(dir.length));
    } catch {
      return null;
    }
  }
  return null;
}

/** The git repository a folder is in (the folder holding `.git`), or null. */
export function gitRepositoryAround(folder: string): string | null {
  const paths = [resolve(folder)];
  const real = realPathOfNearest(folder);
  if (real && real !== paths[0]) paths.push(real);
  for (const path of paths) {
    for (const dir of folderAndParents(path)) {
      if (existsSync(join(dir, '.git'))) return dir;
    }
  }
  return null;
}

/**
 * The cloud service that syncs a folder, if it looks like one does: OneDrive
 * (its environment variables on Windows, and its folder names), Dropbox,
 * Google Drive and iCloud Drive, by their usual folder names. This is a best
 * guess: a service set up to sync a folder with another name isn't detected.
 */
export function cloudServiceFor(folder: string, environment: FolderEnvironment = here()): string | null {
  const { env, platform } = environment;
  for (const name of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = env[name]?.trim();
    if (root && isAbsolute(root) && isInside(folder, root, platform)) return 'OneDrive';
  }
  const parts = resolve(folder)
    .split(/[\\/]+/)
    .map((p) => p.toLowerCase());
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (/^onedrive( - .+)?$/.test(part)) return 'OneDrive';
    if (/^dropbox( \(.+\))?$/.test(part)) return 'Dropbox';
    if (part === 'google drive' || part === 'my drive') return 'Google Drive';
    if (part === 'iclouddrive' || part === 'icloud drive') return 'iCloud Drive';
    if (part === 'mobile documents' && parts[i - 1] === 'library') return 'iCloud Drive';
    // macOS keeps File Provider services under ~/Library/CloudStorage/<Service>-<account>.
    if (part === 'cloudstorage' && parts[i - 1] === 'library' && parts[i + 1]) {
      const service = parts[i + 1];
      if (service.startsWith('onedrive')) return 'OneDrive';
      if (service.startsWith('dropbox')) return 'Dropbox';
      if (service.startsWith('googledrive')) return 'Google Drive';
      return 'a cloud service';
    }
  }
  return null;
}

export interface DataFolder {
  path: string;
  mode: WorkspaceMode;
  /** The cloud service that seems to sync the folder, shown as a warning in the app. */
  cloudService: string | null;
}

/**
 * Checks the data folder and creates it if it's missing. Throws a
 * `DataFolderError` with the reason if it can't be used.
 */
export function prepareDataFolder(
  mode: WorkspaceMode,
  repositoryRoot: string,
  environment: FolderEnvironment = here(),
): DataFolder {
  const path = resolveDataFolder(mode, environment);
  const fallback = join(environment.home, FOLDER_NAMES[mode]);
  const refuse = (why: string) =>
    new DataFolderError(
      `StyleCode won't use ${path} for client data: ${why} Choose a folder outside any git repository with STYLECODE_WORKSPACE` +
        (isInside(path, fallback, environment.platform) && isInside(fallback, path, environment.platform)
          ? '.'
          : `, or use the default (${fallback}).`),
    );
  if (isInside(path, repositoryRoot, environment.platform)) {
    throw refuse('it is inside the StyleCode repository, so client data could be committed.');
  }
  const repository = gitRepositoryAround(path);
  if (repository) throw refuse(`it is inside a git repository (${repository}), so client data could be committed.`);
  try {
    mkdirSync(join(path, 'companies'), { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new DataFolderError(`StyleCode can't create its data folder ${path}: ${(error as Error).message}`);
  }
  return { path, mode, cloudService: cloudServiceFor(path, environment) };
}

/** The lock file that keeps a second StyleCode from using the same data folder. */
export const LOCK_FILE = '.stylecode.lock';

/** How often the StyleCode holding the lock rewrites its time. */
export const LOCK_REFRESH_MS = 30_000;

/** A lock not refreshed for this long is taken over, whatever its process number. */
export const LOCK_STALE_MS = 2 * 60_000;

interface LockContents {
  pid: number;
  startedAt: string;
  refreshedAt: string;
}

type ReadLock = Partial<Record<keyof LockContents, unknown>>;

/** Whether a process is still running. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** When the computer last started, in milliseconds since 1970. */
function bootTime(): number {
  return Date.now() - uptime() * 1000;
}

function readLock(lock: string): ReadLock | null {
  try {
    const value: unknown = JSON.parse(readFileSync(lock, 'utf8'));
    return value && typeof value === 'object' ? (value as ReadLock) : null;
  } catch {
    return null;
  }
}

/** Removes a lock file if this process still holds it. */
function release(lock: string, pid: number): void {
  try {
    if (readLock(lock)?.pid === pid) unlinkSync(lock);
  } catch {
    // Already gone.
  }
}

/**
 * Rewrites the lock's time if `pid` still holds it. The new contents go to a
 * temporary file that replaces the lock in one step, so another StyleCode
 * reading it never sees half a lock. Returns false once the lock is gone or
 * held by another process (it was taken over); then nothing is written.
 */
export function refreshLock(path: string, pid: number = process.pid, now: number = Date.now()): boolean {
  const lock = join(path, LOCK_FILE);
  const current = readLock(lock);
  if (current?.pid !== pid) return false;
  const at = new Date(now).toISOString();
  const contents: LockContents = {
    pid,
    startedAt: typeof current.startedAt === 'string' ? current.startedAt : at,
    refreshedAt: at,
  };
  const temporary = `${lock}.${pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(contents)}\n`, { mode: 0o600 });
    renameSync(temporary, lock);
  } catch {
    // The folder can't be written just now: the next refresh tries again.
    try {
      unlinkSync(temporary);
    } catch {
      // Not written.
    }
  }
  return true;
}

/**
 * The locks this process holds, with the timer that keeps each fresh. They are
 * kept on `process` rather than in this module: a dev-server restart loads
 * the module again, and must not register the signal handlers or start the
 * refresh a second time.
 */
const HELD = Symbol.for('stylecode.dataFolderLocks');
type Held = { locks: Map<string, ReturnType<typeof setInterval>> };

function held(): Held {
  const owner = process as unknown as { [HELD]?: Held };
  if (owner[HELD]) return owner[HELD];
  const state: Held = { locks: new Map() };
  owner[HELD] = state;
  const releaseAll = () => {
    for (const [lock, timer] of state.locks) {
      clearInterval(timer);
      release(lock, process.pid);
    }
    state.locks.clear();
  };
  // Node doesn't run 'exit' listeners when a signal stops it, so Ctrl+C
  // (SIGINT), closing the console window on Windows (SIGHUP), Ctrl+Break
  // (SIGBREAK) and SIGTERM each release the locks first, then exit.
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  if (process.platform === 'win32') signals.push('SIGBREAK');
  for (const signal of signals) {
    process.once(signal, () => {
      releaseAll();
      process.exit(128 + (constants.signals[signal] ?? 0));
    });
  }
  process.once('exit', releaseAll);
  return state;
}

/** Keeps this process's lock fresh until the process stops, or another StyleCode takes the lock over. */
function keepFresh(path: string, lock: string): void {
  const state = held();
  if (state.locks.has(lock)) return;
  const timer = setInterval(() => {
    if (refreshLock(path)) return;
    clearInterval(timer);
    state.locks.delete(lock);
  }, LOCK_REFRESH_MS);
  timer.unref(); // The refresh alone doesn't keep the process running.
  state.locks.set(lock, timer);
}

export interface ClaimOptions {
  /** The claiming process; tests pass made-up numbers. Only the real process keeps its lock fresh. */
  pid?: number;
  running?: (pid: number) => boolean;
  bootedAt?: number;
  now?: number;
}

/**
 * Claims the data folder for this process, so two StyleCode servers (a second
 * `npm start`, or `npm run dev` pointed at the same folder) can't both save to
 * it: each keeps its own queue of saves, and one could overwrite the other's.
 *
 * The holder rewrites the lock's time every 30 seconds (`LOCK_REFRESH_MS`)
 * and releases it when the process exits or is stopped by a signal. Another
 * process's lock is taken over when:
 * - it hasn't been refreshed for 2 minutes (`LOCK_STALE_MS`), whatever its
 *   process number: Windows reuses process numbers, even for other Node
 *   programs, so a running number proves nothing;
 * - its process has stopped;
 * - it was written before the computer last started.
 *
 * Throws a `DataFolderError` if another StyleCode holds it.
 */
export function claimDataFolder(path: string, options: ClaimOptions = {}): void {
  const { pid = process.pid, running = isRunning, bootedAt = bootTime(), now = Date.now() } = options;
  const lock = join(path, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt++) {
    const at = new Date(now).toISOString();
    const contents: LockContents = { pid, startedAt: at, refreshedAt: at };
    try {
      writeFileSync(lock, `${JSON.stringify(contents)}\n`, { flag: 'wx', mode: 0o600 });
      if (pid === process.pid) keepFresh(path, lock);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new DataFolderError(`StyleCode can't lock its data folder ${path}: ${(error as Error).message}`);
      }
    }
    const value = readLock(lock);
    const holder = typeof value?.pid === 'number' ? value.pid : null;
    if (holder === pid) {
      // This process already holds it (the dev server restarted).
      if (pid === process.pid) keepFresh(path, lock);
      return;
    }
    if (!mayTakeOver(lock, value, holder, { running, bootedAt, now })) {
      throw new DataFolderError(
        `StyleCode is already running with the data folder ${path}${holder === null ? '' : ` (process ${holder})`}. Use the window where it is running, or close it first. If StyleCode isn't running, try again in 2 minutes, or delete ${lock}.`,
      );
    }
    try {
      unlinkSync(lock); // Left by a StyleCode that has stopped.
    } catch {
      // Gone already.
    }
  }
  throw new DataFolderError(`StyleCode can't lock its data folder ${path}.`);
}

/** Whether another process's lock may be taken over (see `claimDataFolder`). */
function mayTakeOver(
  lock: string,
  value: ReadLock | null,
  holder: number | null,
  context: { running: (pid: number) => boolean; bootedAt: number; now: number },
): boolean {
  const startedAt = typeof value?.startedAt === 'string' ? Date.parse(value.startedAt) : Number.NaN;
  // When it was last refreshed: its own time; else when it started (a lock from before the
  // refresh existed); else when the file last changed (a lock that can't be read, perhaps
  // because it is being written).
  let refreshedAt = typeof value?.refreshedAt === 'string' ? Date.parse(value.refreshedAt) : startedAt;
  if (Number.isNaN(refreshedAt)) {
    try {
      refreshedAt = statSync(lock).mtimeMs;
    } catch {
      return true; // Gone.
    }
  }
  if (context.now - refreshedAt > LOCK_STALE_MS) return true;
  if (holder === null) return false; // Recent but unreadable: perhaps being written, so wait.
  const beforeBoot = startedAt < context.bootedAt; // False when startedAt is missing (NaN).
  return beforeBoot || !context.running(holder);
}
