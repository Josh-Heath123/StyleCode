/**
 * The browser's side of the local AI server (`server/ai`). It never sees API
 * keys: settings come back with `hasKey` flags only, and a key typed into the
 * settings dialog is sent once to be saved on this computer.
 */

export type ProviderKind = 'ollama' | 'openai' | 'anthropic';

export interface ProviderSettings {
  baseUrl: string;
  model: string;
  contextSize?: number;
  hasKey: boolean;
  keySource: 'file' | 'environment' | null;
}

export interface AiConfig {
  provider: 'off' | ProviderKind;
  providers: Record<ProviderKind, ProviderSettings>;
  configPath: string;
}

/** Settings sent to the server. `apiKey`: a string sets it, null removes it, leaving it out keeps it. */
export interface ProviderUpdate {
  baseUrl?: string;
  model?: string;
  contextSize?: number;
  apiKey?: string | null;
}

export class AiUnavailableError extends Error {}

const BASE = '/api/ai';
const HEADERS = { 'content-type': 'application/json', 'x-stylecode-ai': '1' };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
  } catch {
    throw new AiUnavailableError('StyleCode’s local server isn’t reachable.');
  }
  if (response.status === 404) {
    throw new AiUnavailableError('AI needs StyleCode’s local server: run it with npm run dev or npm run preview.');
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `The local server returned an error (${response.status}).`);
  return body;
}

export function getAiConfig(): Promise<AiConfig> {
  return request<AiConfig>('/config');
}

export function saveAiConfig(update: {
  provider?: AiConfig['provider'];
  providers?: Partial<Record<ProviderKind, ProviderUpdate>>;
}): Promise<AiConfig> {
  return request<AiConfig>('/config', { method: 'PUT', body: JSON.stringify(update) });
}

/** Lists a provider's models; also how the settings dialog checks a connection. Unsaved settings may be tried. */
export async function listModels(provider: ProviderKind, settings: ProviderUpdate = {}): Promise<string[]> {
  return (await request<{ models: string[] }>('/models', { method: 'POST', body: JSON.stringify({ provider, settings }) }))
    .models;
}

export interface ChatInput {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  schema: Record<string, unknown>;
  maxTokens?: number;
}

/**
 * Streams a reply from the configured provider. `onText` gets the reply so
 * far each time more arrives; the full reply is returned at the end.
 */
export async function chat(input: ChatInput, onText: (soFar: string) => void, signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/chat`, { method: 'POST', headers: HEADERS, body: JSON.stringify(input), signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new AiUnavailableError('StyleCode’s local server isn’t reachable.');
  }
  if (response.status === 404)
    throw new AiUnavailableError('AI needs StyleCode’s local server: run it with npm run dev or npm run preview.');
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The AI request failed (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const handle = (line: string) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as { delta?: string; error?: string; done?: boolean };
    if (message.error) throw new Error(message.error);
    if (message.delta) {
      text += message.delta;
      onText(text);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      handle(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  handle(buffer + decoder.decode());
  return text;
}
