import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { clearMeasureCache } from './canvas/measure';
import { normalizeDocument } from './canvas/normalize';
import { Assistant } from './ai/assistant';
import { Editor } from './editor/editor';
import { createDocument } from './model/document';
import { ProjectSession } from './persistence/session';
import { loadFonts } from './styles/fonts';
import './styles/app.css';

async function boot() {
  const container = document.getElementById('root')!;
  // Text is measured with the bundled font, so it must be ready first.
  await loadFonts();
  clearMeasureCache();

  const editor = new Editor(createDocument());
  editor.normalizer = normalizeDocument;
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
      <App editor={editor} assistant={assistant} session={session} initialCamera={camera} />
    </StrictMode>,
  );
}

void boot();
