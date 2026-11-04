import type { ProviderKind, ProviderSettings } from './config.ts';

/**
 * Talking to AI providers. Each adapter turns one request into a stream of
 * text deltas: the raw JSON the model writes. The browser assembles,
 * validates and previews it; nothing here interprets the design.
 *
 * - Ollama: POST /api/chat, NDJSON stream, `format` set to the JSON schema
 *   (constrained decoding), `options.num_ctx` set explicitly so long prompts
 *   aren't silently truncated.
 * - OpenAI-compatible (OpenAI, LM Studio, llama.cpp, OpenRouter, Groq…):
 *   POST /chat/completions, server-sent events, `response_format` json_schema,
 *   falling back to json_object and then plain text for servers that don't
 *   support it.
 * - Anthropic: POST /v1/messages, server-sent events, with a single tool
 *   whose input schema is the response schema and `tool_choice` forcing it,
 *   so the input arrives as `input_json_delta` fragments.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  schema: Record<string, unknown>;
  /** Upper bound on the reply, in tokens. */
  maxTokens: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

const ANTHROPIC_VERSION = '2023-06-01';
const TOOL_NAME = 'propose_changes';

const PROVIDER_NAMES: Record<ProviderKind, string> = {
  ollama: 'Ollama',
  openai: 'the OpenAI-compatible server',
  anthropic: 'Anthropic',
};

function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

/** Turns a failed connection into something a person can act on. */
function connectionError(kind: ProviderKind, settings: ProviderSettings, error: unknown): ProviderError {
  if ((error as Error)?.name === 'AbortError') return new ProviderError('Stopped.', 499);
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  // Redirects aren't followed, so a key is only ever sent to the address the user entered.
  if (/redirect/i.test(`${cause?.message ?? ''} ${(error as Error)?.message ?? ''}`)) {
    return new ProviderError(
      `${PROVIDER_NAMES[kind][0].toUpperCase()}${PROVIDER_NAMES[kind].slice(1)} at ${settings.baseUrl} answered with a redirect. Enter the address it redirects to in AI settings.`,
    );
  }
  const code = cause?.code;
  if (kind === 'ollama') {
    return new ProviderError(
      `Couldn’t reach Ollama at ${settings.baseUrl}. Is it running? Start it with “ollama serve” or open the Ollama app.`,
    );
  }
  return new ProviderError(
    `Couldn’t reach ${PROVIDER_NAMES[kind]} at ${settings.baseUrl}${code ? ` (${code})` : ''}. Check the address and your internet connection.`,
  );
}

/** A readable message from a provider's error response. */
async function responseError(kind: ProviderKind, response: Response): Promise<ProviderError> {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as { error?: unknown; message?: unknown };
      const error = body.error as { message?: unknown } | string | undefined;
      detail =
        typeof error === 'string'
          ? error
          : typeof error?.message === 'string'
            ? error.message
            : typeof body.message === 'string'
              ? body.message
              : text;
    } catch {
      detail = text;
    }
  } catch {
    detail = '';
  }
  detail = detail.trim().slice(0, 300);
  const name = PROVIDER_NAMES[kind];
  if (response.status === 401 || response.status === 403) {
    return new ProviderError(`${name} rejected the API key${detail ? `: ${detail}` : '.'} Check it in AI settings.`, 401);
  }
  if (response.status === 404)
    return new ProviderError(`${name} couldn’t find that model or address${detail ? `: ${detail}` : '.'}`, 404);
  if (response.status === 429)
    return new ProviderError(`${name} is rate-limiting requests${detail ? `: ${detail}` : '.'} Try again shortly.`, 429);
  return new ProviderError(
    `${name} returned an error (${response.status})${detail ? `: ${detail}` : '.'}`,
    response.status >= 500 ? 502 : response.status,
  );
}

function headersFor(kind: ProviderKind, key: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (kind === 'anthropic') {
    if (key) headers['x-api-key'] = key;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
  } else if (key) {
    headers.authorization = `Bearer ${key}`;
  }
  return headers;
}

