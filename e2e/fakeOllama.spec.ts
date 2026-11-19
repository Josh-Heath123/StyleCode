import http from 'node:http';
import { expect, test } from '@playwright/test';
import { FAKE_MODEL, startFakeOllama } from './fakeOllama';

/**
 * The fake model server itself, without a page: a chat request whose body is
 * cut off, or that is still arriving when the fake closes, is let go without
 * an error. Thrown from its async handler, the error would be unhandled, and
 * Playwright would fail whichever test the worker was running then.
 */
const body = (content: string) => JSON.stringify({ model: FAKE_MODEL, messages: [{ role: 'user', content }] });

/** Sends the first `sent` bytes of a body that says it is longer, and leaves the request open. */
function startChat(url: string, whole: string, sent: number): http.ClientRequest {
  const req = http.request(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(whole) },
  });
  req.on('error', () => {}); // The fake hangs up: expected here.
  req.write(whole.slice(0, sent));
  return req;
}

const until = (condition: () => boolean) => expect.poll(condition, { timeout: 2000 }).toBe(true);

let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
test.beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});
test.afterEach(async () => {
  // Rejections are reported a moment after they happen.
  await new Promise((resolve) => setTimeout(resolve, 200));
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled.map((e) => String((e as Error)?.message ?? e))).toEqual([]);
});

test('a chat request still arriving when the fake closes is let go without an error', async () => {
  const fake = await startFakeOllama();
  const whole = body('a'.repeat(200_000));
  const req = startChat(fake.url, whole, 100_000); // More than one 64 KiB chunk, not all of it.
  await new Promise((resolve) => setTimeout(resolve, 200));
  await fake.close();
  await until(() => req.destroyed);
  expect(fake.requests).toEqual([]);
});

test('a chat request whose caller goes away mid-body is let go, and the fake goes on answering', async () => {
  const fake = await startFakeOllama();
  const req = startChat(fake.url, body('b'.repeat(200_000)), 70_000);
  await new Promise((resolve) => setTimeout(resolve, 200));
  req.destroy();
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(fake.requests).toEqual([]);

  const reply = await fetch(`${fake.url}/api/chat`, { method: 'POST', body: body('make it dark') });
  expect(reply.status).toBe(200);
  expect(await reply.text()).toContain('"done":true');
  expect(fake.requests).toHaveLength(1);
  await fake.close();
});

test('a chat body that isn’t JSON gets a 400, and a long one split across chunks arrives whole', async () => {
  const fake = await startFakeOllama();
  const bad = await fetch(`${fake.url}/api/chat`, { method: 'POST', body: '{"model": "x", "messages": [' });
  expect(bad.status).toBe(400);
  // Over 64 KiB, with characters of more than one byte where the chunks may split them.
  const content = 'é…’'.repeat(40_000);
  const good = await fetch(`${fake.url}/api/chat`, { method: 'POST', body: body(content) });
  expect(good.status).toBe(200);
  await good.text();
  expect(fake.requests).toHaveLength(1);
  expect(fake.requests[0].messages[0].content).toBe(content);
  await fake.close();
});
