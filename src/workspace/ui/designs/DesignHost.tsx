import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Assistant } from '../../../ai/assistant';
import { App } from '../../../app/App';
import { zoomToSelection } from '../../../app/actions';
import type { EngagementRecord } from '../../../app/record';
import type { Editor } from '../../../editor/editor';
import type { ProjectSession } from '../../../persistence/session';
import { Icon } from '../../../ui/Icon';
import { downloadDesignFile } from '../../api';
import { isInRecord } from '../../model/findings';
import { KIND_LABEL, STATUS_LABEL } from '../../model/labels';
import type { CompanyWorkspace } from '../../model/types';
import { get } from '../../model/util';
import { routeHref } from '../../routes';
import type { WorkspaceSession } from '../../session';
import { Page, WorkspaceHeader } from '../chrome';
import { saveAs } from '../download';
import { useCompanySession } from '../useCompanySession';
import { DesignUnavailableError, openCompanyDesign, openDesign } from './companyDesign';
import { RecordPanel } from './RecordPanel';

type Opening = { state: 'opening' } | { state: 'open' } | { state: 'problem'; title: string; message: string; download: boolean };

/**
 * The editor on an engagement's design (`#/c/<client>/e/<engagement>/d/<design>`,
 * Phase 4 decisions 1, 4, 7 and 8): the client opens, its design loads from
 * the client's folder, and the top bar leads back to the engagement. A
 * design that isn't this engagement's, can't be read, or belongs to a client
 * that opens read-only isn't opened: the page says why, with a Download of
 * its file as it is.
 */
export function DesignHost({
  companyId,
  engagementId,
  designId,
  layerId,
  editor,
  assistant,
  session,
}: {
  companyId: string;
  engagementId: string;
  designId: string;
  layerId: string | null;
  editor: Editor;
  assistant: Assistant;
  session: ProjectSession;
}) {
  const [load] = useCompanySession(companyId);
  const client = load.state === 'open' ? load.session : null;
  const [opening, setOpening] = useState<Opening>({ state: 'opening' });
  // A design just read from the client's folder is framed by the editor once its canvas has measured itself;
  // one already open keeps the view it has.
  const justOpened = useRef(false);
  // Whether the editor is showing: a layer route then zooms to its layer at once, rather than with the first view.
  const shownOnce = useRef(false);
  const backHref = `#/c/${companyId}/e/${engagementId}`;
  const workspace = useClientWorkspace(client);
  const record = useMemo<EngagementRecord | null>(
    () =>
      client && workspace
        ? {
            describe: (findingId) => describeFinding(workspace, companyId, engagementId, findingId),
            panel: <RecordPanel client={client} companyId={companyId} engagementId={engagementId} />,
          }
        : null,
    [client, workspace, companyId, engagementId],
  );

  useEffect(() => {
    if (!client) return;
    let alive = true;
    const ws = client.getState().workspace;
    const link = get(ws.designs, designId);
    if (!link || link.engagementId !== engagementId) {
      setOpening({
        state: 'problem',
        title: 'There is no such design here',
        message: 'It may have been deleted, or it belongs to another engagement.',
        download: false,
      });
      return;
    }
    if (client.readOnly) {
      setOpening({
        state: 'problem',
        title: `“${link.name}” can’t be opened`,
        message: 'This client opens read-only, so its designs aren’t opened or saved until its file is put right.',
        download: true,
      });
      return;
    }
    const shown = () => {
      if (!alive) return;
      setOpening({ state: 'open' });
      if (layerId && editor.getState().doc.nodes[layerId]) {
        editor.select([layerId]);
        // The editor zooms to it with its first view (focusSelection); if it is showing already, now.
        if (shownOnce.current) requestAnimationFrame(() => zoomToSelection(editor));
      }
    };
    const loaded = openDesign();
    if (loaded?.companyId === companyId && loaded.designId === designId) return shown();
    setOpening({ state: 'opening' });
    openCompanyDesign(session, client, companyId, link)
      .then(() => {
        justOpened.current = true;
        shown();
      })
      .catch((error: Error) => {
        if (!alive) return;
        setOpening({
          state: 'problem',
          title: `“${link.name}” can’t be opened`,
          message: error.message,
          download: error instanceof DesignUnavailableError,
        });
      });
    return () => {
      alive = false;
    };
  }, [client, companyId, engagementId, designId, layerId, editor, session]);

  if (load.state === 'failed' || opening.state !== 'open') {
    const problem =
      load.state === 'failed'
        ? {
            title: 'This client can’t be opened',
            message: load.status === 404 ? 'There is no client here. It may have been deleted.' : load.error,
            download: false,
          }
        : opening.state === 'problem'
          ? opening
          : null;
    return (
      <>
        <WorkspaceHeader />
        <Page
          title={problem ? problem.title : 'Opening the design…'}
          crumbs={[
            { label: 'Clients', href: '#/' },
            { label: 'Client', href: `#/c/${companyId}` },
            { label: 'Engagement', href: backHref },
            { label: 'Design' },
          ]}
        >
          {problem && (
            <div className="ws-alert" role="alert">
              <p>{problem.message}</p>
              <a className="button" href={backHref}>
                Back to the engagement
              </a>
              {problem.download && client && <DownloadButton client={client} companyId={companyId} designId={designId} />}
            </div>
          )}
        </Page>
      </>
    );
  }

  const ws = client!.getState().workspace;
  shownOnce.current = true;
  return (
    <App
      key={`design-${designId}`}
      editor={editor}
      assistant={assistant}
      session={session}
      initialCamera={justOpened.current ? null : editor.getState().camera}
      focusSelection={!!layerId}
      company={{ backHref, record: record ?? undefined }}
      nav={
        <nav className="app-nav" aria-label="Design">
          <a className="app-nav-link" href={backHref}>
            <Icon name="chevronLeft" size={14} /> Back to the engagement
          </a>
          <span className="app-nav-note">
            {ws.company.name} › {get(ws.engagements, engagementId)?.name ?? 'Engagement'}
          </span>
        </nav>
      }
    />
  );
}

/** The client's workspace as it changes, or null while the client isn't open. */
function useClientWorkspace(client: WorkspaceSession | null): CompanyWorkspace | null {
  const state = useSyncExternalStore(client?.subscribe ?? noSubscribe, () => client?.getState() ?? null);
  return state?.workspace ?? null;
}
const noSubscribe = () => () => {};

/** A finding linked from a layer, as the editor shows it; null if it is no longer in this engagement's record. */
function describeFinding(ws: CompanyWorkspace, companyId: string, engagementId: string, findingId: string) {
  const f = get(ws.findings, findingId);
  if (!f || f.engagementId !== engagementId || !isInRecord(f)) return null;
  return {
    id: f.id,
    statement: f.statement,
    kind: KIND_LABEL[f.kind],
    status: STATUS_LABEL[f.status],
    statusKey: f.status,
    href: routeHref({ page: 'record', companyId, engagementId, findingId: f.id }),
  };
}

function DownloadButton({ client, companyId, designId }: { client: WorkspaceSession; companyId: string; designId: string }) {
  const [error, setError] = useState<string | null>(null);
  const link = get(client.getState().workspace.designs, designId);
  if (!link) return null;
  return (
    <>
      <button
        type="button"
        className="button"
        onClick={async () => {
          try {
            saveAs(
              `${link.name.replace(/[^\w-]+/g, '-').slice(0, 60) || 'design'}.stylecode.json`,
              await downloadDesignFile(companyId, link.documentId),
            );
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Download
      </button>
      {error && <p className="ws-error">{error}</p>}
    </>
  );
}
