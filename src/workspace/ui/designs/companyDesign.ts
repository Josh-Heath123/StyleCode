import type { Camera } from '../../../editor/camera';
import { stripFindings } from '../../../model/commands';
import { createId } from '../../../model/ids';
import { parseProject, referencedAssets, toProjectFile } from '../../../model/serialize';
import type { DesignDocument } from '../../../model/types';
import { BROWSER_ASSETS, imageSize, type AssetRecord, type AssetSource } from '../../../persistence/assets';
import {
  createStarterDocument,
  DesignSaveError,
  type CompanyDesignTarget,
  type ProjectSession,
} from '../../../persistence/session';
import {
  createDesignFile,
  downloadDesignAsset,
  readDesignFile,
  saveDesignFile,
  uploadDesignAsset,
  WorkspaceApiError,
} from '../../api';
import { attachDesign, renameDesign } from '../../model/designs';
import type { DesignLink } from '../../model/types';
import { get } from '../../model/util';
import { ID_PREFIX } from '../../model/workspace';
import type { WorkspaceSession } from '../../session';
import { finalStep, now, step } from '../steps';
import { holdCompany, onCompanyClosed, reopenHeld } from '../useCompanySession';

/**
 * An engagement's design in the editor (Phase 4, decisions 1 to 5): its
 * images come from the client's folder and are held in this page's memory,
 * never in the browser's storage; it saves through the workspace API over the
 * revision it last read or wrote; its client stays open meanwhile, so the
 * design's name and the record stay in step; and if the client or the
 * engagement is deleted, the editor closes it without saving and says why.
 */

/** A client's images, read from and written to its folder, held in this page's memory while its design is open. */
export function companyAssets(companyId: string): AssetSource {
  const held = new Map<string, AssetRecord>();
  return {
    kind: 'company',
    async load(id) {
      const kept = held.get(id);
      if (kept) return kept;
      const blob = await downloadDesignAsset(companyId, id);
      if (!blob) return null;
      const size = await imageSize(blob).catch(() => ({ width: 300, height: 200 }));
      const record = { id, type: blob.type, blob, ...size };
      held.set(id, record);
      return record;
    },
    async store(record) {
      const stored = await uploadDesignAsset(companyId, new Blob([record.blob], { type: record.type }));
      if (stored.id !== record.id) throw new Error('The image changed on its way to the client’s folder. Try adding it again.');
      held.set(record.id, record);
    },
  };
}

