import { chat, getAiConfig, type ProviderKind } from '../../../ai/client';
import { canUseAi, classifyProvider } from '../../model/consent';
import type { AiProcessing, CompanyWorkspace } from '../../model/types';
import type { SendPart } from '../../extraction/run';

/** The AI as set up in AI settings right now, and where it would run (rule C6). */
export interface AiSetup {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  /** The context the model is asked for (Ollama), or a safe size for a hosted model. */
  contextSize: number;
  processing: AiProcessing;
}

/** A hosted model's context is far larger; this keeps each part small enough to answer well. */
const HOSTED_CONTEXT = 32_768;

/**
 * Reads the AI settings now, never from a copy made earlier, and says where
 * the model runs, judged by provider, address and model together (an Ollama
 * cloud model is external). A string says why the AI can't be used.
 */
export async function currentAiSetup(): Promise<AiSetup | string> {
  let config;
  try {
    config = await getAiConfig();
  } catch (e) {
    return (e as Error).message;
  }
  if (config.provider === 'off') return 'AI is turned off. Turn it on in AI settings, in the design editor’s top bar.';
  const settings = config.providers[config.provider];
  if (!settings.model) return 'Choose a model in AI settings first.';
  return {
    provider: config.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    contextSize: config.provider === 'ollama' ? (settings.contextSize ?? 8192) : HOSTED_CONTEXT,
    processing: classifyProvider({ provider: config.provider, baseUrl: settings.baseUrl, model: settings.model }),
  };
}

const sameSetup = (a: AiSetup, b: AiSetup) =>
  a.provider === b.provider &&
  a.baseUrl === b.baseUrl &&
  a.model === b.model &&
  JSON.stringify(a.processing) === JSON.stringify(b.processing);

/**
 * Sends one part of a session for the run that started with `setup`. Just
 * before each request it reads the AI settings again and checks consent for
 * exactly that provider, address and model at that moment (rules C5 and C6),
 * and the request names them, so the server can't send it anywhere else. If
 * the settings changed during the run, the run stops.
 */
export function sendForSession(
  setup: AiSetup,
  workspace: () => CompanyWorkspace,
  sessionId: string,
  onText?: (soFar: string) => void,
): SendPart {
  return async ({ system, message, schema }, signal) => {
    const now = await currentAiSetup();
    if (typeof now === 'string') throw new Error(now);
    if (!sameSetup(setup, now)) throw new Error('The AI settings changed while the AI was working, so it stopped.');
    const allowed = canUseAi(workspace(), sessionId, now.processing, new Date().toISOString());
    if (!allowed.ok) throw new Error(allowed.error);
    return chat(
      {
        system,
        messages: [{ role: 'user', content: message }],
        schema,
        maxTokens: 3000,
        provider: now.provider,
        settings: {
          baseUrl: now.baseUrl,
          model: now.model,
          ...(now.provider === 'ollama' ? { contextSize: now.contextSize } : {}),
        },
        think: now.provider === 'ollama' ? false : undefined,
      },
      onText ?? (() => {}),
      signal,
    );
  };
}
