import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Records the demo GIFs in docs/media (`npm run demos`). Not part of the test
 * run. Needs ffmpeg on the PATH to turn the recordings into GIFs.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.demo.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  outputDir: join(tmpdir(), 'stylecode-demos'),
  use: {
    baseURL: 'http://localhost:5177',
    viewport: { width: 1280, height: 800 },
    video: { mode: 'on', size: { width: 1280, height: 800 } },
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5177',
          localStorage: [{ name: 'stylecode.onboarding', value: '{"welcomed":true,"checklistOpen":false,"done":{}}' }],
        },
      ],
    },
  },
  webServer: {
    command: 'npm run dev -- --port 5177 --strictPort',
    url: 'http://localhost:5177',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { STYLECODE_AI_CONFIG: join(tmpdir(), 'stylecode-demos', 'ai.json') },
  },
});
