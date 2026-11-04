import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * AI settings, kept in a file on this computer (by default
 * `~/.stylecode/ai.json`, readable only by the user). API keys live here or
 * in environment variables and never leave the local server: the browser only
 * learns whether a key is set.
 */

export const PROVIDER_KINDS = ['ollama', 'openai', 'anthropic'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface ProviderSettings {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Ollama only: the context window to ask for, in tokens. */
  contextSize?: number;
}

export interface AiConfig {
  provider: 'off' | ProviderKind;
  providers: Record<ProviderKind, ProviderSettings>;
}

/** What the browser may see: everything except the keys. */
export interface PublicProviderSettings {
  baseUrl: string;
  model: string;
  contextSize?: number;
  hasKey: boolean;
  keySource: 'file' | 'environment' | null;
}

export interface PublicAiConfig {
  provider: 'off' | ProviderKind;
  providers: Record<ProviderKind, PublicProviderSettings>;
  /** Where the settings are saved, so the user can find them. */
  configPath: string;
}

export const DEFAULT_CONFIG: AiConfig = {
  provider: 'off',
  providers: {
    ollama: { baseUrl: 'http://localhost:11434', model: '', contextSize: 8192 },
    openai: { baseUrl: 'https://api.openai.com/v1', model: '' },
    anthropic: { baseUrl: 'https://api.anthropic.com', model: '' },
  },
};

/** Environment variables that can hold a key instead of the settings file. */
const KEY_VARIABLES: Record<ProviderKind, string | null> = {
  ollama: null,
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

export function configPath(): string {
  return process.env.STYLECODE_AI_CONFIG || join(homedir(), '.stylecode', 'ai.json');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Only http(s) URLs, without credentials, are accepted as provider addresses. */
export function cleanBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function cleanSettings(raw: unknown, fallback: ProviderSettings): ProviderSettings {
  const out: ProviderSettings = { ...fallback };
  if (!isRecord(raw)) return out;
  const baseUrl = cleanBaseUrl(raw.baseUrl);
  if (baseUrl) out.baseUrl = baseUrl;
  if (typeof raw.model === 'string') out.model = raw.model.trim().slice(0, 200);
  if (typeof raw.apiKey === 'string' && raw.apiKey.trim()) out.apiKey = raw.apiKey.trim();
  if (typeof raw.contextSize === 'number' && Number.isFinite(raw.contextSize)) {
    out.contextSize = Math.round(Math.min(1_048_576, Math.max(2048, raw.contextSize)));
  }
  return out;
}

/** Reads the settings file. A missing or damaged file gives the defaults (AI off). */
export async function loadConfig(path = configPath()): Promise<AiConfig> {
  let raw: unknown = null;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    raw = null;
  }
  const config: AiConfig = { provider: 'off', providers: { ...DEFAULT_CONFIG.providers } };
  if (!isRecord(raw)) return config;
  if (raw.provider === 'off' || PROVIDER_KINDS.includes(raw.provider as ProviderKind)) {
    config.provider = raw.provider as AiConfig['provider'];
  }
  const providers = isRecord(raw.providers) ? raw.providers : {};
  for (const kind of PROVIDER_KINDS) config.providers[kind] = cleanSettings(providers[kind], DEFAULT_CONFIG.providers[kind]);
  return config;
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs settings-file work one task at a time, so no change is lost to another. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

/** Writes to a new temporary file, then renames it over the old one, so the file is never half-written. */
async function writeConfig(config: AiConfig, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    // 'wx' fails rather than reuse a file someone else created, which would keep its permissions.
    await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(temp, 0o600).catch(() => {});
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Saves the settings, readable and writable only by the current user. */
export function saveConfig(config: AiConfig, path = configPath()): Promise<void> {
  return serial(() => writeConfig(config, path));
}

/** Reads the settings, applies a change from the settings dialog and saves them, as one step. */
export function updateConfig(update: ConfigUpdate, path = configPath()): Promise<AiConfig> {
  return serial(async () => {
    const next = applyUpdate(await loadConfig(path), update);
    await writeConfig(next, path);
    return next;
  });
}

/** The key to use for a provider: the settings file first, then the environment. */
export function resolveKey(
  config: AiConfig,
  kind: ProviderKind,
): { key: string | undefined; source: PublicProviderSettings['keySource'] } {
  const fromFile = config.providers[kind].apiKey;
  if (fromFile) return { key: fromFile, source: 'file' };
  const variable = KEY_VARIABLES[kind];
  const fromEnv = variable ? process.env[variable]?.trim() : undefined;
  return fromEnv ? { key: fromEnv, source: 'environment' } : { key: undefined, source: null };
}

export function publicConfig(config: AiConfig, path = configPath()): PublicAiConfig {
  const providers = {} as Record<ProviderKind, PublicProviderSettings>;
  for (const kind of PROVIDER_KINDS) {
    const { apiKey: _hidden, ...rest } = config.providers[kind];
    const { key, source } = resolveKey(config, kind);
    providers[kind] = { ...rest, hasKey: !!key, keySource: source };
  }
  return { provider: config.provider, providers, configPath: path };
}

export interface ConfigUpdate {
  provider?: unknown;
  providers?: Partial<Record<ProviderKind, unknown>>;
}

/** Settings that can't be used, with a message for the person who entered them. */
export class ConfigError extends Error {}

/**
 * Applies a change from the settings dialog. A provider's `apiKey` is set when
 * a non-empty string is given and removed when it is null; leaving it out
 * keeps the stored key, as long as the address stays the same: a saved key
 * is never sent to an address it wasn't saved with.
 */
export function applyUpdate(config: AiConfig, update: ConfigUpdate): AiConfig {
  const next: AiConfig = { provider: config.provider, providers: { ...config.providers } };
  if (update.provider === 'off' || PROVIDER_KINDS.includes(update.provider as ProviderKind)) {
    next.provider = update.provider as AiConfig['provider'];
  }
  for (const kind of PROVIDER_KINDS) {
    const raw = update.providers?.[kind];
    if (!isRecord(raw)) continue;
    const current = config.providers[kind];
    if (raw.baseUrl !== undefined && !cleanBaseUrl(raw.baseUrl)) {
      throw new ConfigError(
        `“${String(raw.baseUrl).slice(0, 100)}” isn’t a usable address. Enter a full address starting with http:// or https://.`,
      );
    }
    const merged = cleanSettings({ ...current, ...raw, apiKey: undefined }, current);
    if (raw.apiKey === null) delete merged.apiKey;
    else if (typeof raw.apiKey === 'string' && raw.apiKey.trim()) merged.apiKey = raw.apiKey.trim();
    else if (current.apiKey && merged.baseUrl === current.baseUrl) merged.apiKey = current.apiKey;
    else delete merged.apiKey;
    next.providers[kind] = merged;
  }
  return next;
}