async function post(
  kind: ProviderKind,
  settings: ProviderSettings,
  key: string | undefined,
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(join(settings.baseUrl, path), {
      method: 'POST',
      headers: headersFor(kind, key),
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    });
  } catch (error) {
    throw connectionError(kind, settings, error);
  }
}

// ---------------------------------------------------------------------------
// Stream parsing
// ---------------------------------------------------------------------------

/** Lines of a streamed response body. */
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        yield buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer.replace(/\r$/, '');
  } finally {
    reader.releaseLock();
  }
}

/** Server-sent events: the `data` of each event, with its `event` name if there was one. */
async function* serverSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string | null; data: string }> {
  let event: string | null = null;
  let data: string[] = [];
  for await (const line of lines(body)) {
    if (line === '') {
      if (data.length) yield { event, data: data.join('\n') };
      event = null;
      data = [];
    } else if (line.startsWith(':')) {
      // Comment (keep-alive).
    } else {
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
  }
  if (data.length) yield { event, data: data.join('\n') };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export async function* streamChat(
  kind: ProviderKind,
  settings: ProviderSettings,
  key: string | undefined,
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (!settings.model) throw new ProviderError('Choose a model in AI settings first.', 400);
  if (kind === 'anthropic' && !key) throw new ProviderError('Add your Anthropic API key in AI settings first.', 400);
  if (kind === 'ollama') yield* ollamaChat(settings, request, signal);
  else if (kind === 'openai') yield* openaiChat(settings, key, request, signal);
  else yield* anthropicChat(settings, key, request, signal);
}

async function* ollamaChat(settings: ProviderSettings, request: ChatRequest, signal: AbortSignal): AsyncGenerator<string> {
  const response = await post(
    'ollama',
    settings,
    undefined,
    '/api/chat',
    {
      model: settings.model,
      stream: true,
      format: request.schema,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      options: { temperature: 0.2, num_ctx: settings.contextSize ?? 8192, num_predict: request.maxTokens },
    },
    signal,
  );
  if (!response.ok || !response.body) throw await responseError('ollama', response);
  for await (const line of lines(response.body)) {
    if (!line.trim()) continue;
    const chunk = parseJson(line);
    if (!chunk) continue;
    if (typeof chunk.error === 'string') throw new ProviderError(`Ollama: ${chunk.error}`);
    const content = (chunk.message as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string' && content) yield content;
    if (chunk.done === true) {
      if (chunk.done_reason === 'length') throw cutOff('Ollama', 'or raise the context size in AI settings');
      return;
    }
  }
  throw endedEarly('Ollama');
}

/** A reply that hit the length limit is incomplete JSON; asking again would only cut it off again. */
function cutOff(name: string, hint = ''): ProviderError {
  return new ProviderError(
    `${name}’s reply was cut off before it was finished. Try a smaller selection or a simpler request${hint ? `, ${hint}` : ''}.`,
  );
}

function endedEarly(name: string): ProviderError {
  return new ProviderError(`The connection to ${name} ended before the reply was finished. Try again.`);
}

/** Ways of asking an OpenAI-compatible server for JSON, most constrained first. */
const RESPONSE_FORMATS = ['json_schema', 'json_object', 'none'] as const;

async function* openaiChat(
  settings: ProviderSettings,
  key: string | undefined,
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<string> {
  let response: Response | null = null;
  let format = 0;
  // Newer OpenAI models (reasoning models) take max_completion_tokens and no temperature.
  let modern = false;
  for (let attempt = 0; attempt < RESPONSE_FORMATS.length + 1; attempt++) {
    const body: Record<string, unknown> = {
      model: settings.model,
      stream: true,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
    };
    if (modern) body.max_completion_tokens = request.maxTokens;
    else Object.assign(body, { max_tokens: request.maxTokens, temperature: 0.2 });
    if (RESPONSE_FORMATS[format] === 'json_schema') {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'stylecode_changes', schema: request.schema, strict: false },
      };
    } else if (RESPONSE_FORMATS[format] === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    response = await post('openai', settings, key, '/chat/completions', body, signal);
    if (response.ok) break;
    // A server that doesn't support a parameter rejects it with a 400 that says so; adjust and try again.
    if (response.status !== 400 && response.status !== 422) break;
    const text = await response.clone().text();
    if (!modern && /max_tokens|max_completion_tokens|temperature/i.test(text)) modern = true;
    else if (/response_format|json_schema|json_object|structured/i.test(text) && format < RESPONSE_FORMATS.length - 1) format++;
    else break;
  }
  if (!response || !response.ok || !response.body) throw await responseError('openai', response!);
  let finished = false;
  for await (const { data } of serverSentEvents(response.body)) {
    if (data.trim() === '[DONE]') return;
    const chunk = parseJson(data);
    if (!chunk) continue;
    if (chunk.error) {
      const error = chunk.error as { message?: unknown };
      throw new ProviderError(`The server reported an error: ${typeof error.message === 'string' ? error.message : 'unknown'}`);
    }
    const choice = (chunk.choices as { delta?: { content?: unknown }; finish_reason?: unknown }[] | undefined)?.[0];
    const content = choice?.delta?.content;
    if (typeof content === 'string' && content) yield content;
    if (choice?.finish_reason === 'length') throw cutOff('The model');
    if (typeof choice?.finish_reason === 'string') finished = true;
  }
  // Some servers end without [DONE]; a finish reason is enough.
  if (!finished) throw endedEarly(PROVIDER_NAMES.openai);
}

async function* anthropicChat(
  settings: ProviderSettings,
  key: string | undefined,
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const response = await post(
    'anthropic',
    settings,
    key,
    '/v1/messages',
    {
      model: settings.model,
      max_tokens: request.maxTokens,
      stream: true,
      temperature: 0.2,
      system: request.system,
      messages: request.messages,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Propose changes to the design as a list of operations, with a short explanation.',
          input_schema: request.schema,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    },
    signal,
  );
  if (!response.ok || !response.body) throw await responseError('anthropic', response);
  for await (const { data } of serverSentEvents(response.body)) {
    const event = parseJson(data);
    if (!event) continue;
    if (event.type === 'error') {
      const error = event.error as { message?: unknown } | undefined;
      throw new ProviderError(`Anthropic: ${typeof error?.message === 'string' ? error.message : 'error'}`);
    }
    if (event.type === 'content_block_delta') {
      const delta = event.delta as { type?: string; partial_json?: unknown; text?: unknown } | undefined;
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string' && delta.partial_json) {
        yield delta.partial_json;
      }
    }
    if (event.type === 'message_delta') {
      const stop = (event.delta as { stop_reason?: unknown } | undefined)?.stop_reason;
      if (stop === 'max_tokens') throw cutOff('Anthropic');
    }
    if (event.type === 'message_stop') return;
  }
  throw endedEarly('Anthropic');
}

// ---------------------------------------------------------------------------
// Models and connection checks
// ---------------------------------------------------------------------------

async function get(kind: ProviderKind, settings: ProviderSettings, key: string | undefined, path: string, signal: AbortSignal) {
  try {
    const { 'content-type': _, ...headers } = headersFor(kind, key);
    return await fetch(join(settings.baseUrl, path), { headers, signal, redirect: 'error' });
  } catch (error) {
    throw connectionError(kind, settings, error);
  }
}

/** The models a provider offers (installed models, for Ollama). */
export async function listModels(
  kind: ProviderKind,
  settings: ProviderSettings,
  key: string | undefined,
  signal: AbortSignal,
): Promise<string[]> {
  if (kind === 'anthropic' && !key) throw new ProviderError('Add your Anthropic API key first.', 400);
  const path = kind === 'ollama' ? '/api/tags' : kind === 'openai' ? '/models' : '/v1/models';
  const response = await get(kind, settings, key, path, signal);
  if (!response.ok) throw await responseError(kind, response);
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const entries =
    kind === 'ollama' ? (body?.models as { name?: unknown }[] | undefined) : (body?.data as { id?: unknown }[] | undefined);
  const names = (entries ?? [])
    .map((m) => (kind === 'ollama' ? (m as { name?: unknown }).name : (m as { id?: unknown }).id))
    .filter((n): n is string => typeof n === 'string');
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
