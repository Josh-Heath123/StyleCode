import { useEffect, useState } from 'react';
import type { Assistant } from '../../../ai/assistant';
import { App } from '../../../app/App';
import { fitAllCamera, zoomToSelection } from '../../../app/actions';
import type { Editor } from '../../../editor/editor';
import type { ProjectSession } from '../../../persistence/session';
import { Icon } from '../../../ui/Icon';
import { downloadDesignFile } from '../../api';
import { get } from '../../model/util';
import type { WorkspaceSession } from '../../session';
import { Page, WorkspaceHeader } from '../chrome';
import { saveAs } from '../download';
import { useCompanySession } from '../useCompanySession';
import { DesignUnavailableError, openCompanyDesign, openDesign } from './companyDesign';

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
  const backHref = `#/c/${companyId}/e/${engagementId}`;

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
        requestAnimationFrame(() => zoomToSelection(editor));
      }
    };
    if (openDesign()?.designId === designId) return shown();
    setOpening({ state: 'opening' });
    openCompanyDesign(session, client, companyId, link)
      .then(() => {
        editor.setCamera(fitAllCamera(editor));
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
  return (
    <App
      key={`design-${designId}`}
      editor={editor}
      assistant={assistant}
      session={session}
      initialCamera={editor.getState().camera}
      company={{ backHref }}
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
