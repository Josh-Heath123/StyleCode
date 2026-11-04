import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTypingTarget } from '../canvas/Canvas';
import { useEditor, useEditorState } from '../editor/react';
import type { AiConfig } from '../ai/client';
import { useAssistant, useAssistantState } from '../ai/react';
import { suggestionsFor } from '../ai/suggestions';
import { Icon } from '../ui/Icon';
import { Dock } from './Dock';

export const PROVIDER_NAMES = { ollama: 'Ollama', openai: 'OpenAI-compatible', anthropic: 'Anthropic' } as const;

/** "Ollama · llama3.1:8b", or why AI isn't available. */
export function aiStatusLabel(config: AiConfig | null, unavailable: string | null): string {
  if (unavailable) return 'AI unavailable';
  if (!config) return 'AI';
  if (config.provider === 'off') return 'AI off';
  const model = config.providers[config.provider].model;
  return model || `${PROVIDER_NAMES[config.provider]}: choose a model`;
}

/**
 * The bottom of the canvas: the tool dock, and above it the AI assistant.
 * The assistant opens with the dock's AI button or "/", streams what the AI
 * is doing, and then shows its proposal on the canvas in cantaloupe to accept
 * (Enter) or reject (Esc).
 */
export function DockArea({ onOpenSettings }: { onOpenSettings: () => void }) {
  const editor = useEditor();
  const assistant = useAssistant();
  const state = useAssistantState();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const visible = open || state.status !== 'idle';

  const openAndFocus = useCallback(() => {
    setOpen(true);
    setFocusRequest((n) => n + 1);
  }, []);

  const send = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setOpen(true);
      void assistant.ask(text);
    },
    [assistant],
  );

  const accept = useCallback(() => {
    assistant.accept();
    setDraft('');
    setOpen(false);
  }, [assistant]);

  const reject = useCallback(() => {
    assistant.reject();
    openAndFocus();
  }, [assistant, openAndFocus]);

  const stop = useCallback(() => {
    assistant.stop();
    openAndFocus();
  }, [assistant, openAndFocus]);

  const close = useCallback(() => {
    const { status } = assistant.getState();
    if (status === 'thinking') assistant.stop();
    else assistant.dismiss();
    setOpen(false);
  }, [assistant]);

  useEffect(() => {
    if (focusRequest) inputRef.current?.focus();
  }, [focusRequest]);

  // "/" opens the assistant; while reviewing, Enter accepts and Esc rejects.
  // Listens before the editor's shortcuts, which would otherwise take Enter and Esc.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || editor.inGesture || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as Element | null;
      if (isTypingTarget(e.target) || e.isComposing || e.keyCode === 229 || target?.closest?.('.menu, [role="dialog"]')) return;
      // Enter on a focused button or link activates that instead.
      const onControl = !!target?.closest?.('button, a, summary');
      const current = assistant.getState();
      if (e.key === '/') {
        e.preventDefault();
        if (current.status === 'idle' || current.status === 'error') {
          if (current.status === 'error') assistant.dismiss();
          openAndFocus();
        }
        return;
      }
      if (current.status === 'review') {
        if (e.key === 'Escape') {
          e.preventDefault();
          reject();
        } else if (e.key === 'Enter' && !e.shiftKey && !onControl && !current.needsConfirmation) {
          e.preventDefault();
          if (current.noChanges) reject();
          else accept();
        }
      } else if (current.status === 'error' && e.key === 'Escape') {
        e.preventDefault();
        assistant.dismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [editor, assistant, accept, reject, openAndFocus]);

  return (
    <div className="dock-slot">
      <div className="dock-stack">
        {visible && (
          <AssistantPanel
            draft={draft}
            setDraft={setDraft}
            inputRef={inputRef}
            onSend={send}
            onAccept={accept}
            onReject={reject}
            onStop={stop}
            onClose={close}
            onEdit={() => {
              setDraft(assistant.getState().request || draft);
              assistant.dismiss();
              openAndFocus();
            }}
            onOpenSettings={onOpenSettings}
          />
        )}
        <Dock aiOpen={visible} onToggleAi={() => (visible ? close() : openAndFocus())} />
      </div>
    </div>
  );
}

