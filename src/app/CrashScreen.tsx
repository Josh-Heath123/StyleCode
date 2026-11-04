import { useEffect, useRef, useState } from 'react';
import type { Editor } from '../editor/editor';
import type { ProjectSession } from '../persistence/session';

const ISSUES = 'https://github.com/Josh-Heath123/StyleCode/issues/new';

/**
 * Shown when the editor itself fails to render. The design is still in memory
 * (and autosaving), so the first job is helping keep it: save a copy, undo the
 * change that may have caused this, or reload.
 */
export function CrashScreen({
  error,
  editor,
  session,
  onRecover,
}: {
  error: Error;
  editor: Editor;
  session: ProjectSession;
  onRecover: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The design may be what broke the editor: keep the last good save rather than replace it.
    session.pause();
    heading.current?.focus();
  }, [session]);

  const canUndo = editor.inGesture || editor.history.peekUndo() !== null;
  const report = `${ISSUES}?${new URLSearchParams({
    title: `Crash: ${error.message.slice(0, 120)}`,
    body: [
      'What I was doing when it happened:',
      '',
      '',
      '---',
      '```',
      `${error.name}: ${error.message}`,
      ...(error.stack ?? '').split('\n').slice(1, 8),
      '```',
      `Browser: ${navigator.userAgent}`,
    ].join('\n'),
  })}`;

  const saveCopy = async () => {
    try {
      if (await session.exportToFile()) setMessage('Saved. You can open the file from Projects → Open project file.');
    } catch (e) {
      setMessage(`Couldn’t save a copy: ${(e as Error).message}`);
    }
  };

  return (
    <div className="crash" role="alert">
      <div className="crash-card">
        <h1 ref={heading} tabIndex={-1}>
          StyleCode hit a problem
        </h1>
        <p>
          The editor stopped drawing, but your design is still here. Autosave is paused, so the last good save is kept: save a
          copy to a file to keep the very latest, then undo the last change or reload.
        </p>
        <pre className="crash-error">{error.message}</pre>
        {message && <p className="crash-message">{message}</p>}
        <div className="crash-actions">
          <button type="button" className="button primary" onClick={() => void saveCopy()}>
            Save a copy to a file
          </button>
          {canUndo && (
            <button
              type="button"
              className="button"
              onClick={() => {
                // A drag still in progress is the last change: cancelling it is the undo.
                if (editor.inGesture) editor.cancelGesture();
                else editor.undo();
                session.resume();
                onRecover();
              }}
            >
              Undo the last change
            </button>
          )}
          <button type="button" className="button" onClick={() => location.reload()}>
            Reload
          </button>
          <a className="text-button" href={report} target="_blank" rel="noopener noreferrer">
            Report the problem
          </a>
        </div>
      </div>
    </div>
  );
}
