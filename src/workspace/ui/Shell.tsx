import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Assistant } from '../../ai/assistant';
import { App } from '../../app/App';
import { AppNav } from '../../app/AppNav';
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
import { SettingsPage } from './SettingsPage';

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
  // "Clients" in the editor goes back to the workspace page last open.
  const lastWorkspace = useRef('#/');
  if (!showEditor) lastWorkspace.current = routeHref(route);
  // The editor is mounted only while it shows, so its shortcuts don't act on workspace pages.
  // When it comes back, it keeps the view it had.
  const editorShown = useRef(false);
  const camera = editorShown.current ? editor.getState().camera : initialCamera;
  if (showEditor) editorShown.current = true;

  useEffect(() => {
    document.title = showEditor ? 'StyleCode' : 'StyleCode · Clients';
  }, [showEditor]);

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
  return (
    <WorkspaceInfoContext.Provider value={info}>
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
        <footer className="ws-folder">
          Client data folder: <span className="ws-folder-path">{info.folder}</span>
        </footer>
      </div>
    </WorkspaceInfoContext.Provider>
  );
}

function renderPage(route: Route): ReactNode {
  switch (route.page) {
    case 'company':
      return <CompanyPage key={route.companyId} companyId={route.companyId} />;
    case 'engagement':
      return <EngagementPage key={route.companyId} companyId={route.companyId} engagementId={route.engagementId} />;
    case 'session':
      return (
        <SessionPage
          key={route.companyId}
          companyId={route.companyId}
          engagementId={route.engagementId}
          sessionId={route.sessionId}
        />
      );
    case 'settings':
      return <SettingsPage />;
    default:
      return <ClientsPage />;
  }
}
