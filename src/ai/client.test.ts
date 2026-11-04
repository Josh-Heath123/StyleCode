import { afterEach, describe, expect, it, vi } from 'vitest';
import { chat } from './client';

/**
 * Stands in for the local server: streams the given lines and then, if
 * `hang`, sends nothing more. Like the real fetch, aborting ends the body.
 */
function mockServer(lines: string[], hang: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
          if (!hang) controller.close();
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }),
  );
}

const input = { system: 's', messages: [{ role: 'user' as const, content: 'hi' }], schema: {} };

afterEach(() => vi.unstubAllGlobals());

describe('chat', () => {
  it('returns the streamed reply', async () => {
    mockServer([JSON.stringify({ delta: 'Hel' }), JSON.stringify({ delta: 'lo' }), '{"done":true}'], false);
    const seen: string[] = [];
    await expect(chat(input, (t) => seen.push(t), new AbortController().signal)).resolves.toBe('Hello');
    expect(seen).toEqual(['Hel', 'Hello']);
  });

  it('gives up on a reply that goes quiet, and says so', async () => {
    mockServer([JSON.stringify({ delta: 'Thinking' })], true);
    await expect(chat(input, () => {}, new AbortController().signal, 50)).rejects.toThrow(/The model stopped responding/);
  });

  it('treats the caller stopping it as a cancel, not a stall', async () => {
    mockServer([], true);
    const controller = new AbortController();
    const reply = chat(input, () => {}, controller.signal, 10_000);
    setTimeout(() => controller.abort(), 20);
    await expect(reply).rejects.toMatchObject({ name: 'AbortError' });
  });
});
