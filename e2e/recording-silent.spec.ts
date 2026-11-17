import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fakeMicrophoneWav } from './fakeMicrophone';
import { kickoff } from './karoo';
import { E2E_WORKSPACE } from './workspaceFolder';

/**
 * A microphone that hears nothing (WP6 check-in, after WP8's first try): on
 * the user's laptop, Windows' default was a virtual device that passes only
 * silence, and a consultant would have recorded a silent meeting without a
 * word. Here Chromium's fake device plays a WAV of zeros. Karoo Freight is
 * role-played.
 */

// Its own browser, with the silent device instead of the tone the other tests use.
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${fakeMicrophoneWav(true)}`,
    ],
  },
});

const card = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Recordings', exact: true }) });
const MESSAGE = 'This microphone isn’t hearing anything. Check it isn’t muted, or stop and choose another in Microphone.';

test('a microphone giving only silence is said so after about 5 seconds, on the card and in the top bar, and the recording goes on', async ({
  page,
}) => {
  const id = await kickoff(page, { recording: { kind: 'days', days: 30 } });
  await card(page).getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByRole('dialog', { name: 'Start recording' }).getByRole('button', { name: 'Start recording' }).click();
  const live = card(page).getByRole('group', { name: 'Recording' });
  await expect(live).toContainText('Recording');
  // Not at once: a pause in speech isn't a muted microphone.
  await expect(live.getByRole('alert')).toHaveCount(0);
  await expect(live.getByRole('alert')).toHaveText(MESSAGE, { timeout: 15_000 });
  const clock = await live.locator('.ws-live-clock').innerText();
  expect(Number(clock.split(':')[1])).toBeGreaterThanOrEqual(5);

  // On another page too.
  await page.getByRole('link', { name: 'Dispatch app' }).first().click();
  const indicator = page.getByRole('navigation', { name: 'StyleCode' }).getByRole('group', { name: 'Recording' });
  await expect(indicator.getByRole('alert')).toHaveText(MESSAGE);

  // It warns; it doesn't stop. Stopping keeps what was recorded, and the warning goes with the recording.
  await indicator.getByRole('button', { name: 'Stop' }).click();
  await expect(indicator).toHaveCount(0);
  const ws = JSON.parse(readFileSync(join(E2E_WORKSPACE, 'companies', id, 'workspace.json'), 'utf8')) as {
    sessions: Record<string, { audioFileIds: string[] }>;
  };
  expect(ws.sessions.se_1.audioFileIds).toHaveLength(1);
});
