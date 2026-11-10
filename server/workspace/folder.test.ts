import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimDataFolder,
  cloudServiceFor,
  DataFolderError,
  gitRepositoryAround,
  isInside,
  LOCK_FILE,
  LOCK_REFRESH_MS,
  LOCK_STALE_MS,
  prepareDataFolder,
  refreshLock,
  resolveDataFolder,
  type FolderEnvironment,
} from './folder.ts';

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'stylecode-folder-'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const environment = (env: Record<string, string> = {}, platform: NodeJS.Platform = process.platform): FolderEnvironment => ({
  env,
  home: join(base, 'home'),
  platform,
});

describe('which folder holds client data', () => {
  it('uses StyleCode Data for npm start and a separate folder for development', () => {
    expect(resolveDataFolder('start', environment())).toBe(join(base, 'home', 'StyleCode Data'));
    expect(resolveDataFolder('development', environment())).toBe(join(base, 'home', 'StyleCode Data (development)'));
  });

  it('uses STYLECODE_WORKSPACE when it is set', () => {
    const chosen = join(base, 'elsewhere');
    expect(resolveDataFolder('start', environment({ STYLECODE_WORKSPACE: chosen }))).toBe(chosen);
    expect(resolveDataFolder('start', environment({ STYLECODE_WORKSPACE: '  ' }))).toBe(join(base, 'home', 'StyleCode Data'));
  });

  it('creates the folder and its companies folder', () => {
    const folder = prepareDataFolder('start', join(base, 'repo'), environment());
    expect(folder).toEqual({ path: join(base, 'home', 'StyleCode Data'), mode: 'start', cloudService: null });
    expect(existsSync(join(folder.path, 'companies'))).toBe(true);
  });
});

describe('client data is never inside a git repository', () => {
  it('refuses a folder inside the StyleCode repository, even before it has a .git folder', () => {
    const repo = join(base, 'repo');
    mkdirSync(repo);
    const env = environment({ STYLECODE_WORKSPACE: join(repo, 'data') });
    expect(() => prepareDataFolder('start', repo, env)).toThrow(DataFolderError);
    expect(() => prepareDataFolder('start', repo, env)).toThrow(/inside the StyleCode repository/);
    expect(existsSync(join(repo, 'data'))).toBe(false);
  });

  it('refuses a folder inside any git repository, with the reason, and creates nothing', () => {
    const other = join(base, 'projects', 'other');
    mkdirSync(join(other, '.git'), { recursive: true });
    const env = environment({ STYLECODE_WORKSPACE: join(other, 'deep', 'StyleCode Data') });
    expect(() => prepareDataFolder('start', join(base, 'repo'), env)).toThrow(`inside a git repository (${other})`);
    expect(existsSync(join(other, 'deep'))).toBe(false);
  });

  it('finds a repository marked by a .git file too (worktrees and submodules)', () => {
    const worktree = join(base, 'worktree');
    mkdirSync(join(worktree, 'inner'), { recursive: true });
    // In a worktree, .git is a file pointing at the real repository; its presence is enough.
    writeFileSync(join(worktree, '.git'), 'gitdir: ../repo/.git/worktrees/x');
    expect(gitRepositoryAround(join(worktree, 'inner', 'data'))).toBe(worktree);
    expect(gitRepositoryAround(join(base, 'plain'))).toBeNull();
  });

  it('compares paths ignoring case on Windows and macOS', () => {
    expect(isInside(join(base, 'Repo', 'data'), join(base, 'repo'), 'win32')).toBe(true);
    expect(isInside(join(base, 'Repo', 'data'), join(base, 'repo'), 'linux')).toBe(false);
    expect(isInside(join(base, 'a', 'b'), join(base, 'a'))).toBe(true);
    expect(isInside(join(base, 'ab'), join(base, 'a'))).toBe(false);
  });
});

describe('the refusal message', () => {
  it("doesn't suggest the default folder when the default is the one refused", () => {
    mkdirSync(join(base, 'home', '.git'), { recursive: true });
    let message = '';
    try {
      prepareDataFolder('start', join(base, 'repo'), environment());
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/inside a git repository/);
    expect(message).not.toMatch(/use the default/);
  });
});

