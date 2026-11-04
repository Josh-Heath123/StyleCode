import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cloudServiceFor,
  DataFolderError,
  gitRepositoryAround,
  isInside,
  prepareDataFolder,
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
