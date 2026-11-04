import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for Ollama that speaks its HTTP API (`/api/tags`, streaming
 * `/api/chat`) and answers like a small, predictable model: it reads the
 * layers marked * in the request and picks its reply from words in the
 * request. Lets the end-to-end tests run the whole AI flow, through the real
 * local server, without a model installed.
 *
 *   "dark"     → darkens the first layer it may change
 *   "button"   → adds a button (a frame with a label) inside it
 *   "broken"   → first refers to a layer that doesn't exist, then fixes it when told
 *   "nonsense" → never replies with valid JSON
 *   "remove"   → deletes everything it may change
 *   "nothing"  → proposes no changes
 *   "slow"     → streams slowly (to test Stop)
 *   "fail"     → the model server returns an error
 */

export interface FakeOllama {
  url: string;
  /** Bodies of the chat requests received, oldest first. */
  requests: { model: string; format: unknown; messages: { role: string; content: string }[]; options: Record<string, unknown> }[];
  close(): Promise<void>;
}

export const FAKE_MODEL = 'fake-designer:1b';

function reply(body: FakeOllama['requests'][number]): { text: string; delay: number } | { status: number; error: string } {
  const first = body.messages.find((m) => m.role === 'user')?.content ?? '';
  const last = body.messages[body.messages.length - 1].content;
  const request = (/\nRequest: (.*)$/s.exec(first)?.[1] ?? '').toLowerCase();
  const marked = [...first.matchAll(/^( *)\* (e\d+) (\w+)/gm)].map((m) => ({ depth: m[1].length, id: m[2], type: m[3] }));
  const target = marked[0]?.id ?? 'e1';
  const json = (explanation: string, operations: unknown[]) => JSON.stringify({ explanation, operations });
  const repairing = last.startsWith('That reply had problems');

  if (request.includes('fail')) return { status: 500, error: 'model runner has unexpectedly stopped' };
  if (request.includes('nonsense')) return { text: 'Sure! I would make it blue.', delay: 2 };
  if (request.includes('broken') && !repairing) {
    return { text: json('Made it dark.', [{ op: 'update', id: 'e999', set: { fill: '#11141a' } }]), delay: 2 };
  }
  if (request.includes('dark') || request.includes('broken')) {
    return {
      text: json('Gave it a dark background with rounded corners.', [
        { op: 'update', id: target, set: { fill: '#11141a', radius: 16 } },
      ]),
      delay: 2,
    };
  }
  if (request.includes('button')) {
    const parent = marked.find((m) => m.type === 'frame')?.id ?? target;
    return {
      text: json('Added a blue button.', [
        {
          op: 'create',
          ref: 'n1',
          parent,
          type: 'frame',
          set: {
            name: 'Button',
            layout: 'row',
            paddingTop: 10,
            paddingBottom: 10,
            paddingLeft: 16,
            paddingRight: 16,
            fill: '#2f7bff',
            radius: 8,
            widthMode: 'hug',
            heightMode: 'hug',
          },
        },
        { op: 'create', ref: 'n2', parent: 'n1', type: 'text', set: { name: 'Label', text: 'Get started', fill: '#ffffff' } },
      ]),
      delay: 2,
    };
  }
  if (request.includes('remove')) {
    // The outermost layers it may change (deleting those removes what is inside).
    const depth = Math.min(...marked.map((m) => m.depth));
    const roots = marked.filter((m) => m.depth === depth);
    return {
      text: json(
        'Removed the layers.',
        roots.map((m) => ({ op: 'delete', id: m.id })),
      ),
      delay: 2,
    };
  }
  if (request.includes('slow')) {
    return {
      text: json('Taking my time with this one, thinking it through very carefully before changing anything at all.', []),
      delay: 400,
    };
  }
  return { text: json('I can’t do that with the tools I have.', []), delay: 2 };
}

export async function startFakeOllama(): Promise<FakeOllama> {
  const requests: FakeOllama['requests'] = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: FAKE_MODEL }, { name: 'other-model:3b' }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      const answer = reply(body);
      if ('status' in answer) {
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: answer.error }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      let closed = false;
      res.on('close', () => (closed = true));
      for (let i = 0; i < answer.text.length && !closed; i += 16) {
        res.write(
          `${JSON.stringify({ model: body.model, message: { role: 'assistant', content: answer.text.slice(i, i + 16) }, done: false })}\n`,
        );
        await new Promise((r) => setTimeout(r, answer.delay));
      }
      if (!closed) res.end(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true })}\n`);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// Run on its own for trying the assistant by hand: node --experimental-strip-types e2e/fakeOllama.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  void startFakeOllama().then((fake) => console.log(`Fake Ollama at ${fake.url}`));
}
