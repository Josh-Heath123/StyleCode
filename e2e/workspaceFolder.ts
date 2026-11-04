import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The browser tests' workspace data folder: a temporary one, never the
 * consultant's own. `playwright.config.ts` gives it to the dev server, and the
 * workspace tests refuse to run if the server reports any other folder.
 */
export const E2E_WORKSPACE = join(tmpdir(), 'stylecode-e2e', 'workspace');
