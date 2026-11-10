/**
 * Documents attached to a company or an engagement (MVP Q2). The bytes are
 * stored by the local server under the file's id; the workspace lists each
 * file as a FileRef. Nothing reads a file's contents.
 *
 * Adding and removing a file are both permanent (Phase 1 brief, decision 7,
 * and the user's WP10 decision): each saves straight away and clears the
 * undo history, so no undo or redo can drop a file's entry, which would
 * have the server delete its bytes.
 */
import { consentFor } from './consent.ts';
import type { CompanyWorkspace, FileOwner, FileRef, Timestamp } from './types.ts';
import { fail, get, isNonEmptyText, isValidId, ok, type Result } from './util.ts';

/** The largest file the server takes (server/workspace/handler.ts, MAX_FILE_BYTES). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface NewFile {
  /** The id the server stored the bytes under. */
  id: string;
  owner: Extract<FileOwner, { kind: 'company' } | { kind: 'engagement' }>;
  name: string;
  mediaType: string;
  sizeBytes: number;
}

/** Lists an uploaded document on a company or an engagement. */
export function addFileRef(ws: CompanyWorkspace, file: NewFile, addedBy: string, at: Timestamp): Result<CompanyWorkspace> {
  if (!isValidId(file.id) || get(ws.files, file.id)) return fail('The file can’t be added: its id is missing or already used.');
  if (file.owner.kind === 'engagement' && !get(ws.engagements, file.owner.engagementId))
    return fail('The engagement does not exist.');
  if (!isNonEmptyText(file.name)) return fail('A file needs a name.');
  if (!isNonEmptyText(addedBy)) return fail('Give your name in Settings first: a file records who added it.');
  const ref: FileRef = {
    id: file.id,
    owner: file.owner,
    purpose: 'document',
    name: file.name.trim(),
    mediaType: file.mediaType.trim() || 'application/octet-stream',
    sizeBytes: file.sizeBytes,
    addedBy: addedBy.trim(),
    addedAt: at,
  };
  return ok({ ...ws, files: { ...ws.files, [ref.id]: ref } });
}

/** Removes a file's entry; the server deletes its bytes when the save is written. */
export function removeFileRef(ws: CompanyWorkspace, fileId: string): Result<CompanyWorkspace> {
  const file = get(ws.files, fileId);
  if (!file) return fail('The file does not exist.');
  if (Object.values(ws.consents).some((c) => c.attachmentFileId === fileId))
    return fail('This file is attached to a consent record, so it stays with the record.');
  if (Object.values(ws.sessions).some((s) => s.audioFileIds.includes(fileId))) return fail('This file is a session’s recording.');
  const files = { ...ws.files };
  delete files[fileId];
  return ok({ ...ws, files });
}

/**
 * Attaches a file to a session's consent record, such as a signed form or an
 * email (Phase 2 brief, decision 12). A record has one attachment, so a new
 * one replaces the old, whose entry goes and whose bytes the server deletes
 * when the save is written. Attaching doesn't change what the record says, so
 * it keeps its confirmation (rule C3), and it is allowed on a locked record.
 * Like adding any file, it is permanent.
 */
export function attachToConsent(
  ws: CompanyWorkspace,
  sessionId: string,
  file: Omit<NewFile, 'owner'>,
  addedBy: string,
  at: Timestamp,
): Result<{ workspace: CompanyWorkspace; replacedFileId: string | null }> {
  const record = consentFor(ws, sessionId);
  if (!record) return fail('Fill in the consent form for this session first.');
  if (!isValidId(file.id) || get(ws.files, file.id)) return fail('The file can’t be added: its id is missing or already used.');
  if (!isNonEmptyText(file.name)) return fail('A file needs a name.');
  if (!isNonEmptyText(addedBy)) return fail('Give your name in Settings first: a file records who added it.');
  const ref: FileRef = {
    id: file.id,
    owner: { kind: 'session', sessionId },
    purpose: 'consent-attachment',
    name: file.name.trim(),
    mediaType: file.mediaType.trim() || 'application/octet-stream',
    sizeBytes: file.sizeBytes,
    addedBy: addedBy.trim(),
    addedAt: at,
  };
  const replacedFileId = record.attachmentFileId;
  const files = { ...ws.files, [ref.id]: ref };
  if (replacedFileId) delete files[replacedFileId];
  return ok({
    workspace: { ...ws, files, consents: { ...ws.consents, [record.id]: { ...record, attachmentFileId: ref.id } } },
    replacedFileId,
  });
}

/** Removes a consent record's attachment (decision 12). The record keeps its confirmation; removing is permanent. */
export function removeConsentAttachment(
  ws: CompanyWorkspace,
  sessionId: string,
): Result<{ workspace: CompanyWorkspace; removedFileId: string }> {
  const record = consentFor(ws, sessionId);
  const fileId = record?.attachmentFileId;
  if (!record || !fileId) return fail('The consent record has no attachment.');
  const files = { ...ws.files };
  delete files[fileId];
  return ok({
    workspace: { ...ws, files, consents: { ...ws.consents, [record.id]: { ...record, attachmentFileId: null } } },
    removedFileId: fileId,
  });
}

/** The documents of a company (its own, not its engagements') or of one engagement, newest first. */
export function filesOf(ws: CompanyWorkspace, owner: NewFile['owner']): FileRef[] {
  return Object.values(ws.files)
    .filter(
      (f) =>
        f.purpose === 'document' &&
        (owner.kind === 'company'
          ? f.owner.kind === 'company'
          : f.owner.kind === 'engagement' && f.owner.engagementId === owner.engagementId),
    )
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.name.localeCompare(b.name));
}

/** A size as people read it: "820 bytes", "14 KB", "3.2 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