interface PanelProps {
  draft: string;
  setDraft: (text: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onStop: () => void;
  onClose: () => void;
  onEdit: () => void;
  onOpenSettings: () => void;
}

function AssistantPanel({
  draft,
  setDraft,
  inputRef,
  onSend,
  onAccept,
  onReject,
  onStop,
  onClose,
  onEdit,
  onOpenSettings,
}: PanelProps) {
  const assistant = useAssistant();
  const state = useAssistantState();
  const doc = useEditorState((s) => s.doc);
  const selection = useEditorState((s) => s.selection);
  // The target follows the selection; with nothing selected, the screen in view as the canvas pans.
  useEditorState(() => {
    const t = assistant.target();
    return 'error' in t ? t.error : t.screenId;
  });
  const target = state.status === 'idle' ? assistant.target() : null;
  const suggestions = target && !('error' in target) ? suggestionsFor(doc, selection, target) : [];

  // The input grows with its text, up to a few lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft, inputRef, state.status]);

  const ready = assistant.ready;
  const head = (title: React.ReactNode) => (
    <header className="assistant-head">
      <span className="assistant-title">
        <Icon name="sparkle" size={14} className="assistant-mark" />
        {title}
      </span>
      <button
        type="button"
        className="text-button assistant-model"
        data-tip="AI settings"
        data-tip-side="top"
        onClick={onOpenSettings}
      >
        {aiStatusLabel(state.config, state.unavailable)}
      </button>
      <button type="button" className="icon-button" aria-label="Close the assistant" onClick={onClose}>
        <Icon name="x" size={14} />
      </button>
    </header>
  );

  let body: React.ReactNode;
  if (state.status === 'thinking') {
    body = (
      <>
        {head(<>Working on {state.targetLabel}</>)}
        <p className="assistant-request">{state.request}</p>
        <p className="assistant-explanation is-streaming" aria-live="polite">
          {state.explanation || (state.phase === 'repairing' ? '' : 'Thinking…')}
        </p>
        <footer className="assistant-actions">
          <span className="assistant-phase">
            <span className="assistant-pulse" />
            {state.phase === 'repairing'
              ? 'Fixing a problem in the reply…'
              : state.phase === 'waiting'
                ? 'Ready: finish your edit to see the changes.'
                : 'Writing changes…'}
          </span>
          <button type="button" className="button" onClick={onStop}>
            <Icon name="stop" size={12} /> Stop
          </button>
        </footer>
      </>
    );
  } else if (state.status === 'review') {
    body = (
      <>
        {head(state.noChanges ? 'No changes' : 'Review the changes')}
        <p className="assistant-request">{state.request}</p>
        {state.explanation && <p className="assistant-explanation">{state.explanation}</p>}
        {!state.noChanges && (
          <p className="assistant-summary">
            <span className="assistant-swatch" aria-hidden="true" />
            {state.summary} Highlighted on the canvas.
          </p>
        )}
        {state.needsConfirmation && (
          <p className="assistant-warning" role="alert">
            <Icon name="warning" size={14} />
            This deletes {state.removedCount} layers. Check the canvas before applying.
          </p>
        )}
        <footer className="assistant-actions">
          {state.noChanges ? (
            <button type="button" className="button" onClick={onReject}>
              OK
            </button>
          ) : (
            <>
              <button type="button" className="button" onClick={onReject}>
                Reject <kbd>Esc</kbd>
              </button>
              <button
                type="button"
                className={`button ${state.needsConfirmation ? 'danger-fill' : 'primary'}`}
                onClick={onAccept}
              >
                {state.needsConfirmation ? (
                  `Delete ${state.removedCount} layers and apply`
                ) : (
                  <>
                    Accept <kbd>Enter</kbd>
                  </>
                )}
              </button>
            </>
          )}
        </footer>
      </>
    );
  } else if (state.status === 'error') {
    body = (
      <>
        {head('Something went wrong')}
        {state.request && <p className="assistant-request">{state.request}</p>}
        <p className="assistant-error" role="alert">
          {state.error}
        </p>
        {state.problems.length > 0 && (
          <details className="assistant-problems">
            <summary>What was wrong with the reply ({state.problems.length})</summary>
            <ul>
              {state.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </details>
        )}
        <footer className="assistant-actions">
          {!ready ? (
            <button type="button" className="button primary" onClick={onOpenSettings}>
              Open AI settings
            </button>
          ) : (
            <>
              <button type="button" className="button" onClick={onEdit}>
                Edit request
              </button>
              {state.request && (
                <button type="button" className="button primary" onClick={() => onSend(state.request)}>
                  Try again
                </button>
              )}
            </>
          )}
        </footer>
      </>
    );
  } else if (!ready) {
    body = (
      <>
        {head('AI assistant')}
        {state.unavailable ? (
          <p className="assistant-note">{state.unavailable}</p>
        ) : !state.config ? (
          <p className="assistant-note">Loading AI settings…</p>
        ) : (
          <>
            <p className="assistant-note">
              Describe a change and review it on the canvas before it is applied. Use a free model on this computer with Ollama,
              or your own OpenAI-compatible or Anthropic key. StyleCode works fully without AI.
            </p>
            <footer className="assistant-actions">
              <button type="button" className="button primary" onClick={onOpenSettings}>
                Set up AI
              </button>
            </footer>
          </>
        )}
      </>
    );
  } else {
    const targetError = target && 'error' in target ? target.error : null;
    const label = target && !('error' in target) ? target.targetLabel : '';
    body = (
      <>
        {head(targetError ? 'AI assistant' : <>Change {label}</>)}
        <form
          className="assistant-compose"
          onSubmit={(e) => {
            e.preventDefault();
            onSend(draft);
          }}
        >
          <textarea
            ref={inputRef}
            className="assistant-input"
            aria-label="Ask AI"
            rows={1}
            maxLength={2000}
            placeholder={targetError ? 'Select something to change' : `Describe a change to ${label}…`}
            value={draft}
            disabled={!!targetError}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // keyCode 229: Safari's Enter that confirms an input-method composition.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                onSend(draft);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <button
            type="submit"
            className="assistant-send"
            aria-label="Send"
            data-tip="Send  Enter"
            data-tip-side="top"
            disabled={!draft.trim() || !!targetError}
          >
            <Icon name="send" size={15} strokeWidth={2} />
          </button>
        </form>
        {targetError ? (
          <p className="assistant-note">{targetError}</p>
        ) : (
          !draft.trim() &&
          suggestions.length > 0 && (
            <div className="assistant-suggestions" aria-label="Suggestions">
              {suggestions.map((text) => (
                <button key={text} type="button" className="assistant-chip" onClick={() => onSend(text)}>
                  {text}
                </button>
              ))}
            </div>
          )
        )}
      </>
    );
  }

  return (
    <section className="assistant glass" aria-label="AI assistant" data-status={state.status}>
      {body}
    </section>
  );
}
