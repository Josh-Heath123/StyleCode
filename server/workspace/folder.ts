import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
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

/** Removes a lock file if this process still holds it. */
function release(lock: string, pid: number): void {
  try {
    if ((JSON.parse(readFileSync(lock, 'utf8')) as { pid?: unknown }).pid === pid) unlinkSync(lock);
  } catch {
    // Already gone.
  }
}

/**
 * The locks this process holds, kept on `process` rather than in this module:
 * a dev-server restart loads the module again, and must not register the
 * signal handlers a second time.
 */
const HELD = Symbol.for('stylecode.dataFolderLocks');
type Held = { locks: Set<string> };

function held(): Held {
  const owner = process as unknown as { [HELD]?: Held };
  if (owner[HELD]) return owner[HELD];
  const state: Held = { locks: new Set() };
  owner[HELD] = state;
  const releaseAll = () => {
    for (const lock of state.locks) release(lock, process.pid);
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

/**
 * Claims the data folder for this process, so two StyleCode servers (a second
 * `npm start`, or `npm run dev` pointed at the same folder) can't both save to
 * it: each keeps its own queue of saves, and one could overwrite the other's.
 * The lock is released when the process exits or is stopped by a signal. A
 * lock is taken over when it was left by a process that has stopped, or was
 * written before the computer last started (its process number may since
 * belong to another program). Throws a `DataFolderError` if another StyleCode
 * holds it.
 */
export function claimDataFolder(
  path: string,
  pid: number = process.pid,
  running: (pid: number) => boolean = isRunning,
  bootedAt: number = bootTime(),
): void {
  const lock = join(path, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lock, `${JSON.stringify({ pid, startedAt: new Date().toISOString() })}\n`, { flag: 'wx', mode: 0o600 });
      if (pid === process.pid) held().locks.add(lock);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new DataFolderError(`StyleCode can't lock its data folder ${path}: ${(error as Error).message}`);
      }
    }
    let holder: number | null = null;
    let startedAt = Number.NaN;
    try {
      const value = JSON.parse(readFileSync(lock, 'utf8')) as { pid?: unknown; startedAt?: unknown };
      holder = typeof value.pid === 'number' ? value.pid : null;
      startedAt = typeof value.startedAt === 'string' ? Date.parse(value.startedAt) : Number.NaN;
    } catch {
      // Unreadable: treat as left behind.
    }
    if (holder === pid) return; // This process already holds it (the dev server restarted).
    const beforeBoot = startedAt < bootedAt; // False when startedAt is missing (NaN): then the process number decides.
    if (holder !== null && !beforeBoot && running(holder)) {
      throw new DataFolderError(
        `StyleCode is already running with the data folder ${path} (process ${holder}). Use the window where it is running, or close it first. If StyleCode isn't running, delete ${lock}.`,
      );
    }
    unlinkSync(lock); // Left by a StyleCode that has stopped.
  }
  throw new DataFolderError(`StyleCode can't lock its data folder ${path}.`);
}
