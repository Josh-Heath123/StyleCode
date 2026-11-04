import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Canvas } from '../canvas/Canvas';
import type { Camera } from '../editor/camera';
import type { Editor } from '../editor/editor';
import { EditorContext } from '../editor/react';
import { LayersPanel } from '../panels/LayersPanel';
import { InsertPanel } from '../panels/InsertPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
import { CodePanel } from '../panels/CodePanel';
import { listScreens, screenOf } from '../codegen/screen';
import { PreviewDialog } from './PreviewDialog';
import type { ProjectSession } from '../persistence/session';
import { fitAllCamera } from './actions';
import type { Assistant } from '../ai/assistant';
import { AssistantContext } from '../ai/react';
import { AiSettingsDialog } from './AiSettingsDialog';
import { DockArea } from './AssistantBar';
import { Notice } from './Notice';
import { Announcer } from './Announcer';
import { PanelBoundary } from '../ui/ErrorBoundary';
import { Onboarding } from './onboardingState';
import { Checklist, useOnboardingState, WelcomeDialog } from './Onboarding';
import { ShortcutsDialog } from './ShortcutsDialog';
import { isTypingTarget } from '../canvas/Canvas';
import { ProjectsDialog } from './ProjectsDialog';
import { useShortcuts } from './shortcuts';
import { TopBar } from './TopBar';

interface AppProps {
  editor: Editor;
  assistant: Assistant;
  session: ProjectSession;
  initialCamera: Camera | null;
}

export function App({ editor, assistant, session, initialCamera }: AppProps) {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'design' | 'code'>('design');
  const [preview, setPreview] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [onboarding] = useState(() => new Onboarding());
  const { welcomed } = useOnboardingState(onboarding);
  useShortcuts(editor);

  // The checklist ticks itself off as things are done.
  useEffect(() => onboarding.watch(editor), [onboarding, editor]);
  useEffect(() => {
    if (rightTab === 'code') onboarding.complete('code');
  }, [rightTab, onboarding]);
  useEffect(
    () =>
      assistant.subscribe(() => {
        // Done once the AI has come back with a change to review.
        if (assistant.getState().status === 'review') onboarding.complete('ai');
      }),
    [assistant, onboarding],
  );

  // ? opens the keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if ((e.target as Element | null)?.closest?.('[role="dialog"], .menu')) return;
      e.preventDefault();
      setShortcutsOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Previews the screen of the current selection, or the first screen. */
  const openPreview = useCallback(
    (screenId?: string) => {
      const { doc, selection } = editor.getState();
      const id = screenId ?? (selection[0] ? screenOf(doc, selection[0]) : null) ?? listScreens(doc)[0]?.id;
      if (id) setPreview(id);
      else editor.notify('Nothing to preview yet: each top-level frame becomes a page. Draw a frame with F.', 'error');
    },
    [editor],
  );

  /** Restores a project's saved view, or frames its content when it has none. */
  const restoreCamera = useCallback((camera: Camera | null) => editor.setCamera(camera ?? fitAllCamera(editor)), [editor]);

  // The canvas measures the viewport in its own layout effect, which runs first.
  useLayoutEffect(() => restoreCamera(initialCamera), [restoreCamera, initialCamera]);

  return (
    <EditorContext.Provider value={editor}>
      <AssistantContext.Provider value={assistant}>
        <div className={`app${rightTab === 'code' ? ' is-code-open' : ''}`}>
          <TopBar
            session={session}
            onOpenProjects={() => setProjectsOpen(true)}
            onCameraRestore={restoreCamera}
            onPreview={() => openPreview()}
            onOpenAiSettings={() => setAiSettingsOpen(true)}
            onboarding={onboarding}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
          <aside className="panel panel-left" aria-label="Layers and insert panel">
            <PanelBoundary name="Layers">
              <LeftPanel />
            </PanelBoundary>
          </aside>
          <main className="canvas-area" style={{ display: 'contents' }}>
            <Canvas />
          </main>
          <aside className="panel panel-right" aria-label="Design and code panel">
            <PanelTabs
              label="Inspector"
              tabs={[
                { id: 'design', label: 'Design' },
                { id: 'code', label: 'Code' },
              ]}
              value={rightTab}
              onChange={setRightTab}
            />
            <div className="panel-tabpanel" role="tabpanel" id={`tabpanel-${rightTab}`} aria-labelledby={`tab-${rightTab}`}>
              {rightTab === 'design' ? (
                <PanelBoundary key="design" name="Design">
                  <PropertiesPanel />
                </PanelBoundary>
              ) : (
                <PanelBoundary key="code" name="Code">
                  <CodePanel onPreview={openPreview} />
                </PanelBoundary>
              )}
            </div>
          </aside>
          <PanelBoundary name="Tools">
            <DockArea onOpenSettings={() => setAiSettingsOpen(true)} />
          </PanelBoundary>
          <Notice />
          <Announcer />
          {preview && (
            <PreviewDialog
              screenId={preview}
              onClose={() => setPreview(null)}
              onDevice={(device) => device === 'mobile' && onboarding.complete('preview')}
            />
          )}
          {projectsOpen && (
            <ProjectsDialog session={session} onClose={() => setProjectsOpen(false)} onCameraRestore={restoreCamera} />
          )}
          {aiSettingsOpen && <AiSettingsDialog onClose={() => setAiSettingsOpen(false)} />}
          {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
          <div className="canvas-corner">
            <Checklist onboarding={onboarding} />
          </div>
          {!welcomed && (
            <WelcomeDialog
              onboarding={onboarding}
              onOpenExample={async () => {
                try {
                  restoreCamera(await session.newExampleProject());
                } catch (error) {
                  editor.notify((error as Error).message, 'error');
                }
              }}
            />
          )}
        </div>
      </AssistantContext.Provider>
    </EditorContext.Provider>
  );
}

function PanelTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="panel-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`tabpanel-${t.id}`}
          className={`panel-tab${value === t.id ? ' is-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The left sidebar: the layer tree, or the library of things to insert. */
function LeftPanel() {
  const [tab, setTab] = useState<'layers' | 'insert'>('layers');
  return (
    <>
      <PanelTabs
        label="Sidebar"
        tabs={[
          { id: 'layers', label: 'Layers' },
          { id: 'insert', label: 'Insert' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="panel-tabpanel" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'layers' ? <LayersPanel /> : <InsertPanel />}
      </div>
    </>
  );
}
