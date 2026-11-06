import { useEffect, useRef, useState } from 'react';
import type { Camera } from '../editor/camera';
import { useEditor, useEditorState } from '../editor/react';
import type { ProjectSession, ProjectSummary, StorageUsage } from '../persistence/session';
import { Icon } from '../ui/Icon';
import { useDialogFocus } from '../ui/useDialogFocus';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function megabytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Lists projects stored in this browser, with open and delete. */
export function ProjectsDialog({
  session,
  onClose,
  onCameraRestore,
}: {
  session: ProjectSession;
  onClose: () => void;
  onCameraRestore: (camera: Camera | null) => void;
}) {
  const editor = useEditor();
  const currentId = useEditorState((s) => s.doc.id);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [space, setSpace] = useState<StorageUsage | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef);

  const refresh = () => {
    void session.storageUsage().then(setSpace);
    return session
      .listProjects()
      .then(setProjects)
      .catch((e: Error) => {
        editor.notify(e.message, 'error');
        setProjects([]);
      });
  };

  const download = async (id: string) => {
    try {
      if (await session.downloadStoredProject(id)) editor.notify('Design data saved.');
    } catch (error) {
      editor.notify((error as Error).message, 'error');
    }
  };

  useEffect(() => {
    void session.saveNow().then(refresh);
    dialogRef.current?.focus();
  }, []);

  const open = async (id: string) => {
    try {
      onCameraRestore(await session.openProject(id));
      onClose();
    } catch (error) {
      editor.notify((error as Error).message, 'error');
    }
  };

  const remove = async (id: string) => {
    try {
      if (id === currentId) {
        // Move to another project first (one that opens), so the editor never stays on a deleted one.
        const next = (await session.listProjects()).find((p) => p.id !== id && !p.problem);
        onCameraRestore(next ? await session.openProject(next.id) : await session.newProject());
      }
      await session.deleteProject(id);
      setConfirming(null);
      await refresh();
    } catch (error) {
      editor.notify((error as Error).message, 'error');
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="dialog glass"
        role="dialog"
        aria-modal="true"
        aria-label="Designs"
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="dialog-head">
          Designs on this device
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog-body">
          {projects === null && <p className="layers-empty">Loading…</p>}
          {projects?.length === 0 && <p className="layers-empty">No saved designs yet.</p>}
          {projects?.map((p) => (
            <div key={p.id} className={`project-item${p.id === currentId ? ' is-current' : ''}`}>
              <div className="project-item-main">
                <div className="project-item-name">{p.name}</div>
                {p.problem ? (
                  <div className="project-item-problem">Can’t be opened: {p.problem}</div>
                ) : (
                  <div className="project-item-date">Edited {dateFormat.format(p.updatedAt)}</div>
                )}
              </div>
              {confirming === p.id ? (
                <>
                  <button type="button" className="button" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                  <button type="button" className="button danger" onClick={() => void remove(p.id)}>
                    Delete project
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => setConfirming(p.id)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                  {p.problem ? (
                    <button type="button" className="button" onClick={() => void download(p.id)}>
                      Download data
                    </button>
                  ) : (
                    <button type="button" className="button" disabled={p.id === currentId} onClick={() => void open(p.id)}>
                      Open
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        {space && (
          <div className={`projects-space${space.usage / space.quota > 0.9 ? ' is-full' : ''}`}>
            <div className="projects-space-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (space.usage / space.quota) * 100)}%` }} />
            </div>
            Using {megabytes(space.usage)} of the {megabytes(space.quota)} this browser allows. Designs and images stay on this
            device.
          </div>
        )}
      </div>
    </div>
  );
}
