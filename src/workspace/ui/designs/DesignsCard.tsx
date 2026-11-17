import { useEffect, useState } from 'react';
import { parseProject } from '../../../model/serialize';
import type { ProjectSummary } from '../../../persistence/session';
import { Icon } from '../../../ui/Icon';
import { downloadDesignFile, listDesigns, readDesignFile, saveDesignFile, type DesignSummary } from '../../api';
import { designsOf, removeDesign, renameDesign } from '../../model/designs';
import type { DesignLink, Engagement } from '../../model/types';
import type { ClientView } from '../ClientFrame';
import { formatWhen } from '../chrome';
import { saveAs } from '../download';
import { DeleteDialog, DialogField, FormDialog } from '../fields';
import { permanentStep, step } from '../steps';
import { attachDesignCopy, attachNewDesign, openDesign } from './companyDesign';
import { useDesignEditor } from './editorContext';

type Dialog =
  { kind: 'new' } | { kind: 'copy' } | { kind: 'rename'; design: DesignLink } | { kind: 'delete'; design: DesignLink };

/**
 * An engagement's designs (MVP story 9.1; Phase 4, decisions 1, 3, 5, 6 and
 * 7): a new one, or a copy of one of the editor's own designs; each opens in
 * the editor, and can be renamed or deleted. A design that can't be opened,
 * or any design of a client that opens read-only, is listed with the reason
 * and a Download of its file as it is.
 */
