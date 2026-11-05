import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyUpdate,
  ConfigError,
  configPath,
  loadConfig,
  PROVIDER_KINDS,
  publicConfig,
  resolveKey,
  updateConfig,
  type AiConfig,
  type ConfigUpdate,
  type ProviderKind,
  type ProviderSettings,
} from './config.ts';
import { listModels, ProviderError, streamChat, type ChatMessage, type ChatRequest } from './providers.ts';
import {
  readJson as readJsonBody,
  rejectReason as checkRequest,
  RequestError,
  sendJson,
  type RequestPolicy,
} from '../shared/requests.ts';

/**
 * The local AI routes, served by StyleCode's own dev and preview servers:
 *
 *   GET  /api/ai/config   settings without keys
 *   PUT  /api/ai/config   change settings (a key can be set or removed, never read)
 *   POST /api/ai/models   models a provider offers (also the connection check)
 *   POST /api/ai/chat     a streamed reply, as newline-delimited JSON
 *
 * They hold the user's keys and can spend money on their account, so only
 * StyleCode's own page on this computer may use them: every request passes
 * the shared checks in `server/shared/requests.ts` (loopback connection,
 * Host, exact Origin, Sec-Fetch-Site) and carries the `x-stylecode-ai`
 * header. A saved key is only ever sent to the address it was saved with.
 */

export const AI_HEADER = 'x-stylecode-ai';
const MAX_BODY = 2 * 1024 * 1024;
const POLICY: RequestPolicy = { header: AI_HEADER, feature: 'AI' };

type Next = (error?: unknown) => void;

/** Why a request isn't allowed, or null if it is (the shared checks, `server/shared/requests.ts`). */
export function rejectReason(req: IncomingMessage): string | null {
  return checkRequest(req, POLICY);
}

const send = sendJson;
const readJson = (req: IncomingMessage) => readJsonBody(req, MAX_BODY);

const isKind = (value: unknown): value is ProviderKind => PROVIDER_KINDS.includes(value as ProviderKind);

/**
 * The provider and settings a request should use: the saved ones, with
 * unsaved changes from the settings dialog (address, model) on top. A key
 * typed but not saved yet can be tried too; it is used for this request only.
 */
function settingsFor(
  config: AiConfig,
  body: Record<string, unknown>,
): { kind: ProviderKind; settings: ProviderSettings; key: string | undefined } {
  const kind = isKind(body.provider) ? body.provider : config.provider;
  if (!isKind(kind)) throw new ProviderError('AI is turned off. Choose a provider in AI settings.', 400);
  const overrides = body.settings && typeof body.settings === 'object' ? (body.settings as Record<string, unknown>) : {};
  const merged = applyUpdate(config, { providers: { [kind]: overrides } });
  const settings = merged.providers[kind];
  // A key typed for this request, or the saved one (file or environment) for the saved address only.
  const sameAddress = settings.baseUrl === config.providers[kind].baseUrl;
  const key = settings.apiKey ?? (sameAddress ? resolveKey(config, kind).key : undefined);
  return { kind, settings, key };
}

function cleanMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) throw new ProviderError('Invalid messages.', 400);
  return value.map((m) => {
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string')
      throw new ProviderError('Invalid messages.', 400);
    return { role, content };
  });
}

export function createAiHandler(options: { path?: () => string } = {}) {
  const path = options.path ?? configPath;

  return async function aiHandler(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '');
    if (!['/config', '/models', '/chat'].includes(route)) return next();

    const reason = rejectReason(req);
    if (reason) return send(res, 403, { error: reason });

    try {
      if (route === '/config' && req.method === 'GET') {
        return send(res, 200, publicConfig(await loadConfig(path()), path()));
      }
      if (route === '/config' && req.method === 'PUT') {
        const body = await readJson(req);
        return send(res, 200, publicConfig(await updateConfig(body as ConfigUpdate, path()), path()));
      }
      if (route === '/models' && req.method === 'POST') {
        const body = await readJson(req);
        const { kind, settings, key } = settingsFor(await loadConfig(path()), body);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
          return send(res, 200, { models: await listModels(kind, settings, key, controller.signal) });
        } finally {
          clearTimeout(timer);
        }
      }
      if (route === '/chat' && req.method === 'POST') {
        const body = await readJson(req);
        const { kind, settings, key } = settingsFor(await loadConfig(path()), body);
        const request: ChatRequest = {
          system: typeof body.system === 'string' ? body.system : '',
          messages: cleanMessages(body.messages),
          schema: body.schema && typeof body.schema === 'object' ? (body.schema as Record<string, unknown>) : {},
          maxTokens: typeof body.maxTokens === 'number' ? Math.min(16_000, Math.max(256, Math.round(body.maxTokens))) : 4096,
        };
        return await relay(req, res, streamChat(kind, settings, key, request, abortOnClose(req, res)));
      }
      return send(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      if (res.headersSent) return void res.end();
      const status =
        error instanceof ProviderError || error instanceof RequestError ? error.status : error instanceof ConfigError ? 400 : 500;
      if (status === 500) console.error('[stylecode ai]', error);
      // Unexpected errors can carry local paths, so the page gets a plain message.
      const message = status !== 500 && error instanceof Error ? error.message : "Something went wrong in StyleCode's AI server.";
      return send(res, status, { error: message });
    }
  };
}

/** Aborts the upstream request when the browser goes away (the user pressed Stop). */
function abortOnClose(req: IncomingMessage, res: ServerResponse): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  req.on('aborted', () => controller.abort());
  return controller.signal;
}

/**
 * Streams the reply to the browser, one JSON object per line:
 * `{"delta":"…"}` for text, then `{"done":true}` or `{"error":"…"}`.
 * The status is sent with the first piece of text, so an error before any
 * text arrives still comes back as a plain HTTP error.
 */
async function relay(_req: IncomingMessage, res: ServerResponse, stream: AsyncGenerator<string>): Promise<void> {
  const start = () => {
    if (res.headersSent) return;
    res.statusCode = 200;
    res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-accel-buffering', 'no');
  };
  try {
    for await (const delta of stream) {
      start();
      res.write(`${JSON.stringify({ delta })}\n`);
    }
    start();
    res.end(`${JSON.stringify({ done: true })}\n`);
  } catch (error) {
    if (!res.headersSent) throw error;
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    res.end(`${JSON.stringify({ error: message })}\n`);
  }
}
