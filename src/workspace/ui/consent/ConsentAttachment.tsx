import { useRef, useState } from 'react';
import { Icon } from '../../../ui/Icon';
import { downloadFile, uploadFile } from '../../api';
import { attachToConsent, formatSize, MAX_FILE_BYTES, removeConsentAttachment } from '../../model/files';
import type { ConsentRecord, Session } from '../../model/types';
import { get } from '../../model/util';
import type { ClientView } from '../ClientFrame';
import { formatWhen } from '../chrome';
import { saveAs } from '../download';
import { DeleteDialog } from '../fields';
import { finalStep, now, permanentStep } from '../steps';
import type { ConsentContext } from './useConsentContext';

/**
 * The consent record's one attachment, such as a signed form or an email
 * (Phase 2 brief, decision 12). Adding, replacing or removing it doesn't
 * change what the record says, so it keeps its confirmation (rule C3), and it
 * is allowed on a locked record. Each saves straight away and can't be undone,
 * like any file.
 */
export function ConsentAttachment({
  view,
  meeting,
  record,
  context,
}: {
  view: ClientView;
  meeting: Session;
  record: ConsentRecord;
  context: ConsentContext;
}) {
  const { session, readOnly } = view;
  const file = record.attachmentFileId ? get(view.workspace.files, record.attachmentFileId) : null;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const attach = async (picked: File) => {
    if (picked.size > MAX_FILE_BYTES)
      return setError(`${picked.name} is larger than the ${formatSize(MAX_FILE_BYTES)} a file may be.`);
    if (!context.consultant) return setError('Give your name in Settings first: a file records who added it.');
    setError(null);
    setBusy(`Attaching ${picked.name}…`);
    try {
      const stored = await uploadFile(session.companyId, picked);
      const problem = await finalStep(session, `Attach ${picked.name} to the consent record`, (ws) => {
        const result = attachToConsent(
          ws,
          meeting.id,
          { id: stored.id, name: picked.name, mediaType: picked.type, sizeBytes: stored.sizeBytes },
          context.consultant!,
          now(),
        );
        return result.ok ? { ok: true, value: result.value.workspace } : result;
      });
      if (problem) setError(problem);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const download = async () => {
    if (!file) return;
    setError(null);
    try {
      saveAs(file.name, await downloadFile(session.companyId, file.id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="ws-card" aria-labelledby="attachment-title">
      <div className="ws-card-head">
        <h2 id="attachment-title">Attachment</h2>
        {!readOnly && (
          <>
            <button type="button" className="button" disabled={busy !== null} onClick={() => input.current?.click()}>
              <Icon name="upload" size={14} /> {file ? 'Replace…' : 'Attach a file…'}
            </button>
            <input
              ref={input}
              type="file"
              hidden
              aria-label="Attachment file"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) void attach(picked);
              }}
            />
          </>
        )}
      </div>
      {file ? (
        <div className="ws-row is-static">
          <span className="ws-row-main">
            <span className="ws-row-title">{file.name}</span>
            <span className="ws-row-sub">
              {formatSize(file.sizeBytes)} · added by {file.addedBy}, {formatWhen(file.addedAt)}
            </span>
          </span>
          <button type="button" className="button" aria-label={`Download ${file.name}`} onClick={() => void download()}>
            <Icon name="download" size={14} /> Download
          </button>
          {!readOnly && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${file.name}`}
              data-tip="Remove"
              data-tip-side="left"
              onClick={() => setRemoving(true)}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
      ) : (
        <p className="ws-muted">No attachment.</p>
      )}
      {!readOnly && (
        <p className="ws-help">
          One file, such as a signed form or the client’s email. It doesn’t change what the record says, so the record stays
          confirmed. Attaching, replacing or removing it saves straight away and can’t be undone.
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
      {removing && file && (
        <DeleteDialog
          title="Remove the attachment…"
          onClose={() => setRemoving(false)}
          onDelete={async () => {
            await permanentStep(session, `Remove ${file.name} from the consent record`, (ws) => {
              const result = removeConsentAttachment(ws, meeting.id);
              return result.ok ? { ok: true, value: result.value.workspace } : result;
            });
            setRemoving(false);
          }}
          what={
            <>
              <p>
                This removes <strong>{file.name}</strong> ({formatSize(file.sizeBytes)}) from the consent record and from this
                client’s folder. The record itself doesn’t change.
              </p>
              <p>
                <strong>This can’t be undone,</strong> and the undo history is cleared.
              </p>
            </>
          }
        />
      )}
    </section>
  );
}
