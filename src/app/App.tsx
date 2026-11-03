import { useCallback, useLayoutEffect, useState } from 'react';
import { Canvas } from '../canvas/Canvas';
import type { Camera } from '../editor/camera';
import type { Editor } from '../editor/editor';
import { EditorContext } from '../editor/react';
import { LayersPanel } from '../panels/LayersPanel';
import { PropertiesPanel } from '../panels/PropertiesPanel';
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
  useShortcuts(editor);

  /** Restores a project's saved view, or frames its content when it has none. */
  const restoreCamera = useCallback((camera: Camera | null) => editor.setCamera(camera ?? fitAllCamera(editor)), [editor]);

  // The canvas measures the viewport in its own layout effect, which runs first.
  useLayoutEffect(() => restoreCamera(initialCamera), [restoreCamera, initialCamera]);

  return (
    <EditorContext.Provider value={editor}>
      <div className="app">
        <TopBar session={session} onOpenProjects={() => setProjectsOpen(true)} onCameraRestore={restoreCamera} />
        <aside className="panel panel-left" aria-label="Layers panel">
          <LayersPanel />
        </aside>
        <main className="canvas-area" style={{ display: 'contents' }}>
          <Canvas />
        </main>
        <aside className="panel panel-right" aria-label="Properties panel">
          <PropertiesPanel />
        </aside>
        <DockSlot />
        <Notice />
        {projectsOpen && (
          <ProjectsDialog session={session} onClose={() => setProjectsOpen(false)} onCameraRestore={restoreCamera} />
        )}
      </div>
    </EditorContext.Provider>
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
