import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/**
 * The demos' own data folder. The workspace pages show their data folder's path, so it names no user and sits
 * outside every git repository (the workspace server refuses one inside a repository): `C:\StyleCode Demo Data` on
 * Windows. Elsewhere it's in the temporary folder. `STYLECODE_DEMO_WORKSPACE` sets another; its name must still be
 * "StyleCode Demo Data", because running this file empties it.
 */
export const DEMO_WORKSPACE =
  process.env.STYLECODE_DEMO_WORKSPACE ??
  (process.platform === 'win32' ? 'C:\\StyleCode Demo Data' : join(tmpdir(), 'StyleCode Demo Data'));

/** The demos' AI settings and transcription settings, in the temporary folder: never the consultant's own. */
export const DEMO_SETTINGS = join(tmpdir(), 'stylecode-demos');

// Run before the demos' dev server starts (demos.config.ts): only a folder with the demo folder's name is emptied.
if (process.argv[1] && basename(process.argv[1]) === 'demoWorkspace.ts') {
  if (basename(DEMO_WORKSPACE) !== 'StyleCode Demo Data') {
    console.error(`Refusing to empty ${DEMO_WORKSPACE}: it isn't the demos' data folder.`);
    process.exit(1);
  }
  rmSync(DEMO_WORKSPACE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