/** A save target for one design, saving one at a time so each builds on the revision before it. */
function saveTarget(
  companyId: string,
  documentId: string,
  revision: string,
  onSaved: (doc: DesignDocument) => void,
): CompanyDesignTarget {
  let base = revision;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    documentId,
    assets: companyAssets(companyId),
    onSaved,
    save(file) {
      const run = queue.then(async () => {
        try {
          base = (await saveDesignFile(companyId, documentId, file, base)).revision;
        } catch (error) {
          if (error instanceof WorkspaceApiError) throw new DesignSaveError(error.message, error.retryable);
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

interface Open {
  companyId: string;
  designId: string;
  stop: () => void;
}
let open: Open | null = null;

/** The engagement's design open in the editor, if one is. */
export function openDesign(): { companyId: string; designId: string } | null {
  return open && { companyId: open.companyId, designId: open.designId };
}

/** Thrown when a design's file can't be opened: missing, damaged, or from a newer StyleCode (decision 7). */
export class DesignUnavailableError extends Error {}

/**
 * Opens an engagement's design in the editor. Its name follows the
 * document's: renaming either renames both (decision 5).
 */
export async function openCompanyDesign(
  session: ProjectSession,
  client: WorkspaceSession,
  companyId: string,
  link: DesignLink,
): Promise<void> {
  let read: { file: unknown; revision: string };
  try {
    read = await readDesignFile(companyId, link.documentId);
  } catch (error) {
    if (error instanceof WorkspaceApiError && (error.status === 404 || error.status === 422))
      throw new DesignUnavailableError(error.message);
    throw error;
  }
  const parsed = parseProject(read.file);
  if (!parsed.ok) throw new DesignUnavailableError(parsed.error);
  const syncName = (doc: DesignDocument) => {
    const current = get(client.getState().workspace.designs, link.id);
    if (current && !client.closed && !client.readOnly && current.name !== doc.name)
      step(client, 'Rename the design', (ws) => renameDesign(ws, link.id, doc.name));
  };
  const target = saveTarget(companyId, link.documentId, read.revision, syncName);
  // Set before opening: if another design replaces this one while it opens, it never starts watching.
  let stopWatching: (() => void) | null = null;
  let closedEarly = false;
  target.onClosed = () => {
    if (stopWatching) stopWatching();
    else closedEarly = true;
  };
  await session.openCompanyDesign(target, parsed.doc);
  if (closedEarly || session.companyDesign() !== link.documentId) return;
  syncName(parsed.doc);

  const letGo = holdCompany(client);
  const close = (why: string) => {
    if (open?.designId !== link.id) return;
    void session.leaveCompanyDesign(true, why);
  };
  const unsubscribe = client.subscribe(() => {
    const ws = client.getState().workspace;
    if (!get(ws.designs, link.id))
      close(
        get(ws.engagements, link.engagementId)
          ? 'The design was deleted, so it was closed without saving.'
          : 'The design’s engagement was deleted, so the design was closed without saving.',
      );
  });
  // A client closes when it is deleted, and when it is read again from disk: only the first closes the design.
  const offClosed = onCompanyClosed((closed) => {
    if (closed !== client) return;
    void reopenHeld(companyId)
      .then((again) => {
        if (again) again.letGo();
        else close('The design’s client was deleted, so the design was closed without saving.');
      })
      .catch(() => undefined);
  });
  let stopped = false;
  stopWatching = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    offClosed();
    letGo();
    if (open?.designId === link.id) open = null;
  };
  // However the editor lets the design go, the watching and the hold on its client stop with it (target.onClosed).
  open = { companyId, designId: link.id, stop: stopWatching };
}

/** Back to the editor's own designs, after the usual check that nothing unsaved would be lost. */
export function leaveCompanyDesign(session: ProjectSession): Promise<Camera | null> {
  return session.leaveCompanyDesign();
}

/**
 * Creates a design's file in the client's folder and attaches it to the
 * engagement, saved straight away so it can be opened: a new design
 * (decision 1), or a copy whose images are uploaded first (decision 3).
 */
async function attach(
  client: WorkspaceSession,
  companyId: string,
  engagementId: string,
  doc: DesignDocument,
): Promise<{ designId: string } | { error: string }> {
  await createDesignFile(companyId, doc.id, toProjectFile(doc));
  const designId = createId(ID_PREFIX.designs);
  const problem = await finalStep(client, 'Add a design', (ws) =>
    attachDesign(ws, { id: designId, engagementId, name: doc.name, documentId: doc.id }, now()),
  );
  return problem ? { error: problem } : { designId };
}

/** A new design: the editor's starter document, one desktop frame (decision 1). */
export function attachNewDesign(client: WorkspaceSession, companyId: string, engagementId: string, name: string) {
  const doc = { ...createStarterDocument(name.trim() || 'Untitled'), id: createId('doc') };
  return attach(client, companyId, engagementId, doc);
}

/**
 * A copy of one of the editor's own designs (decision 3): a new document id,
 * the original's name, its images uploaded into the client, and no links to
 * findings (they belong to the design they were made in). The original, in
 * this browser, is only read.
 */
export async function attachDesignCopy(
  client: WorkspaceSession,
  session: ProjectSession,
  companyId: string,
  engagementId: string,
  projectId: string,
): Promise<{ designId: string } | { error: string }> {
  const original = await session.readStoredProject(projectId);
  const parsed = parseProject(original);
  if (!parsed.ok) return { error: parsed.error };
  for (const id of referencedAssets(parsed.doc)) {
    const image = await BROWSER_ASSETS.load(id).catch(() => null);
    // A missing image stays missing: the copy shows its placeholder, as the original does.
    if (!image) continue;
    const stored = await uploadDesignAsset(companyId, new Blob([image.blob], { type: image.type }));
    if (stored.id !== id) return { error: 'An image changed on its way to the client’s folder. Try copying again.' };
  }
  const copy: DesignDocument = { ...stripFindings(parsed.doc), id: createId('doc') };
  return attach(client, companyId, engagementId, copy);
}