describe('cloud-synced folders get a warning', () => {
  it('spots OneDrive from its environment variables on Windows', () => {
    const oneDrive = join(base, 'home', 'OneDrive - Harbour Bakery');
    const env = environment({ OneDriveCommercial: oneDrive, STYLECODE_WORKSPACE: join(oneDrive, 'Clients') });
    expect(cloudServiceFor(join(oneDrive, 'Clients'), env)).toBe('OneDrive');
    const custom = join(base, 'Sync');
    expect(cloudServiceFor(join(custom, 'StyleCode Data'), environment({ OneDrive: custom }))).toBe('OneDrive');
    expect(cloudServiceFor(join(custom, 'StyleCode Data'), environment({ OneDriveConsumer: custom }))).toBe('OneDrive');
  });

  it('spots Dropbox, Google Drive and iCloud Drive by their usual folders', () => {
    const home = join(base, 'home');
    const cases: [string, string][] = [
      [join(home, 'OneDrive', 'StyleCode Data'), 'OneDrive'],
      [join(home, 'Dropbox', 'StyleCode Data'), 'Dropbox'],
      [join(home, 'Dropbox (Personal)', 'StyleCode Data'), 'Dropbox'],
      [join(home, 'Google Drive', 'StyleCode Data'), 'Google Drive'],
      [join('G:', 'My Drive', 'StyleCode Data'), 'Google Drive'],
      [join(home, 'iCloudDrive', 'StyleCode Data'), 'iCloud Drive'],
      [join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'StyleCode Data'), 'iCloud Drive'],
      [join(home, 'Library', 'CloudStorage', 'GoogleDrive-sam@example.com', 'My Drive', 'x'), 'Google Drive'],
      [join(home, 'Library', 'CloudStorage', 'Box-Box', 'x'), 'a cloud service'],
    ];
    for (const [path, service] of cases) expect(cloudServiceFor(path, environment()), path).toBe(service);
    expect(cloudServiceFor(join(home, 'StyleCode Data'), environment())).toBeNull();
    expect(cloudServiceFor(join(home, 'Documents', 'Dropboxes'), environment())).toBeNull();
  });

  it('reports the service when preparing the folder, and still uses it', () => {
    const env = environment({ STYLECODE_WORKSPACE: join(base, 'home', 'Dropbox', 'StyleCode Data') });
    expect(prepareDataFolder('start', join(base, 'repo'), env).cloudService).toBe('Dropbox');
  });
});

