import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
import { ALT_KEY, fitAllCamera, zoomToSelection } from './actions';
import type { Assistant } from '../ai/assistant';
import { AssistantContext } from '../ai/react';
import { AiSettingsDialog } from './AiSettingsDialog';
import { DockArea } from './AssistantBar';
import { Notice } from './Notice';
import { Announcer } from './Announcer';
import { PanelBoundary } from '../ui/ErrorBoundary';
import { Icon } from '../ui/Icon';
import { Onboarding } from './onboardingState';
import { Checklist, useOnboardingState, WelcomeDialog } from './Onboarding';
import { ShortcutsDialog } from './ShortcutsDialog';
import { isTypingTarget } from '../canvas/Canvas';
import { ProjectsDialog } from './ProjectsDialog';
import { useShortcuts } from './shortcuts';
import { TopBar } from './TopBar';
import { RecordContext, type EngagementRecord } from './record';

interface AppProps {
  editor: Editor;
  assistant: Assistant;
  session: ProjectSession;
  initialCamera: Camera | null;
  /** Navigation between the workspace and the editor, shown in the top bar. */
  nav?: ReactNode;
  /** Whether the first view zooms to the selection, after framing (a layer's route, Phase 4 decision 8). */
  focusSelection?: boolean;
  /**
   * An engagement's design is open, kept in its client's folder (Phase 4,
   * decisions 1 and 4): the Designs menu offers only the way back and Download
   * as file, since the editor's own designs live in this browser.
   */
  company?: CompanyEditing;
}

export interface CompanyEditing {
  /** The engagement's page. */
  backHref: string;
  /** The engagement's record, shown beside the layers (decision 9). */
  record?: EngagementRecord;
}

export function App({ editor, assistant, session, initialCamera, nav, company, focusSelection }: AppProps) {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'design' | 'code'>('design');
  const [preview, setPreview] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [onboarding] = useState(() => new Onboarding());
  const { welcomed } = useOnboardingState(onboarding);
  const record = company?.record ?? null;
  const [recordShown, setRecordShown] = useState(true);
  useShortcuts(editor);

  /** Shows or hides the Record panel; shown from the keyboard, focus goes into it. */
  const toggleRecord = useCallback(
    (focus: boolean) => {
      // Into the panel when it shows. When it hides with focus inside it, to the layers beside it (or the canvas, when
      // the Insert tab is showing), so focus isn't lost with it; focus elsewhere stays where it is.
      const inPanel = !!document.activeElement?.closest('.panel-record');
      if (focus && !recordShown) requestAnimationFrame(() => document.getElementById('record-filter')?.focus());
      if (recordShown && inPanel)
        requestAnimationFrame(() =>
          (document.querySelector<HTMLElement>('[role="tree"]') ?? document.querySelector<HTMLElement>('.canvas'))?.focus(),
        );
      setRecordShown(!recordShown);
    },
    [recordShown],
  );

  // Alt+R shows or hides the record beside an engagement's design.
  useEffect(() => {
    if (!record) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyR') return;
      e.preventDefault();
      toggleRecord(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [record, toggleRecord]);

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

  // The canvas measures the viewport in its own layout effect, which runs first. The first view is set once: a later
  // render with another camera or selection (the client's workspace changing beside its design) never moves it.
  const viewSet = useRef(false);
  useLayoutEffect(() => {
    if (viewSet.current) return;
    viewSet.current = true;
    restoreCamera(initialCamera);
    if (focusSelection) zoomToSelection(editor);
  }, [restoreCamera, initialCamera, focusSelection, editor]);

  return (
    <EditorContext.Provider value={editor}>
      <AssistantContext.Provider value={assistant}>
        <RecordContext.Provider value={record}>
          <div className={`app${rightTab === 'code' ? ' is-code-open' : ''}${record && recordShown ? ' has-record' : ''}`}>
            <TopBar
              nav={nav}
              company={company}
              session={session}
              onOpenProjects={() => setProjectsOpen(true)}
              onCameraRestore={restoreCamera}
              onPreview={() => openPreview()}
              onOpenAiSettings={() => setAiSettingsOpen(true)}
              onboarding={onboarding}
              onOpenShortcuts={() => setShortcutsOpen(true)}
              recordShown={record ? recordShown : undefined}
              onToggleRecord={() => toggleRecord(true)}
            />
            <aside className="panel panel-left" aria-label="Layers and insert panel">
              <PanelBoundary name="Layers">
                <LeftPanel />
              </PanelBoundary>
            </aside>
            {record && recordShown && (
              <aside className="panel panel-record" aria-labelledby="record-panel-title">
                <div className="panel-title record-panel-title">
                  <h2 id="record-panel-title">Record</h2>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Hide the record"
                    data-tip={`Hide the record  ${ALT_KEY}+R`}
                    data-tip-side="left"
                    onClick={() => toggleRecord(true)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
                <PanelBoundary name="Record">{record.panel}</PanelBoundary>
              </aside>
            )}
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
            {!welcomed && !company && (
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
        </RecordContext.Provider>
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
