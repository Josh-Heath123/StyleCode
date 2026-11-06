import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The browser tests' workspace data folder: a temporary one, never the
 * consultant's own. `playwright.config.ts` gives it to the dev server, and
 * the setup project refuses to run the tests if the server reports any other
 * folder. Kept apart from Playwright so `clearTestWorkspace.ts` can run before
 * the dev server starts.
 */
export const E2E_WORKSPACE = join(tmpdir(), 'stylecode-e2e', 'workspace');