describe('one StyleCode per data folder', () => {
  const lockOf = (folder: string) =>
    JSON.parse(readFileSync(join(folder, LOCK_FILE), 'utf8')) as { pid: number; startedAt: string; refreshedAt: string };
  const T = Date.parse('2026-11-10T09:00:00.000Z');

  it('refuses a second server while the first is running, and takes over a lock left by one that stopped', () => {
    const folder = join(base, 'data');
    mkdirSync(folder);
    const alive = new Set([111]);
    const running = (pid: number) => alive.has(pid);
    claimDataFolder(folder, { pid: 111, running });
    expect(() => claimDataFolder(folder, { pid: 222, running })).toThrow(/already running .*process 111/);
    // The same process again (the dev server restarting) keeps it.
    expect(() => claimDataFolder(folder, { pid: 111, running })).not.toThrow();
    alive.delete(111);
    claimDataFolder(folder, { pid: 222, running });
    expect(lockOf(folder).pid).toBe(222);
  });

  it('takes over a lock written before the computer last started, even if its process number is in use now', () => {
    const folder = join(base, 'data');
    mkdirSync(folder);
    const bootedAt = Date.parse('2026-11-05T08:00:00.000Z');
    const now = Date.parse('2026-11-05T08:01:00.000Z');
    writeFileSync(
      join(folder, LOCK_FILE),
      JSON.stringify({ pid: 111, startedAt: '2026-11-05T07:59:30.000Z', refreshedAt: '2026-11-05T07:59:30.000Z' }),
    );
    claimDataFolder(folder, { pid: 222, running: () => true, bootedAt, now });
    expect(lockOf(folder).pid).toBe(222);
    // One written since then still counts while its process runs.
    expect(() => claimDataFolder(folder, { pid: 333, running: () => true, bootedAt, now })).toThrow(
      /already running .*process 222/,
    );
  });

  it('takes over a lock not refreshed for 2 minutes, even if its process number is in use now', () => {
    const folder = join(base, 'data');
    mkdirSync(folder);
    claimDataFolder(folder, { pid: 111, now: T });
    const inUse = () => true; // Windows reused the number, perhaps for another Node program.
    expect(() => claimDataFolder(folder, { pid: 222, running: inUse, bootedAt: 0, now: T + LOCK_STALE_MS })).toThrow(
      /already running .*process 111.*try again in 2 minutes/,
    );
    claimDataFolder(folder, { pid: 222, running: inUse, bootedAt: 0, now: T + LOCK_STALE_MS + 1 });
    expect(lockOf(folder).pid).toBe(222);
  });

  it('keeps a lock that is refreshed, whatever its age', () => {
    const folder = join(base, 'data');
    mkdirSync(folder);
    claimDataFolder(folder, { pid: 111, now: T });
    for (let t = T; t <= T + 10 * LOCK_STALE_MS; t += LOCK_REFRESH_MS) expect(refreshLock(folder, 111, t)).toBe(true);
    const last = T + 10 * LOCK_STALE_MS;
    expect(lockOf(folder)).toEqual({
      pid: 111,
      startedAt: new Date(T).toISOString(),
      refreshedAt: new Date(last).toISOString(),
    });
    expect(() => claimDataFolder(folder, { pid: 222, running: () => true, bootedAt: 0, now: last + LOCK_REFRESH_MS })).toThrow(
      /process 111/,
    );
    expect(readdirSync(folder)).toEqual([LOCK_FILE]); // No temporary file left behind.
  });

  it('stops refreshing a lock another StyleCode has taken over, and leaves it alone', () => {
    const folder = join(base, 'data');
    mkdirSync(folder);
    claimDataFolder(folder, { pid: 111, now: T });
    claimDataFolder(folder, { pid: 222, running: () => true, bootedAt: 0, now: T + LOCK_STALE_MS + 1 });
    const taken = readFileSync(join(folder, LOCK_FILE), 'utf8');
    expect(refreshLock(folder, 111, T + LOCK_STALE_MS + 2)).toBe(false);
    expect(readFileSync(join(folder, LOCK_FILE), 'utf8')).toBe(taken);
  });

  it('takes over a lock from before the refresh existed once its start is 2 minutes old', () => {
    const folder = join(base, 'data');
    mkdirSync(folder);
    writeFileSync(join(folder, LOCK_FILE), JSON.stringify({ pid: 111, startedAt: new Date(T).toISOString() }));
    const options = { running: () => true, bootedAt: 0 };
    expect(() => claimDataFolder(folder, { ...options, pid: 222, now: T + 60_000 })).toThrow(/process 111/);
    claimDataFolder(folder, { ...options, pid: 222, now: T + LOCK_STALE_MS + 1 });
    expect(lockOf(folder).pid).toBe(222);
  });

  it('waits for a lock file it cannot read while it is recent, then takes it over', () => {
    const folder = join(base, 'data');
    mkdirSync(folder);
    const lock = join(folder, LOCK_FILE);
    writeFileSync(lock, 'not json');
    const changed = statSync(lock).mtimeMs;
    expect(() => claimDataFolder(folder, { pid: 333, running: () => true, now: changed + 1000 })).toThrow(
      /already running with the data folder .*\. Use the window/,
    );
    claimDataFolder(folder, { pid: 333, running: () => true, now: changed + LOCK_STALE_MS + 1 });
    expect(lockOf(folder).pid).toBe(333);
  });

  it('this process rewrites its lock every 30 seconds', () => {
    vi.useFakeTimers({ now: T });
    try {
      const folder = join(base, 'data');
      mkdirSync(folder);
      claimDataFolder(folder);
      vi.advanceTimersByTime(LOCK_REFRESH_MS);
      expect(lockOf(folder)).toMatchObject({ pid: process.pid, refreshedAt: new Date(T + LOCK_REFRESH_MS).toISOString() });
      vi.advanceTimersByTime(LOCK_REFRESH_MS);
      expect(lockOf(folder).refreshedAt).toBe(new Date(T + 2 * LOCK_REFRESH_MS).toISOString());
      rmSync(join(folder, LOCK_FILE)); // Taken over, or gone: the refresh stops and writes nothing.
      vi.advanceTimersByTime(LOCK_REFRESH_MS);
      expect(existsSync(join(folder, LOCK_FILE))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A real StyleCode process: claims `folder` (twice, as a dev-server restart
 * does), reports how many SIGINT listeners it has, then waits to be stopped.
 */
function lockingProcess(folder: string) {
  const module = pathToFileURL(join(import.meta.dirname, 'folder.ts')).href;
  const script = `
    const { claimDataFolder } = await import(${JSON.stringify(module)});
    claimDataFolder(process.argv[1]);
    await import(${JSON.stringify(module)} + '?again');
    claimDataFolder(process.argv[1]);
    console.log('ready ' + process.listenerCount('SIGINT'));
    setInterval(() => {}, 1000);
  `;
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script, folder],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const ready = new Promise<number>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      const match = /ready (\d+)/.exec(chunk.toString());
      if (match) resolve(Number(match[1]));
    });
    child.once('exit', (code) => reject(new Error(`exited early (${code})`)));
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, ready, exited };
}

describe('the lock is released when StyleCode stops', () => {
  it('registers its signal handlers once, however often the folder is claimed', async () => {
    const folder = join(base, 'data');
    mkdirSync(folder);
    const { child, ready, exited } = lockingProcess(folder);
    expect(await ready).toBe(1);
    expect(existsSync(join(folder, LOCK_FILE))).toBe(true);
    child.kill();
    await exited;
  });

  // On Windows, kill() ends a process without running its signal handlers, so this runs in CI on Linux.
  it.skipIf(process.platform === 'win32')('removes the lock on Ctrl+C (SIGINT)', async () => {
    const folder = join(base, 'data');
    mkdirSync(folder);
    const { child, ready, exited } = lockingProcess(folder);
    await ready;
    child.kill('SIGINT');
    expect(await exited).toBe(130);
    expect(existsSync(join(folder, LOCK_FILE))).toBe(false);
  });
});
