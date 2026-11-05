import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CrashScreen } from './app/CrashScreen';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { clearMeasureCache } from './canvas/measure';
import { normalizeDocument } from './canvas/normalize';
import { Assistant } from './ai/assistant';
import { Editor } from './editor/editor';
import { createDocument } from './model/document';
import { ProjectSession } from './persistence/session';
import { loadFonts } from './styles/fonts';
import { getWorkspaceInfo } from './workspace/api';
import { Shell } from './workspace/ui/Shell';
import './styles/app.css';

/**
 * Errors that escape everything else (a failed promise, a bug in an event
 * handler) are shown as a notice rather than failing silently. The same
 * message isn't repeated for a while.
 */
function reportUnexpectedErrors(editor: Editor): void {
  let last = '';
  let lastAt = 0;
  const report = (error: unknown) => {
    const name = (error as Error | null)?.name;
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    // Cancelled requests and a harmless browser layout warning aren't problems.
    if (!message || name === 'AbortError' || /ResizeObserver loop/.test(message)) return;
    if (message === last && Date.now() - lastAt < 10_000) return;
    last = message;
    lastAt = Date.now();
    editor.notify(`Something went wrong: ${message}. If the editor misbehaves, save to a file and reload.`, 'error');
  };
  window.addEventListener('error', (e) => report(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
}

/** If StyleCode can't start at all, say so on the page instead of leaving it blank. */
function showBootError(container: HTMLElement, error: unknown): void {
  console.error('StyleCode could not start', error);
  const box = document.createElement('div');
  box.className = 'crash';
  box.setAttribute('role', 'alert');
  const card = document.createElement('div');
  card.className = 'crash-card';
  const title = document.createElement('h1');
  title.textContent = 'StyleCode couldn’t start';
  const text = document.createElement('p');
  text.textContent = 'Reloading usually fixes this. Designs saved on this device are not affected.';
  const detail = document.createElement('pre');
  detail.className = 'crash-error';
  detail.textContent = error instanceof Error ? error.message : String(error);
  const reload = document.createElement('button');
  reload.className = 'button primary';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => location.reload());
  card.append(title, text, detail, reload);
  box.append(card);
  container.replaceChildren(box);
}

async function boot() {
  const container = document.getElementById('root')!;
  try {
    await start(container);
  } catch (error) {
    showBootError(container, error);
  }
}

async function start(container: HTMLElement) {
  // Text is measured with the bundled font, so it must be ready first.
  // Meanwhile, ask whether the workspace server is running (it isn't in a static build).
  const [info] = await Promise.all([getWorkspaceInfo(), loadFonts()]);
  clearMeasureCache();

  const editor = new Editor(createDocument());
  editor.normalizer = normalizeDocument;
  reportUnexpectedErrors(editor);
  const session = new ProjectSession(editor);
  const camera = await session.init();
  // AI is optional: its settings load in the background and the app works without them.
  const assistant = new Assistant(editor);
  void assistant.refresh();

  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    // Exposes the editor to the browser console and to automated tests.
    (window as unknown as { stylecode: unknown }).stylecode = { editor, session, assistant };
  }

  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary
        fallback={(error, reset) => <CrashScreen error={error} editor={editor} session={session} onRecover={reset} />}
      >
        <Shell editor={editor} assistant={assistant} session={session} initialCamera={camera} info={info} />
      </ErrorBoundary>
    </StrictMode>,
  );
}

void boot();
