import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real editor in Chromium. They start their own dev
 * server on port 5174 (or reuse one already running there). Its AI settings
 * live in a temporary file, so the tests never touch your own.
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
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npm run dev -- --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { STYLECODE_AI_CONFIG: join(tmpdir(), 'stylecode-e2e', 'ai.json') },
  },
});
