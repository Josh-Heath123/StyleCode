import { useEffect, useRef, useState } from 'react';
import { listModels, saveAiConfig, type AiConfig, type ProviderKind, type ProviderUpdate } from '../ai/client';
import { useAssistant, useAssistantState } from '../ai/react';
import { useEditor } from '../editor/react';
import { Icon } from '../ui/Icon';

const KINDS: readonly ProviderKind[] = ['ollama', 'openai', 'anthropic'];

const CHOICES: { id: 'off' | ProviderKind; name: string; blurb: string }[] = [
  { id: 'off', name: 'Off', blurb: 'No AI. Everything else works as usual.' },
  { id: 'ollama', name: 'Ollama', blurb: 'Free and private: models run on this computer.' },
  { id: 'openai', name: 'OpenAI-compatible', blurb: 'OpenAI, LM Studio, OpenRouter, Groq and others.' },
  { id: 'anthropic', name: 'Anthropic', blurb: 'Claude models, with your own API key.' },
];

/** Services that speak the OpenAI API, to fill in the address. */
const PRESETS = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
];

const KEY_VARIABLES = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' } as const;
const MODEL_EXAMPLES = { ollama: 'qwen2.5:7b', openai: 'gpt-5-mini', anthropic: 'claude-sonnet-5-5' } as const;
const CONTEXT_SIZES = [4096, 8192, 16384, 32768];

interface Draft {
  baseUrl: string;
  model: string;
  contextSize: number;
  /** A new key typed here; empty keeps the saved one. */
  key: string;
  removeKey: boolean;
}

type Models = { status: 'idle' | 'loading' } | { status: 'ok'; models: string[] } | { status: 'error'; error: string };

function draftsFrom(config: AiConfig): Record<ProviderKind, Draft> {
  const out = {} as Record<ProviderKind, Draft>;
  for (const kind of KINDS) {
    const p = config.providers[kind];
    out[kind] = { baseUrl: p.baseUrl, model: p.model, contextSize: p.contextSize ?? 8192, key: '', removeKey: false };
  }
  return out;
}

function updateFor(kind: ProviderKind, draft: Draft): ProviderUpdate {
  const update: ProviderUpdate = { baseUrl: draft.baseUrl.trim(), model: draft.model.trim() };
  if (kind === 'ollama') update.contextSize = draft.contextSize;
  if (draft.key.trim()) update.apiKey = draft.key.trim();
  else if (draft.removeKey) update.apiKey = null;
  return update;
}

/**
 * Chooses the AI provider and model. Settings and keys are saved by the local
 * server in a file on this computer; a key typed here is sent to it once and
 * never comes back to the browser.
 */
