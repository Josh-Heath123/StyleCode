import { expect, type APIRequestContext } from '@playwright/test';
import { E2E_WORKSPACE } from './workspacePath';

export { E2E_WORKSPACE };

/**
 * The setup project (workspace-folder.setup.ts) calls this before any test: it stops
 * the test unless the server's data folder is the temporary test folder (a
 * dev server already running on port 5174 with real data, say).
 */
export async function requireTestWorkspace(request: APIRequestContext): Promise<void> {
  const info = await request.get('/api/workspace/info', { headers: { 'x-stylecode-workspace': '1' } });
  expect(info.ok(), 'the workspace API answers').toBe(true);
  const { folder } = (await info.json()) as { folder: string };
  if (folder !== E2E_WORKSPACE) {
    throw new Error(`Refusing to run: the server's workspace folder is ${folder}, not the test folder ${E2E_WORKSPACE}.`);
  }
}
