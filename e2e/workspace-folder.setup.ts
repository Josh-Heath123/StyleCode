import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test as setup } from '@playwright/test';
import { E2E_WORKSPACE, requireTestWorkspace } from './workspaceFolder';

/**
 * Runs before every browser test (the `chromium` project depends on it, in
 * playwright.config.ts), so no test file can forget it: if the server's data
 * folder isn't the temporary test folder, nothing runs. A dev server already
 * running on port 5174 with real data would otherwise have clients created
 * and changed in it.
 */
setup('the server keeps client data in the temporary test folder', async ({ request }) => {
  await requireTestWorkspace(request);
  // Each run starts with no clients. Otherwise the folder grows with every run, and creating a
  // client, which reads every client to keep names unique, gets slower each time.
  const companies = join(E2E_WORKSPACE, 'companies');
  for (const name of readdirSync(companies)) rmSync(join(companies, name), { recursive: true, force: true, maxRetries: 5 });
});
