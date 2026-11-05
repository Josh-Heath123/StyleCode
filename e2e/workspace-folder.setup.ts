import { test as setup } from '@playwright/test';
import { requireTestWorkspace } from './workspaceFolder';

/**
 * Runs before every browser test (the `chromium` project depends on it, in
 * playwright.config.ts), so no test file can forget it: if the server's data
 * folder isn't the temporary test folder, nothing runs. A dev server already
 * running on port 5174 with real data would otherwise have clients created
 * and changed in it.
 */
setup('the server keeps client data in the temporary test folder', async ({ request }) => {
  await requireTestWorkspace(request);
});
