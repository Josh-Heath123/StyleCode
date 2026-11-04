import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyUpdate, ConfigError, loadConfig, publicConfig, saveConfig, DEFAULT_CONFIG } from './config.ts';
import { AI_HEADER, createAiHandler, rejectReason } from './handler.ts';

/** A recorded request to a fake provider. */
interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown> | null;
}

type Responder = (seen: Seen, res: ServerResponse) => void;

/** A fake provider: records requests and answers with whatever the test sets up. */
class FakeProvider {
  readonly seen: Seen[] = [];
  respond: Responder = (_s, res) => res.end();
  private server: Server | null = null;
  url = '';

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const seen = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : null };
      this.seen.push(seen);
      this.respond(seen, res);
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server!.close(() => resolve()));
  }
}

/** Writes a reply in small pieces, as a model streams it. */
function pieces(text: string, size = 7): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const REPLY = JSON.stringify({
  explanation: 'Made the card feel more premium.',
  operations: [{ op: 'update', id: 'e2', set: { radius: 20, shadowColor: '#00000033' } }],
});

let configFile = '';
let app: Server;
let appUrl = '';
const fake = new FakeProvider();

beforeAll(async () => {
  await fake.start();
  const handler = createAiHandler({ path: () => configFile });
  app = createServer((req, res) => {
    if (!req.url?.startsWith('/api/ai')) return void res.end('not ai');
    req.url = req.url.slice('/api/ai'.length) || '/';
    void handler(req, res, () => {
      res.statusCode = 404;
      res.end('next');
    });
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  appUrl = `http://localhost:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await fake.stop();
  await new Promise<void>((resolve) => app.close(() => resolve()));
});

beforeEach(() => {
  configFile = join(mkdtempSync(join(tmpdir(), 'stylecode-ai-')), 'ai.json');
  fake.seen.length = 0;
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${appUrl}/api/ai${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [AI_HEADER]: '1', ...(init.headers as Record<string, string>) },
  });

async function configure(update: Record<string, unknown>) {
  const res = await call('/config', { method: 'PUT', body: JSON.stringify(update) });
  expect(res.status).toBe(200);
  return res.json();
}

/** The reply of /chat, reassembled from its NDJSON lines. */
async function chat(body: Record<string, unknown> = {}) {
  const res = await call('/chat', {
    method: 'POST',
    body: JSON.stringify({
      system: 'Be helpful.',
      messages: [{ role: 'user', content: 'Make it premium' }],
      schema: { type: 'object' },
      ...body,
    }),
  });
  const text = await res.text();
  const lines = res.headers.get('content-type')?.includes('ndjson')
    ? text
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : [];
  return { status: res.status, text, lines, reply: lines.map((l) => l.delta ?? '').join('') };
}

describe('settings', () => {
  it('starts with AI off and never returns keys', async () => {
    const config = await (await call('/config')).json();
    expect(config.provider).toBe('off');
    const saved = await configure({ provider: 'openai', providers: { openai: { apiKey: 'sk-secret-123', model: 'gpt-x' } } });
    expect(JSON.stringify(saved)).not.toContain('sk-secret');
    expect(saved.providers.openai).toMatchObject({ hasKey: true, keySource: 'file', model: 'gpt-x' });
    // Kept on this computer, readable only by the user.
    expect(readFileSync(configFile, 'utf8')).toContain('sk-secret-123');
    if (process.platform !== 'win32') expect(statSync(configFile).mode & 0o777).toBe(0o600);
    // Leaving the key out keeps it; null removes it.
    expect((await configure({ providers: { openai: { model: 'gpt-y' } } })).providers.openai.hasKey).toBe(true);
    expect((await configure({ providers: { openai: { apiKey: null } } })).providers.openai.hasKey).toBe(false);
  });

  it('uses a key from the environment and rejects odd addresses', async () => {
    process.env.OPENAI_API_KEY = 'sk-env';
    expect(publicConfig(DEFAULT_CONFIG, 'x').providers.openai).toMatchObject({ hasKey: true, keySource: 'environment' });
    for (const baseUrl of ['file:///etc/passwd', 'openrouter.ai/api/v1', 'https://user:pass@example.com/v1']) {
      expect(() => applyUpdate(DEFAULT_CONFIG, { providers: { openai: { baseUrl } } })).toThrow(ConfigError);
    }
    const res = await call('/config', {
      method: 'PUT',
      body: JSON.stringify({ providers: { openai: { baseUrl: 'localhost:1234/v1' } } }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('starting with http:// or https://');
    const missing = join(mkdtempSync(join(tmpdir(), 'stylecode-ai-')), 'ai.json');
    expect((await loadConfig(missing)).provider).toBe('off');
  });

  it('only sends a saved key to the address it was saved with', async () => {
    const saved = await configure({ providers: { openai: { baseUrl: fake.url, apiKey: 'sk-saved', model: 'm' } } });
    expect(saved.providers.openai.hasKey).toBe(true);
    // Trying another address in the dialog: the saved key stays home.
    fake.respond = (_s, res) => res.end(JSON.stringify({ data: [{ id: 'x' }] }));
    const other = fake.url.replace('127.0.0.1', 'localhost');
    await call('/models', { method: 'POST', body: JSON.stringify({ provider: 'openai', settings: { baseUrl: other } }) });
    expect(fake.seen.at(-1)!.headers.authorization).toBeUndefined();
    await call('/models', { method: 'POST', body: JSON.stringify({ provider: 'openai', settings: {} }) });
    expect(fake.seen.at(-1)!.headers.authorization).toBe('Bearer sk-saved');
    // Saving a new address without a new key drops the old key.
    expect((await configure({ providers: { openai: { model: 'n' } } })).providers.openai.hasKey).toBe(true);
    expect((await configure({ providers: { openai: { baseUrl: other } } })).providers.openai.hasKey).toBe(false);
  });

  it('saves one change at a time, never leaving a half-written file', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => saveConfig({ ...DEFAULT_CONFIG, provider: i % 2 ? 'ollama' : 'openai' }, configFile)),
    );
    expect((await loadConfig(configFile)).provider).toBe('ollama');
    expect(readdirSync(join(configFile, '..'))).toEqual(['ai.json']);
    // Changes to different settings at the same moment both stick.
    await Promise.all([
      configure({ providers: { ollama: { model: 'from-one' } } }),
      configure({ providers: { openai: { model: 'from-two' } } }),
      configure({ providers: { anthropic: { model: 'from-three' } } }),
    ]);
    const merged = (await loadConfig(configFile)).providers;
    expect([merged.ollama.model, merged.openai.model, merged.anthropic.model]).toEqual(['from-one', 'from-two', 'from-three']);
  });
});

describe('who may use the AI routes', () => {
  it('refuses other sites, other hosts and requests without the StyleCode header', async () => {
    expect((await call('/config', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('/config', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(`${appUrl}/api/ai/config`)).status).toBe(403);
    // fetch won't send a different Host, so ask the way a DNS-rebinding page would arrive.
    const status = await new Promise<number>((resolve) => {
      const target = new URL(appUrl);
      const req = request(
        {
          host: '127.0.0.1',
          port: target.port,
          path: '/api/ai/config',
          headers: { host: `evil.example:${target.port}`, [AI_HEADER]: '1' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.end();
    });
    expect(status).toBe(403);
    expect((await call('/config', { headers: { origin: appUrl } })).status).toBe(200);
  });

  it('refuses connections from other computers, whatever their headers say', () => {
    const from = (remoteAddress: string) =>
      rejectReason({ socket: { remoteAddress }, headers: { host: 'localhost:5173', [AI_HEADER]: '1' } } as never);
    expect(from('192.0.2.2')).toMatch(/only available to StyleCode on this computer/);
    expect(from('::ffff:10.0.0.7')).not.toBeNull();
    expect(from('127.0.0.1')).toBeNull();
    expect(from('::1')).toBeNull();
    expect(from('::ffff:127.0.0.1')).toBeNull();
  });
});

describe('providers', () => {
  it('streams from Ollama with the schema as its format and an explicit context size', async () => {
    fake.respond = (_seen, res) => {
      res.setHeader('content-type', 'application/x-ndjson');
      for (const p of pieces(REPLY))
        res.write(`${JSON.stringify({ model: 'qwen2.5:7b', message: { role: 'assistant', content: p }, done: false })}\n`);
      res.end(
        `${JSON.stringify({ model: 'qwen2.5:7b', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' })}\n`,
      );
    };
    await configure({
      provider: 'ollama',
      providers: { ollama: { baseUrl: fake.url, model: 'qwen2.5:7b', contextSize: 16384 } },
    });
    const result = await chat({ schema: { type: 'object', properties: { explanation: { type: 'string' } } } });
    expect(result.reply).toBe(REPLY);
    expect(result.lines.at(-1)).toEqual({ done: true });
    const [request] = fake.seen;
    expect(request.url).toBe('/api/chat');
    expect(request.body).toMatchObject({
      model: 'qwen2.5:7b',
      stream: true,
      format: { type: 'object', properties: { explanation: { type: 'string' } } },
      options: { num_ctx: 16384 },
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Make it premium' },
      ],
    });
  });

  it('explains when Ollama isn’t running', async () => {
    await configure({ provider: 'ollama', providers: { ollama: { baseUrl: 'http://127.0.0.1:9', model: 'x' } } });
    const result = await chat();
    expect(result.status).toBe(502);
    expect(JSON.parse(result.text).error).toMatch(/Couldn’t reach Ollama at http:\/\/127\.0\.0\.1:9/);
  });

  it('streams from an OpenAI-compatible server, falling back when it can’t do JSON schemas', async () => {
    fake.respond = (seen, res) => {
      const format = (seen.body?.response_format as { type?: string } | undefined)?.type;
      if (format === 'json_schema') {
        res.statusCode = 400;
        return void res.end(JSON.stringify({ error: { message: "'response_format.type' must be 'json_object' or 'text'" } }));
      }
      res.setHeader('content-type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] })}\n\n`);
      for (const p of pieces(REPLY)) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: p } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    };
    await configure({
      provider: 'openai',
      providers: { openai: { baseUrl: fake.url, model: 'local-model', apiKey: 'sk-test' } },
    });
    const result = await chat();
    expect(result.reply).toBe(REPLY);
    expect(fake.seen.map((s) => (s.body?.response_format as { type: string }).type)).toEqual(['json_schema', 'json_object']);
    expect(fake.seen[0].url).toBe('/chat/completions');
    expect(fake.seen[0].headers.authorization).toBe('Bearer sk-test');
    expect(result.text).not.toContain('sk-test');
  });

  it('streams Anthropic tool input and sends the right headers', async () => {
    fake.respond = (_seen, res) => {
      res.setHeader('content-type', 'text/event-stream');
      const event = (name: string, data: unknown) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      event('message_start', {
        type: 'message_start',
        message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'm', stop_reason: null },
      });
      event('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'propose_changes', input: {} },
      });
      event('ping', { type: 'ping' });
      event('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '' },
      });
      for (const p of pieces(REPLY))
        event('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: p },
        });
      event('content_block_stop', { type: 'content_block_stop', index: 0 });
      event('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 80 },
      });
      event('message_stop', { type: 'message_stop' });
      res.end();
    };
    await configure({
      provider: 'anthropic',
      providers: { anthropic: { baseUrl: fake.url, model: 'claude-test', apiKey: 'sk-ant-test' } },
    });
    const result = await chat({ schema: { type: 'object' } });
    expect(result.reply).toBe(REPLY);
    const [request] = fake.seen;
    expect(request.url).toBe('/v1/messages');
    expect(request.headers['x-api-key']).toBe('sk-ant-test');
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
    expect(request.body).toMatchObject({
      model: 'claude-test',
      stream: true,
      system: 'Be helpful.',
      tools: [{ name: 'propose_changes', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'propose_changes' },
    });
  });

  it('reports a rejected key and an error in the middle of a stream', async () => {
    fake.respond = (_s, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    };
    await configure({ provider: 'anthropic', providers: { anthropic: { baseUrl: fake.url, model: 'm', apiKey: 'bad' } } });
    const rejected = await chat();
    expect(rejected.status).toBe(401);
    expect(JSON.parse(rejected.text).error).toContain('rejected the API key: invalid x-api-key');

    fake.respond = (_s, res) => {
      res.write(`${JSON.stringify({ message: { content: '{"expl' }, done: false })}\n`);
      res.end(`${JSON.stringify({ error: 'model ran out of memory' })}\n`);
    };
    await configure({ provider: 'ollama', providers: { ollama: { baseUrl: fake.url, model: 'm' } } });
    const broken = await chat();
    expect(broken.lines).toEqual([{ delta: '{"expl' }, { error: 'Ollama: model ran out of memory' }]);
  });

  it('never follows a redirect, so a key only goes where it was sent', async () => {
    const elsewhere = new FakeProvider();
    await elsewhere.start();
    try {
      fake.respond = (seen, res) => {
        res.statusCode = 307;
        res.setHeader('location', `${elsewhere.url}${seen.url}`);
        res.end();
      };
      await configure({
        provider: 'anthropic',
        providers: { anthropic: { baseUrl: fake.url, model: 'm', apiKey: 'sk-ant-secret' } },
      });
      const result = await chat();
      expect(JSON.parse(result.text).error).toMatch(/answered with a redirect/);
      expect(elsewhere.seen).toEqual([]);
    } finally {
      await elsewhere.stop();
    }
  });

  it('reports a reply that was cut off instead of passing on half of it', async () => {
    const ollamaEnd = (doneReason: string | null) => (_s: Seen, res: ServerResponse) => {
      res.write(`${JSON.stringify({ message: { content: '{"explanation": "Half' }, done: false })}\n`);
      res.end(doneReason ? `${JSON.stringify({ message: { content: '' }, done: true, done_reason: doneReason })}\n` : '');
    };
    await configure({ provider: 'ollama', providers: { ollama: { baseUrl: fake.url, model: 'm' } } });
    fake.respond = ollamaEnd('length');
    expect((await chat()).lines.at(-1).error).toMatch(/cut off before it was finished/);
    fake.respond = ollamaEnd(null);
    expect((await chat()).lines.at(-1).error).toMatch(/ended before the reply was finished/);

    fake.respond = (_s, res) => {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"expl' } }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`);
    };
    await configure({ provider: 'openai', providers: { openai: { baseUrl: fake.url, model: 'm' } } });
    expect((await chat()).lines.at(-1).error).toMatch(/cut off/);
  });

  it('switches to max_completion_tokens for models that need it', async () => {
    fake.respond = (seen, res) => {
      if ('max_tokens' in (seen.body ?? {})) {
        res.statusCode = 400;
        return void res.end(
          JSON.stringify({
            error: {
              message:
                "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
            },
          }),
        );
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: REPLY } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.end();
    };
    await configure({ provider: 'openai', providers: { openai: { baseUrl: fake.url, model: 'gpt-5-mini' } } });
    const result = await chat({ maxTokens: 3000 });
    expect(result.reply).toBe(REPLY);
    expect(fake.seen[1].body).toMatchObject({ max_completion_tokens: 3000, response_format: { type: 'json_schema' } });
    expect(fake.seen[1].body).not.toHaveProperty('temperature');
  });

  it('lists models, trying unsaved settings from the dialog', async () => {
    fake.respond = (seen, res) => {
      res.setHeader('content-type', 'application/json');
      if (seen.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5:7b' }] }));
      else res.end(JSON.stringify({ object: 'list', data: [{ id: 'b-model' }, { id: 'a-model' }] }));
    };
    const ollama = await call('/models', {
      method: 'POST',
      body: JSON.stringify({ provider: 'ollama', settings: { baseUrl: fake.url } }),
    });
    expect(await ollama.json()).toEqual({ models: ['llama3.2:3b', 'qwen2.5:7b'] });
    const openai = await call('/models', {
      method: 'POST',
      body: JSON.stringify({ provider: 'openai', settings: { baseUrl: fake.url, apiKey: 'sk-unsaved' } }),
    });
    expect(await openai.json()).toEqual({ models: ['a-model', 'b-model'] });
    expect(fake.seen[1].headers.authorization).toBe('Bearer sk-unsaved');
    // Trying a key doesn't save it.
    expect((await (await call('/config')).json()).providers.openai.hasKey).toBe(false);
  });
});
