import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Camera } from '../editor/camera';
import { useEditor, useEditorState } from '../editor/react';
import type { ProjectSession } from '../persistence/session';
import { Icon } from '../ui/Icon';
import { MenuButton, type MenuEntry } from '../ui/Menu';
import { SHORTCUT_LABELS as K, zoomBy, zoomTo, zoomToFit, zoomToSelection } from './actions';
import { useAssistantState } from '../ai/react';
import { aiStatusLabel } from './AssistantBar';
import { exportZip } from './codeExport';
import type { Onboarding } from './onboardingState';

interface TopBarProps {
  nav?: ReactNode;
  session: ProjectSession;
  onOpenProjects: () => void;
  onCameraRestore: (camera: Camera | null) => void;
  onPreview: () => void;
  onOpenAiSettings: () => void;
  onboarding: Onboarding;
  onOpenShortcuts: () => void;
}

const REPO = 'https://github.com/Josh-Heath123/StyleCode';

const STATUS_TEXT = {
  saved: 'Saved on this device',
  saving: 'Saving…',
  pending: 'Saving…',
  error: 'Not saved',
  unavailable: 'Storage unavailable',
} as const;

export function TopBar({
  nav,
  session,
  onOpenProjects,
  onCameraRestore,
  onPreview,
  onOpenAiSettings,
  onboarding,
  onOpenShortcuts,
}: TopBarProps) {
  const editor = useEditor();
  const ai = useAssistantState();
  const name = useEditorState((s) => s.doc.name);
  const zoom = useEditorState((s) => s.camera.zoom);
  useEditorState((s) => s.historyVersion);
  const sessionState = useSyncExternalStore(session.subscribe, session.getState);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  const undoTx = editor.history.peekUndo();
  // While an AI proposal is under review, undo rejects it.
  const reviewing = useEditorState((s) => s.proposal !== null);
  const redoTx = editor.history.peekRedo();

  const run = async (task: () => Promise<unknown>) => {
    try {
      await task();
    } catch (error) {
      editor.notify((error as Error).message, 'error');
    }
  };

  const projectEntries = (): MenuEntry[] => [
    { label: 'New project', onSelect: () => run(async () => onCameraRestore(await session.newProject())) },
    { label: 'New example project', onSelect: () => run(async () => onCameraRestore(await session.newExampleProject())) },
    { label: 'All projects…', onSelect: onOpenProjects },
    { kind: 'separator' },
    {
      label: 'Open project file…',
      onSelect: () =>
        run(async () => {
          const result = await session.importFromFile();
          if (!result) return;
          onCameraRestore(result.camera);
          editor.notify(
            result.warnings ? `Opened with ${result.warnings} repair(s): some invalid values were reset.` : 'Project opened.',
            result.warnings ? 'error' : 'info',
          );
        }),
    },
    { label: 'Save to file…', onSelect: saveToFile },
  ];

  const saveToFile = () =>
    run(async () => {
      if (await session.exportToFile()) editor.notify('Project saved to file.');
    });

  const saveProblemEntries = (canRetry: boolean): MenuEntry[] => [
    { kind: 'header', label: canRetry ? 'Your latest changes aren’t saved yet' : 'This browser isn’t letting StyleCode save' },
    ...(canRetry ? [{ label: 'Try saving again', onSelect: () => void session.retry() }] : []),
    { label: 'Save to file…', onSelect: saveToFile },
    ...(canRetry ? [{ label: 'Free up space in Projects…', onSelect: onOpenProjects }] : []),
  ];

  const exportEntries = (): MenuEntry[] => [
    {
      label: 'Website (HTML and CSS)…',
      onSelect: () =>
        run(async () => {
          if (await exportZip(editor, 'site')) editor.notify('Website exported.');
        }),
    },
    {
      label: 'React app (Vite + TypeScript)…',
      onSelect: () =>
        run(async () => {
          if (await exportZip(editor, 'react')) editor.notify('React app exported.');
        }),
    },
  ];

  const helpEntries = (): MenuEntry[] => [
    { label: 'Keyboard shortcuts', shortcut: '?', onSelect: onOpenShortcuts },
    {
      label: onboarding.getState().checklistOpen ? 'Hide getting started' : 'Getting started',
      onSelect: () => onboarding.setChecklistOpen(!onboarding.getState().checklistOpen),
    },
    { label: 'Start the checklist again', onSelect: () => onboarding.restart() },
    { label: 'Welcome screen', onSelect: () => onboarding.showWelcome() },
    { kind: 'separator' },
    { label: 'Documentation', onSelect: () => window.open(`${REPO}#readme`, '_blank', 'noopener') },
    { label: 'Report a problem', onSelect: () => window.open(`${REPO}/issues`, '_blank', 'noopener') },
  ];

  const zoomEntries = (): MenuEntry[] => [
    { label: 'Zoom in', shortcut: K.zoomIn, onSelect: () => zoomBy(editor, 1) },
    { label: 'Zoom out', shortcut: K.zoomOut, onSelect: () => zoomBy(editor, -1) },
    { kind: 'separator' },
    { label: 'Zoom to 100%', shortcut: K.zoom100, onSelect: () => zoomTo(editor, 1) },
    { label: 'Zoom to fit', shortcut: K.zoomFit, onSelect: () => zoomToFit(editor) },
    {
      label: 'Zoom to selection',
      shortcut: K.zoomSelection,
      onSelect: () => zoomToSelection(editor),
      disabled: editor.getState().selection.length === 0,
    },
  ];

  /**
   * Undo/redo from the toolbar. The buttons do not take focus, so any text being
   * edited on the canvas is finished here first. If finishing it discarded a
   * brand-new, still-empty text layer, that already was the undo.
   */
  const undoFromButton = (which: 'undo' | 'redo') => {
    const editing = editor.getState().editingTextId;
    if (editing) {
      const wasNew = editor.pendingText.has(editing);
      (document.activeElement as HTMLElement | null)?.blur();
      if (which === 'undo' && wasNew && !editor.getState().doc.nodes[editing]) return;
    }
    if (which === 'undo') editor.undo();
    else editor.redo();
  };

  const commitName = () => {
    const trimmed = draft.trim();
    if (trimmed) editor.renameDocument(trimmed);
    else setDraft(name);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="5" y="5" width="15" height="15" rx="3" fill="none" stroke="#2F7BFF" strokeWidth="2.6" />
          <circle cx="21.5" cy="21.5" r="6" fill="#FFA05C" />
        </svg>
        StyleCode
      </div>
      {nav}
      {nav && <span className="topbar-divider" />}
      <MenuButton label="Projects" entries={projectEntries} className="text-button" minWidth={220}>
        <Icon name="folder" size={14} /> Projects
      </MenuButton>
      <span className="topbar-divider" />
      <input
        className="project-name"
        aria-label="Project name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(name);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
      />
      <div className="topbar-spacer" />
      {sessionState.status === 'error' || sessionState.status === 'unavailable' ? (
        // When saving fails, the status is a menu of ways to keep the work.
        <MenuButton
          label={`${STATUS_TEXT[sessionState.status]}: ${sessionState.error ?? ''}`.trim()}
          entries={() => saveProblemEntries(sessionState.status === 'error')}
          className="text-button save-status"
          minWidth={240}
          tip={sessionState.error ?? undefined}
        >
          <span data-status={sessionState.status} className="save-status-text">
            {STATUS_TEXT[sessionState.status]}
          </span>
          <Icon name="chevronDown" size={12} />
        </MenuButton>
      ) : (
        <span className="save-status">
          <span data-status={sessionState.status} className="save-status-text">
            {STATUS_TEXT[sessionState.status]}
          </span>
        </span>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={reviewing ? 'Reject the AI’s changes' : undoTx ? `Undo ${undoTx.label}` : 'Nothing to undo'}
        data-tip={
          reviewing
            ? `Reject the AI’s changes  ${K.undo}`
            : undoTx
              ? `Undo ${undoTx.label.toLowerCase()}  ${K.undo}`
              : 'Nothing to undo'
        }
        disabled={!undoTx && !reviewing}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => undoFromButton('undo')}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={redoTx ? `Redo ${redoTx.label}` : 'Nothing to redo'}
        data-tip={redoTx ? `Redo ${redoTx.label.toLowerCase()}  ${K.redo}` : 'Nothing to redo'}
        data-tip-side="left"
        disabled={!redoTx}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => undoFromButton('redo')}
      >
        <Icon name="redo" />
      </button>
      <span className="topbar-divider" />
      <MenuButton
        label={`Zoom ${Math.round(zoom * 100)}%`}
        entries={zoomEntries}
        className="text-button zoom-button"
        minWidth={210}
      >
        {Math.round(zoom * 100)}%
        <Icon name="chevronDown" size={12} />
      </MenuButton>
      <span className="topbar-divider" />
      <MenuButton label="Help" entries={helpEntries} className="icon-button help-button" minWidth={230}>
        <Icon name="help" size={16} />
      </MenuButton>
      <button
        type="button"
        className="text-button ai-button"
        data-on={ai.config && ai.config.provider !== 'off' && !ai.unavailable ? 'true' : undefined}
        data-tip="AI settings"
        aria-label={`AI settings: ${aiStatusLabel(ai.config, ai.unavailable)}`}
        onClick={onOpenAiSettings}
      >
        <Icon name="sparkle" size={14} />
        <span className="ai-button-label">{aiStatusLabel(ai.config, ai.unavailable)}</span>
      </button>
      <span className="topbar-divider" />
      <button type="button" className="text-button" data-tip="See the exported page at different widths" onClick={onPreview}>
        <Icon name="play" size={13} /> Preview
      </button>
      <MenuButton label="Export code" entries={exportEntries} className="button primary export-button" minWidth={240}>
        <Icon name="download" size={14} /> Export
      </MenuButton>
    </header>
  );
}
