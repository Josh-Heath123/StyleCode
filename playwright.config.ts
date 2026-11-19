import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

import { fakeMicrophoneWav } from './e2e/fakeMicrophone';
import { E2E_GPU_TEMPERATURE, E2E_WORKSPACE } from './e2e/workspacePath';

/**
 * End-to-end tests drive the real editor in Chromium. They start their own dev
 * server on port 5174 (or reuse one already running there). Its AI settings
 * and its workspace data folder live in temporary places, so the tests never
 * touch your own.
 *
 * First run: `npx playwright install chromium` downloads the browser once.
 */
/** The browser every test uses: Chromium, with a fake microphone playing a generated tone (Phase 3), so recording is tested without a real one, or real voices. */
const BROWSER = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1440, height: 900 },
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${fakeMicrophoneWav()}`,
    ],
  },
};

/** Tests that start heavy jobs: AI runs on a local model, and transcriptions. */
const HEAVY = /(extraction|transcription)\.spec\.ts$/;
/**
 * Tests that run after the rest, one at a time: those whose actions cover every client in the test folder (the
 * recordings past their time), and those that read back the folder's one settings file, which most tests set.
 */
const LAST = /(retention|settings)\.spec\.ts$/;
/**
 * On CI, the tests that run last get a runner, a server and a data folder of their own (E2E_DESTRUCTIVE_ALONE=1).
 * No other test shares their folder, so they needn't wait for the rest. Locally they still run after everything else.
 */
const LAST_ALONE = process.env.E2E_DESTRUCTIVE_ALONE === '1';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // A test that passes only on its retry still fails the run: a retry mustn't turn a race into a green tick.
  failOnFlakyTests: !!process.env.CI,
  // CI splits the tests across runners. Each keeps a blob report, and they're merged into one HTML report afterwards.
  reporter: process.env.CI ? [['blob'], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5174',
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
      testIgnore: [HEAVY, LAST],
      use: BROWSER,
    },
    // AI runs and transcriptions take turns on this computer (Phase 3, decision 10), so the tests that start them
    // would wait for each other's; they run one at a time, alongside the rest.
    { name: 'heavy jobs', dependencies: ['workspace folder'], testMatch: HEAVY, workers: 1, use: BROWSER },
    // Deleting every client's recordings past their time would reach into other tests' clients, and the consultant's
    // name is one setting most tests set, so these come last, unless they have a folder to themselves.
    {
      name: 'after the rest',
      dependencies: LAST_ALONE ? ['workspace folder'] : ['chromium', 'heavy jobs'],
      testMatch: LAST,
      workers: 1,
      use: BROWSER,
    },
  ],
  webServer: {
    // The test data folder is emptied first, lock included (e2e/clearTestWorkspace.ts).
    command:
      'node --experimental-strip-types --disable-warning=ExperimentalWarning e2e/clearTestWorkspace.ts && npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // On CI, the dev server's own output is in the log too: when it optimizes dependencies again, reloads the pages
    // or restarts, a test failing at that moment can be explained. Locally it would only crowd the list.
    stdout: process.env.CI ? 'pipe' : 'ignore',
    env: {
      STYLECODE_AI_CONFIG: join(tmpdir(), 'stylecode-e2e', 'ai.json'),
      STYLECODE_WORKSPACE: E2E_WORKSPACE,
      // The fake transcription engine, replaying recorded output: no engine and no network in tests (Phase 3).
      STYLECODE_TRANSCRIPTION_FAKE: '1',
      // Each of the fake engine's progress steps takes a moment, so a transcription is seen going.
      FAKE_ENGINE_STEP_MS: '200',
      STYLECODE_TRANSCRIPTION_SETTINGS: join(tmpdir(), 'stylecode-e2e', 'transcription.json'),
      // A fake GPU's temperature for the cooling pause: none unless a test writes one.
      STYLECODE_FAKE_GPU_TEMPERATURE: E2E_GPU_TEMPERATURE,
    },
  },
});
