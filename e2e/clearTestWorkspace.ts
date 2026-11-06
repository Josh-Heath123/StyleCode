import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { E2E_WORKSPACE } from './workspacePath.ts';

/**
 * Empties the browser tests' data folder, lock included, before Playwright
 * starts its dev server (the `webServer` command in playwright.config.ts).
 * Playwright stops that server with a forced kill, which leaves its lock
 * behind, and a later process can be given the same number. Only ever the
 * temporary test folder: anything else is refused.
 */
const inTemp = relative(tmpdir(), E2E_WORKSPACE);
if (inTemp !== join('stylecode-e2e', 'workspace')) {
  console.error(`Refusing to clear ${E2E_WORKSPACE}: it isn't the browser tests' temporary folder.`);
  process.exit(1);
}
rmSync(E2E_WORKSPACE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