export function DesignsCard({ view, engagement }: { view: ClientView; engagement: Engagement }) {
  const companyId = view.session.companyId;
  const designs = designsOf(view.workspace, engagement.id);
  const [files, setFiles] = useState<Map<string, DesignSummary> | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listed = designs.map((d) => d.documentId).join(',');

  useEffect(() => {
    let alive = true;
    void listDesigns(companyId)
      .then((list) => alive && setFiles(new Map(list.map((d) => [d.documentId, d]))))
      .catch(() => alive && setFiles(new Map()));
    return () => {
      alive = false;
    };
  }, [companyId, listed]);

  const href = (d: DesignLink) => `#/c/${companyId}/e/${engagement.id}/d/${d.id}`;
  const download = async (d: DesignLink) => {
    try {
      saveAs(
        `${d.name.replace(/[^\w-]+/g, '-').slice(0, 60) || 'design'}.stylecode.json`,
        await downloadDesignFile(companyId, d.documentId),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="ws-card" aria-labelledby="designs-title">
      <div className="ws-card-head">
        <h2 id="designs-title">Designs</h2>
        {!view.readOnly && (
          <div className="ws-actions">
            <button type="button" className="button" onClick={() => setDialog({ kind: 'copy' })}>
              Copy one of the editor’s designs…
            </button>
            <button type="button" className="button primary" onClick={() => setDialog({ kind: 'new' })}>
              <Icon name="plus" size={14} /> New design
            </button>
          </div>
        )}
      </div>
      {error && (
        <p className="ws-error" role="alert">
          {error}
        </p>
      )}
      {designs.length === 0 ? (
        <p className="ws-help">
          No designs yet. Sketch the client’s screens here: they’re kept in the client’s folder, with their images.
        </p>
      ) : (
        <ul className="ws-list is-compact" aria-label="Designs">
          {designs.map((d) => {
            const problem = view.readOnly
              ? 'This client opens read-only, so its designs can’t be opened until its file is put right.'
              : (files?.get(d.documentId)?.problem ?? null);
            return (
              <li key={d.id} className="ws-row is-static">
                <span className="ws-row-main">
                  <span className="ws-row-title">{d.name}</span>
                  <span className="ws-row-sub">
                    {problem ? (
                      <span className="ws-caution">Can’t be opened: {problem}</span>
                    ) : (
                      `Added ${formatWhen(d.createdAt)}`
                    )}
                  </span>
                </span>
                <span className="ws-actions">
                  {problem ? (
                    <button type="button" className="button" onClick={() => void download(d)} aria-label={`Download “${d.name}”`}>
                      Download
                    </button>
                  ) : (
                    <a className="button" href={href(d)} aria-label={`Open “${d.name}”`}>
                      Open
                    </a>
                  )}
                  {!view.readOnly && (
                    <>
                      <button
                        type="button"
                        className="button"
                        onClick={() => setDialog({ kind: 'rename', design: d })}
                        aria-label={`Rename “${d.name}”`}
                      >
                        Rename…
                      </button>
                      <button
                        type="button"
                        className="button danger"
                        onClick={() => setDialog({ kind: 'delete', design: d })}
                        aria-label={`Delete “${d.name}”`}
                      >
                        Delete…
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {dialog?.kind === 'new' && <NewDesignDialog view={view} engagement={engagement} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'copy' && <CopyDesignDialog view={view} engagement={engagement} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'rename' && <RenameDesignDialog view={view} design={dialog.design} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <DeleteDialog
          title="Delete design…"
          what={
            <>
              <p>
                This deletes the design <strong>{dialog.design.name}</strong> from the client’s folder, with its images that no
                other design of the client uses.
              </p>
              <p>
                <strong>This can’t be undone,</strong> and the undo history is cleared.
              </p>
            </>
          }
          onDelete={async () => {
            await permanentStep(view.session, 'Delete a design', (ws) => removeDesign(ws, dialog.design.id));
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

/** A new design: the editor's starter document, opened straight away (decision 1). */
function NewDesignDialog({ view, engagement, onClose }: { view: ClientView; engagement: Engagement; onClose: () => void }) {
  const [name, setName] = useState('Untitled');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title="New design"
      submitLabel="Create and open"
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        if (!name.trim()) return setError('Give the design a name.');
        try {
          const made = await attachNewDesign(view.session, view.session.companyId, engagement.id, name);
          if ('error' in made) return setError(made.error);
          location.hash = `#/c/${view.session.companyId}/e/${engagement.id}/d/${made.designId}`;
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <DialogField label="Name">
        {(id) => <input id={id} className="ws-input" value={name} onChange={(e) => setName(e.target.value)} />}
      </DialogField>
      <p className="ws-help">It starts with one desktop frame, and is kept in {view.workspace.company.name}’s folder.</p>
    </FormDialog>
  );
}

/**
 * Copies one of the editor's own designs into the engagement (decision 3):
 * the copy gets a new id and its images; the original, in this browser,
 * doesn't change.
 */
function CopyDesignDialog({ view, engagement, onClose }: { view: ClientView; engagement: Engagement; onClose: () => void }) {
  const { session } = useDesignEditor();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void session
      .listProjects()
      .then((list) => {
        if (!alive) return;
        setProjects(list);
        setChosen(list.find((p) => !p.problem)?.id ?? null);
      })
      .catch((e: Error) => alive && setError(`The editor’s designs couldn’t be read: ${e.message}`));
    return () => {
      alive = false;
    };
  }, [session]);
  return (
    <FormDialog
      title="Copy one of the editor’s designs"
      submitLabel="Copy into this engagement"
      submitDisabled={!chosen}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        if (!chosen) return;
        try {
          const made = await attachDesignCopy(view.session, session, view.session.companyId, engagement.id, chosen);
          if ('error' in made) return setError(made.error);
          location.hash = `#/c/${view.session.companyId}/e/${engagement.id}/d/${made.designId}`;
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <p className="ws-dialog-text">
        The copy goes into {view.workspace.company.name}’s folder with its images, under a new id. The original stays in this
        browser, unchanged, and the two don’t follow each other afterwards.
      </p>
      {projects === null ? (
        <p className="ws-muted">Reading the editor’s designs…</p>
      ) : projects.length === 0 ? (
        <p className="ws-help">The editor has no designs of its own in this browser yet.</p>
      ) : (
        <fieldset className="ws-choices">
          <legend className="ws-label">The editor’s designs</legend>
          {projects.map((p) => (
            <label key={p.id} className="ws-choice">
              <input
                type="radio"
                name="copy-design"
                value={p.id}
                checked={chosen === p.id}
                disabled={!!p.problem}
                onChange={() => setChosen(p.id)}
              />
              <span>
                {p.name}
                <span className="ws-muted">
                  {' '}
                  · {p.problem ? `can’t be copied: ${p.problem}` : `changed ${formatWhen(new Date(p.updatedAt).toISOString())}`}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </FormDialog>
  );
}

/** One name for a design: renaming here renames its document too (decision 5). */
function RenameDesignDialog({ view, design, onClose }: { view: ClientView; design: DesignLink; onClose: () => void }) {
  const { editor } = useDesignEditor();
  const [name, setName] = useState(design.name);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title="Rename design"
      submitLabel="Rename"
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        const trimmed = name.trim();
        if (!trimmed) return setError('Give the design a name.');
        if (trimmed === design.name) return onClose();
        try {
          if (openDesign()?.designId === design.id) {
            // Open in the editor: its next save renames the design here too.
            editor.renameDocument(trimmed);
          } else {
            const companyId = view.session.companyId;
            const read = await readDesignFile(companyId, design.documentId);
            const parsed = parseProject(read.file);
            if (!parsed.ok) return setError(parsed.error);
            const file = { ...(read.file as Record<string, unknown>), document: { ...parsed.doc, name: trimmed } };
            await saveDesignFile(companyId, design.documentId, file, read.revision);
          }
          const problem = step(view.session, 'Rename the design', (ws) => renameDesign(ws, design.id, trimmed));
          if (problem && problem !== 'Nothing was changed.') return setError(problem);
          onClose();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <DialogField label="Name">
        {(id) => <input id={id} className="ws-input" value={name} onChange={(e) => setName(e.target.value)} />}
      </DialogField>
    </FormDialog>
  );
}
