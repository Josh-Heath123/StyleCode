import { useCallback, useLayoutEffect, useState } from 'react';
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
import { Dock } from './Dock';
import { Notice } from './Notice';
import { ProjectsDialog } from './ProjectsDialog';
import { useShortcuts } from './shortcuts';
import { TopBar } from './TopBar';

interface AppProps {
  editor: Editor;
  session: ProjectSession;
  initialCamera: Camera | null;
}

export function App({ editor, session, initialCamera }: AppProps) {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'design' | 'code'>('design');
  const [preview, setPreview] = useState<string | null>(null);
  useShortcuts(editor);

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
      <div className={`app${rightTab === 'code' ? ' is-code-open' : ''}`}>
        <TopBar
          session={session}
          onOpenProjects={() => setProjectsOpen(true)}
          onCameraRestore={restoreCamera}
          onPreview={() => openPreview()}
        />
        <aside className="panel panel-left" aria-label="Layers and insert panel">
          <LeftPanel />
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
            {rightTab === 'design' ? <PropertiesPanel /> : <CodePanel onPreview={openPreview} />}
          </div>
        </aside>
        <DockSlot />
        <Notice />
        {preview && <PreviewDialog screenId={preview} onClose={() => setPreview(null)} />}
        {projectsOpen && (
          <ProjectsDialog session={session} onClose={() => setProjectsOpen(false)} onCameraRestore={restoreCamera} />
        )}
      </div>
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

/** The dock floats over the canvas area, centred within it rather than the window. */
function DockSlot() {
  return (
    <div className="dock-slot">
      <Dock />
    </div>
  );
}
