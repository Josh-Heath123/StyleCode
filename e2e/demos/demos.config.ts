import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { DEMO_SETTINGS, DEMO_WORKSPACE } from './demoWorkspace';

/**
 * Records the README's pictures in docs/media (`npm run demos`): the screenshots, the GIFs, and the pages in
 * docs/brand rendered to PNG. Not part of the test run. Needs ffmpeg on the PATH to turn the recordings into GIFs.
 * The dev server keeps its data in the demos' own folder (demoWorkspace.ts), emptied first, and transcribes with the
 * fake engine, as the browser tests do.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.demo.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  outputDir: join(DEMO_SETTINGS, 'output'),
  use: {
    baseURL: 'http://127.0.0.1:5177',
    viewport: { width: 1280, height: 800 },
    video: { mode: 'on', size: { width: 1280, height: 800 } },
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://127.0.0.1:5177',
          localStorage: [{ name: 'stylecode.onboarding', value: '{"welcomed":true,"checklistOpen":false,"done":{}}' }],
        },
      ],
    },
  },
  webServer: {
    command:
      'node --experimental-strip-types --disable-warning=ExperimentalWarning demoWorkspace.ts && npm run dev -- --host 127.0.0.1 --port 5177 --strictPort',
    url: 'http://127.0.0.1:5177',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      STYLECODE_AI_CONFIG: join(DEMO_SETTINGS, 'ai.json'),
      STYLECODE_WORKSPACE: DEMO_WORKSPACE,
      STYLECODE_TRANSCRIPTION_FAKE: '1',
      STYLECODE_TRANSCRIPTION_SETTINGS: join(DEMO_SETTINGS, 'transcription.json'),
      STYLECODE_FAKE_GPU_TEMPERATURE: join(DEMO_SETTINGS, 'gpu-temperature.txt'),
    },
  },
});
