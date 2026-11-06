import { useRef, useState } from 'react';
import { Icon } from '../../ui/Icon';
import { downloadFile, uploadFile } from '../api';
import { addFileRef, filesOf, formatSize, MAX_FILE_BYTES, removeFileRef, type NewFile } from '../model/files';
import type { FileRef } from '../model/types';
import type { ClientView } from './ClientFrame';
import { count, formatWhen } from './chrome';
import { DeleteDialog, DialogField, FormDialog } from './fields';
import { now, permanentStep, step } from './steps';
import { saveAs } from './download';
import { useConsultant } from './useConsultant';

/**
 * Documents on a company or an engagement (MVP Q2; Phase 1 brief, WP10).
 * Adding and removing are permanent: each saves straight away and clears the
 * undo history, so no undo can drop a file's entry and with it its bytes.
 * Download saves the file; it never opens inside StyleCode.
 */
export function FilesCard({ view, owner }: { view: ClientView; owner: NewFile['owner'] }) {
  const { workspace, readOnly, session } = view;
  const files = filesOf(workspace, owner);
  const consultant = useConsultant();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<FileRef | null>(null);
  const [askName, setAskName] = useState<File | null>(null);
  const companyId = session.companyId;

  /** Saves straight away, and says if that failed. */
  const saveNow = async () => {
    await session.saveNow();
    const state = session.getState();
    return state.status === 'error' ? (state.error ?? 'The change couldn’t be saved.') : null;
  };

  const add = async (file: File, by: string) => {
    if (file.size > MAX_FILE_BYTES)
      return setError(`${file.name} is larger than the ${formatSize(MAX_FILE_BYTES)} a file may be.`);
    setError(null);
    setBusy(`Adding ${file.name}…`);
    try {
      const stored = await uploadFile(companyId, file);
      const problem = step(
        session,
        `Add ${file.name}`,
        (ws) =>
          addFileRef(ws, { id: stored.id, owner, name: file.name, mediaType: file.type, sizeBytes: stored.sizeBytes }, by, now()),
        { final: true },
      );
      setError(problem ?? (await saveNow()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const download = async (file: FileRef) => {
    setError(null);
    try {
      saveAs(file.name, await downloadFile(companyId, file.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="ws-card" aria-labelledby={`files-title-${owner.kind}`}>
      <div className="ws-card-head">
        <h2 id={`files-title-${owner.kind}`}>Files</h2>
        {!readOnly && (
          <>
            <button type="button" className="button" disabled={busy !== null} onClick={() => input.current?.click()}>
              <Icon name="upload" size={14} /> Add file…
            </button>
            <input
              ref={input}
              type="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (consultant.name) void add(file, consultant.name);
                else setAskName(file);
              }}
            />
          </>
        )}
      </div>
      {!readOnly && (
        <p className="ws-help">
          Adding or removing a file saves straight away and can’t be undone. StyleCode keeps the file in this client’s folder and
          never opens it.
        </p>
      )}
      {busy && (
        <p className="ws-muted" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
      {files.length === 0 ? (
        <p className="ws-muted">
          No files yet.
          {!readOnly &&
            ` Add documents ${owner.kind === 'company' ? 'about this client' : 'for this engagement'}, such as a brief or a contract.`}
        </p>
      ) : (
        <ul className="ws-list is-compact" aria-label="Files">
          {files.map((f) => (
            <li key={f.id} className="ws-row is-static">
              <span className="ws-row-main">
                <span className="ws-row-title">{f.name}</span>
                <span className="ws-row-sub">
                  {formatSize(f.sizeBytes)} · added by {f.addedBy}, {formatWhen(f.addedAt)}
                </span>
              </span>
              <button type="button" className="button" aria-label={`Download ${f.name}`} onClick={() => void download(f)}>
                <Icon name="download" size={14} /> Download
              </button>
              {!readOnly && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${f.name}`}
                  data-tip="Remove"
                  data-tip-side="left"
                  onClick={() => setRemoving(f)}
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && <p className="ws-help">{count(files.length, 'file')}</p>}
      {removing && (
        <DeleteDialog
          title="Remove file…"
          onClose={() => setRemoving(null)}
          onDelete={async () => {
            await permanentStep(session, `Remove ${removing.name}`, (ws) => removeFileRef(ws, removing.id));
            setRemoving(null);
          }}
          what={
            <>
              <p>
                This removes <strong>{removing.name}</strong> ({formatSize(removing.sizeBytes)}) from this client’s folder.
              </p>
              <p>
                <strong>This can’t be undone,</strong> and the undo history is cleared. Copies you downloaded earlier aren’t
                affected.
              </p>
            </>
          }
        />
      )}
      {askName && (
        <NameDialog
          file={askName}
          onClose={() => setAskName(null)}
          onName={async (name) => add(askName, await consultant.save(name))}
        />
      )}
    </section>
  );
}

/** The first time a file is added without a name in settings: ask for it once. */
function NameDialog({ file, onName, onClose }: { file: File; onName: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title="Your name"
      submitLabel="Add the file"
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        if (!name.trim()) return setError('Give your name: a file records who added it.');
        onClose();
        await onName(name);
      }}
    >
      <p className="ws-dialog-text">
        {file.name} will record who added it. Your name is kept in settings, so this is asked only once.
      </p>
      <DialogField label="Your name">
        {(id) => <input id={id} className="ws-input" value={name} onChange={(e) => setName(e.target.value)} />}
      </DialogField>
    </FormDialog>
  );
}
