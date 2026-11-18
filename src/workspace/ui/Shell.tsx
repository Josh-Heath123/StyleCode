import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Assistant } from '../../ai/assistant';
import { App } from '../../app/App';
import { AppNav } from '../../app/AppNav';
import { ShortcutsDialog, WORKSPACE_GROUPS } from '../../app/ShortcutsDialog';
import { isTypingTarget } from '../../canvas/Canvas';
import type { Camera } from '../../editor/camera';
import type { Editor } from '../../editor/editor';
import type { ProjectSession } from '../../persistence/session';
import { ErrorBoundary } from '../../ui/ErrorBoundary';
import type { WorkspaceInfo } from '../api';
import { parseRoute, routeHref, type Route } from '../routes';
import { WorkspaceInfoContext } from './chrome';
import { ClientsPage } from './ClientsPage';
import { CompanyPage } from './CompanyPage';
import { EngagementPage } from './EngagementPage';
import { SessionPage } from './SessionPage';
import { RecordPage } from './RecordPage';
import { ConsentPage } from './consent/ConsentPage';
import { SettingsPage } from './SettingsPage';
import { DesignHost } from './designs/DesignHost';
import { DesignEditorContext } from './designs/editorContext';
import { leaveCompanyDesign, openDesign } from './designs/companyDesign';
import { fitAllCamera } from '../../app/actions';

interface ShellProps {
  editor: Editor;
  assistant: Assistant;
  session: ProjectSession;
  initialCamera: Camera | null;
  /** The workspace server's data folder, or null when it isn't running. */
  info: WorkspaceInfo | null;
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/**
 * The whole app: the workspace pages, or the design editor. StyleCode opens
 * on the list of clients; without the workspace server it opens on the
 * editor and says, in one line, what client work needs (decision 4).
 */
export function Shell({ editor, assistant, session, initialCamera, info }: ShellProps) {
  const route = useRoute();
  const showEditor = route.page === 'editor' || info === null;
  // The editor's own designs, after an engagement's: the engagement's design is closed first (Phase 4, decision 4).
  const [leaving, setLeaving] = useState(false);
  const lastDesign = useRef<string | null>(null);
  if (route.page === 'design') lastDesign.current = routeHref(route);
  useEffect(() => {
    if (!showEditor || !openDesign()) return;
    let alive = true;
    setLeaving(true);
    leaveCompanyDesign(session)
      .then((camera) => {
        if (!alive) return;
        editor.setCamera(camera ?? fitAllCamera(editor));
        setLeaving(false);
      })
      .catch((error: Error) => {
        if (!alive) return;
        setLeaving(false);
        editor.notify(error.message, 'error');
        if (lastDesign.current) location.hash = lastDesign.current;
      });
    return () => {
      alive = false;
    };
  }, [showEditor, session, editor]);
  // "Clients" in the editor goes back to the workspace page last open.
  const lastWorkspace = useRef('#/');
  if (!showEditor && route.page !== 'design') lastWorkspace.current = routeHref(route);
  // The editor is mounted only while it shows, so its shortcuts don't act on workspace pages.
  // When it comes back, it keeps the view it had.
  const editorShown = useRef(false);
  const camera = editorShown.current ? editor.getState().camera : initialCamera;
  if (showEditor) editorShown.current = true;

  // On a design's route the editor shows too: its title, and its own shortcuts.
  const editorShows = showEditor || route.page === 'design';
  useEffect(() => {
    document.title = editorShows ? 'StyleCode' : 'StyleCode · Clients';
  }, [editorShows]);

  // On client pages, ? opens the keyboard shortcuts (the editor has its own).
  const [shortcuts, setShortcuts] = useState(false);
  useEffect(() => {
    if (editorShows) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if ((e.target as Element | null)?.closest?.('[role="dialog"], .menu')) return;
      e.preventDefault();
      setShortcuts(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorShows]);

  if (showEditor && (leaving || openDesign()))
    return (
      <div className="app-loading" role="status">
        Closing the design…
      </div>
    );
  if (showEditor || info === null) {
    return (
      <App
        editor={editor}
        assistant={assistant}
        session={session}
        initialCamera={camera}
        nav={<AppNav current="editor" workspaceHref={info ? lastWorkspace.current : null} />}
      />
    );
  }
  if (route.page === 'design')
    return (
      <WorkspaceInfoContext.Provider value={info}>
        <DesignEditorContext.Provider value={{ editor, session }}>
          <DesignHost
            key={`${route.companyId}/${route.designId}`}
            companyId={route.companyId}
            engagementId={route.engagementId}
            designId={route.designId}
            layerId={route.layerId ?? null}
            editor={editor}
            assistant={assistant}
            session={session}
          />
        </DesignEditorContext.Provider>
      </WorkspaceInfoContext.Provider>
    );
  return (
    <WorkspaceInfoContext.Provider value={info}>
      <DesignEditorContext.Provider value={{ editor, session }}>
        <div className="ws">
          <ErrorBoundary
            key={routeHref(route)}
            fallback={(error, reset) => (
              <div className="ws-crash" role="alert">
                <h1>This page hit a problem</h1>
                <p>What was saved is not affected. {error.message}</p>
                <button type="button" className="button" onClick={reset}>
                  Try again
                </button>
              </div>
            )}
          >
            {renderPage(route)}
          </ErrorBoundary>
          {shortcuts && <ShortcutsDialog groups={WORKSPACE_GROUPS} onClose={() => setShortcuts(false)} />}
          <footer className="ws-folder">
            Client data folder: <span className="ws-folder-path">{info.folder}</span>
          </footer>
        </div>
      </DesignEditorContext.Provider>
    </WorkspaceInfoContext.Provider>
  );
}

function renderPage(route: Route): ReactNode {
  switch (route.page) {
    case 'company':
      return <CompanyPage key={route.companyId} companyId={route.companyId} />;
    case 'engagement':
      return <EngagementPage key={route.companyId} companyId={route.companyId} engagementId={route.engagementId} />;
    case 'record':
      return <RecordPage key={route.companyId} companyId={route.companyId} engagementId={route.engagementId} />;
    case 'consent':
      return (
        <ConsentPage
          key={route.companyId}
          companyId={route.companyId}
          engagementId={route.engagementId}
          sessionId={route.sessionId}
        />
      );
    case 'session':
      return (
        <SessionPage
          key={route.companyId}
          companyId={route.companyId}
          engagementId={route.engagementId}
          sessionId={route.sessionId}
          passageId={route.passageId ?? null}
        />
      );
    case 'settings':
      return <SettingsPage />;
    default:
      return <ClientsPage />;
  }
}
