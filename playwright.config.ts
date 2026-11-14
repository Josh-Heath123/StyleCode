import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

import { fakeMicrophoneWav } from './e2e/fakeMicrophone';
import { E2E_WORKSPACE } from './e2e/workspacePath';

/**
 * End-to-end tests drive the real editor in Chromium. They start their own dev
 * server on port 5174 (or reuse one already running there). Its AI settings
 * and its workspace data folder live in temporary places, so the tests never
 * touch your own.
 *
 * First run: `npx playwright install chromium` downloads the browser once.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    // Returning visitors: the welcome screen and checklist have been seen (onboarding has its own test).
    storageState: 'e2e/storage-state.json',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    // Checks the server's data folder before anything else runs (e2e/workspace-folder.setup.ts).
    { name: 'workspace folder', testMatch: /\.setup\.ts$/ },
    {
      name: 'chromium',
      dependencies: ['workspace folder'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // A fake microphone playing a generated tone (Phase 3): recording is tested without a real one, or real voices.
        permissions: ['microphone'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${fakeMicrophoneWav()}`,
          ],
        },
      },
    },
  ],
  webServer: {
    // The test data folder is emptied first, lock included (e2e/clearTestWorkspace.ts).
    command:
      'node --experimental-strip-types --disable-warning=ExperimentalWarning e2e/clearTestWorkspace.ts && npm run dev -- --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      STYLECODE_AI_CONFIG: join(tmpdir(), 'stylecode-e2e', 'ai.json'),
      STYLECODE_WORKSPACE: E2E_WORKSPACE,
      // The fake transcription engine, replaying recorded output: no engine and no network in tests (Phase 3).
      STYLECODE_TRANSCRIPTION_FAKE: '1',
      STYLECODE_TRANSCRIPTION_SETTINGS: join(tmpdir(), 'stylecode-e2e', 'transcription.json'),
    },
  },
});