export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  const editor = useEditor();
  const assistant = useAssistant();
  const { config, unavailable } = useAssistantState();
  const [provider, setProvider] = useState<AiConfig['provider']>(config?.provider ?? 'off');
  const [drafts, setDrafts] = useState<Record<ProviderKind, Draft> | null>(config ? draftsFrom(config) : null);
  const [models, setModels] = useState<Record<ProviderKind, Models>>({
    ollama: { status: 'idle' },
    openai: { status: 'idle' },
    anthropic: { status: 'idle' },
  });
  const [typingModel, setTypingModel] = useState<Record<ProviderKind, boolean>>({
    ollama: false,
    openai: false,
    anthropic: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const loadId = useRef(0);
  const latest = useRef<Partial<Record<ProviderKind, number>>>({});

  useEffect(() => {
    dialogRef.current?.focus();
    void assistant.refresh();
  }, [assistant]);

  // Settings arrive (or change on disk): start from them, once.
  useEffect(() => {
    if (config && !drafts) {
      setDrafts(draftsFrom(config));
      setProvider(config.provider);
    }
  }, [config, drafts]);

  /** Lists a provider's models with the settings as typed; only the latest check for each provider counts. */
  const loadModels = async (kind: ProviderKind, draft: Draft) => {
    const id = ++loadId.current;
    latest.current[kind] = id;
    setModels((m) => ({ ...m, [kind]: { status: 'loading' } }));
    let result: Models;
    try {
      result = { status: 'ok', models: await listModels(kind, updateFor(kind, draft)) };
    } catch (e) {
      result = { status: 'error', error: (e as Error).message };
    }
    if (latest.current[kind] !== id) return;
    setModels((m) => ({ ...m, [kind]: result }));
    // A local server with models and none chosen yet: pick the first.
    const first = result.status === 'ok' ? result.models[0] : undefined;
    if (kind === 'ollama' && first) {
      setDrafts((d) => (d && !d.ollama.model ? { ...d, ollama: { ...d.ollama, model: first } } : d));
    }
  };

  // Check the connection when a provider is picked, if it can work without typing anything more.
  useEffect(() => {
    if (!drafts || !config || provider === 'off' || models[provider].status !== 'idle') return;
    const settings = config.providers[provider];
    if (provider === 'ollama' || settings.hasKey) void loadModels(provider, drafts[provider]);
    // Runs when the provider changes or the settings first arrive, not on every keystroke.
  }, [provider, drafts === null, config === null]);

  const edit = (kind: ProviderKind, patch: Partial<Draft>) => {
    setDrafts((d) => (d ? { ...d, [kind]: { ...d[kind], ...patch } } : d));
    // A different address or key may reach different models: the last check no longer applies.
    if ('baseUrl' in patch || 'key' in patch || 'removeKey' in patch) {
      latest.current[kind] = ++loadId.current;
      setModels((m) => (m[kind].status === 'idle' ? m : { ...m, [kind]: { status: 'idle' } }));
    }
  };

  const save = async () => {
    if (!drafts) return;
    if (provider !== 'off' && !drafts[provider].model.trim()) {
      setError('Choose a model first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const providers: Partial<Record<ProviderKind, ProviderUpdate>> = {};
      for (const kind of KINDS) providers[kind] = updateFor(kind, drafts[kind]);
      assistant.setConfig(await saveAiConfig({ provider, providers }));
      editor.notify(provider === 'off' ? 'AI is off.' : 'AI settings saved.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const kind = provider === 'off' ? null : provider;
  const draft = kind && drafts ? drafts[kind] : null;
  const settings = kind && config ? config.providers[kind] : null;
  const modelState = kind ? models[kind] : null;
  // Saved keys only go to the address they were saved with (see server/ai/config.ts).
  const addressChanged = !!draft && !!settings && draft.baseUrl.trim().replace(/\/+$/, '') !== settings.baseUrl;

  let body: React.ReactNode;
  if (unavailable) {
    body = <p className="ai-settings-note">{unavailable}</p>;
  } else if (!config || !drafts) {
    body = <p className="ai-settings-note">Loading…</p>;
  } else {
    body = (
      <>
        <div className="ai-providers" role="radiogroup" aria-label="AI provider">
          {CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={provider === choice.id}
              className={`ai-provider${provider === choice.id ? ' is-on' : ''}`}
              onClick={() => {
                setProvider(choice.id);
                setError(null);
              }}
            >
              <span className="ai-provider-name">{choice.name}</span>
              <span className="ai-provider-blurb">{choice.blurb}</span>
            </button>
          ))}
        </div>

        {kind && draft && settings && modelState && (
          <div className="ai-fields">
            {kind === 'openai' && (
              <div className="ai-presets" aria-label="Fill in the address for">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    className={`ai-preset${draft.baseUrl === preset.baseUrl ? ' is-on' : ''}`}
                    onClick={() => edit(kind, { baseUrl: preset.baseUrl })}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            )}

            <div className="ai-field">
              <label htmlFor="ai-address">{kind === 'ollama' ? 'Ollama address' : 'API address'}</label>
              <input
                id="ai-address"
                type="url"
                spellCheck={false}
                value={draft.baseUrl}
                onChange={(e) => edit(kind, { baseUrl: e.target.value })}
              />
            </div>

            {kind !== 'ollama' && (
              <div className="ai-field">
                <label htmlFor="ai-key">API key</label>
                <div className="ai-key-row">
                  <input
                    id="ai-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      settings.keySource === 'file' && !draft.removeKey && !addressChanged
                        ? 'Saved on this computer: type to replace'
                        : settings.keySource === 'environment'
                          ? `Using ${KEY_VARIABLES[kind]}`
                          : 'Paste your key'
                    }
                    value={draft.key}
                    onChange={(e) => edit(kind, { key: e.target.value })}
                  />
                  {settings.keySource === 'file' && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => edit(kind, { removeKey: !draft.removeKey, key: '' })}
                    >
                      {draft.removeKey ? 'Keep key' : 'Remove'}
                    </button>
                  )}
                </div>
                <span className="ai-hint">
                  {draft.removeKey
                    ? 'The saved key will be removed when you save.'
                    : settings.keySource === 'file' && addressChanged && !draft.key
                      ? 'The saved key is only sent to the address it was saved with. Paste the key for this address.'
                      : settings.keySource === 'environment' && addressChanged && !draft.key
                        ? `The ${KEY_VARIABLES[kind]} key is used once this address is saved.`
                        : settings.keySource === 'environment' && !draft.key
                          ? `Read from the ${KEY_VARIABLES[kind]} environment variable.`
                          : 'Stored only on this computer and never shown again.'}
                  {kind === 'openai' && ' Local servers such as LM Studio don’t need one.'}
                </span>
              </div>
            )}

            <div className="ai-field">
              <label htmlFor="ai-model">Model</label>
              <div className="ai-key-row">
                {modelState.status === 'ok' && modelState.models.length > 0 && !typingModel[kind] ? (
                  <select
                    id="ai-model"
                    value={draft.model}
                    onChange={(e) => {
                      if (e.target.value === '\u0000other') setTypingModel((t) => ({ ...t, [kind]: true }));
                      else edit(kind, { model: e.target.value });
                    }}
                  >
                    {!draft.model && <option value="">Choose a model</option>}
                    {draft.model && !modelState.models.includes(draft.model) && (
                      <option value={draft.model}>{draft.model} (not found)</option>
                    )}
                    {modelState.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option value={'\u0000other'}>Type a model name…</option>
                  </select>
                ) : (
                  <input
                    id="ai-model"
                    spellCheck={false}
                    placeholder={`For example ${MODEL_EXAMPLES[kind]}`}
                    value={draft.model}
                    onChange={(e) => edit(kind, { model: e.target.value })}
                  />
                )}
                <button
                  type="button"
                  className="button"
                  disabled={modelState.status === 'loading'}
                  onClick={() => {
                    setTypingModel((t) => ({ ...t, [kind]: false }));
                    void loadModels(kind, draft);
                  }}
                >
                  {modelState.status === 'loading' ? 'Checking…' : 'Test connection'}
                </button>
              </div>
              <span className={`ai-hint${modelState.status === 'error' ? ' is-error' : ''}`} role="status">
                {modelState.status === 'ok'
                  ? modelState.models.length
                    ? `Connected. ${modelState.models.length} model${modelState.models.length === 1 ? '' : 's'} available.`
                    : kind === 'ollama'
                      ? 'Connected, but no models are installed yet. Run: ollama pull qwen2.5:7b'
                      : 'Connected. Type the model name to use.'
                  : modelState.status === 'error'
                    ? modelState.error
                    : kind === 'ollama'
                      ? 'Install Ollama from ollama.com, then download a model, for example: ollama pull qwen2.5:7b'
                      : 'Test the connection to list the models your key can use.'}
              </span>
            </div>

            {kind === 'ollama' && (
              <div className="ai-field">
                <label htmlFor="ai-context">Context size</label>
                <select
                  id="ai-context"
                  value={draft.contextSize}
                  onChange={(e) => edit(kind, { contextSize: Number(e.target.value) })}
                >
                  {CONTEXT_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size.toLocaleString()} tokens
                    </option>
                  ))}
                </select>
                <span className="ai-hint">Larger sizes let the model see more of the design, but need more memory.</span>
              </div>
            )}
          </div>
        )}

        <p className="ai-settings-note">
          {provider === 'off'
            ? 'Nothing is sent anywhere.'
            : kind === 'ollama'
              ? 'Requests go from StyleCode’s local server to Ollama; nothing leaves this computer unless Ollama is elsewhere.'
              : `Requests go from StyleCode’s local server to ${kind === 'anthropic' ? 'Anthropic' : 'the service at the address above'}, and include a description of the screen you are working on.`}{' '}
          Settings are kept in <code>{config.configPath}</code>.
        </p>
      </>
    );
  }

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="dialog glass ai-settings"
        role="dialog"
        aria-modal="true"
        aria-label="AI settings"
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="dialog-head">
          <span className="ai-settings-title">
            <Icon name="sparkle" size={15} className="assistant-mark" /> AI settings
          </span>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog-body ai-settings-body">{body}</div>
        <div className="dialog-foot">
          {error && (
            <span className="ai-settings-error" role="alert">
              {error}
            </span>
          )}
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={saving || !!unavailable || !drafts}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
