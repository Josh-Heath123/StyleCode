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

export type FakeReply = { text: string; delay: number } | { status: number; error: string };

/**
 * Asked for findings (the workspace's extraction prompt), it answers like a
 * small model: one finding for each passage a client said, or note, with six
 * words or more, quoting its first five words, plus one whose quote isn't in
 * the passage, which StyleCode must drop. A meeting titled with "slow" streams
 * slowly (to test Stop), with "steady" takes a few seconds a part, and with
 * "fail" the model server returns an error. With "part two" in the title too,
 * "slow" and "fail" start from the second part.
 */
function extractionReply(body: FakeOllama['requests'][number]): FakeReply | null {
  if (!body.messages[0]?.content.includes('list the findings a careful consultant would record')) return null;
  const message = body.messages[body.messages.length - 1].content;
  const title = /^Meeting: (.*)$/m.exec(message)?.[1]?.toLowerCase() ?? '';
  const part = Number(/This is part (\d+) of/.exec(message)?.[1] ?? 1);
  const from = (word: string) => title.includes(word) && (!title.includes('part two') || part >= 2);
  if (from('fail')) return { status: 500, error: 'model runner has unexpectedly stopped' };
  const own = message.includes('New passages:') ? message.slice(message.indexOf('New passages:')) : message;
  const findings: unknown[] = [];
  for (const m of own.matchAll(/^\[([SN]\d+)\] (?:([^:\n]+?) \(client\): |Note: )?(.*)$/gm)) {
    const [, ref, client, text] = m;
    const speaker = client ?? (ref.startsWith('N') ? 'The note' : null);
    const words = text.split(/\s+/);
    if (!speaker || words.length < 6) continue;
    findings.push({
      kind: 'operational-challenge',
      status: 'suggested',
      statement: `${speaker} said: ${words.slice(0, 8).join(' ')}`,
      evidence: [{ ref, quote: words.slice(0, 5).join(' ') }],
    });
  }
  if (findings.length)
    findings.push({
      kind: 'risk',
      status: 'suggested',
      statement: 'Made up.',
      evidence: [{ ref: 'S1', quote: 'words nobody ever said here' }],
    });
  return { text: JSON.stringify({ findings }), delay: from('slow') ? 400 : title.includes('steady') ? 25 : 2 };
}

function reply(body: FakeOllama['requests'][number]): FakeReply {
  const extraction = extractionReply(body);
  if (extraction) return extraction;
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

/**
 * Starts the fake. The demo recordings pass their own scripted `respond` and
 * model name; the tests use the defaults above.
 */
export async function startFakeOllama(
  options: { respond?: (body: FakeOllama['requests'][number]) => FakeReply; models?: string[] } = {},
): Promise<FakeOllama> {
  const requests: FakeOllama['requests'] = [];
  const respond = options.respond ?? reply;
  const models = options.models ?? [FAKE_MODEL, 'other-model:3b'];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      const answer = respond(body);
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
