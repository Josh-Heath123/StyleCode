import { useEffect, useRef, useState } from 'react';
import type { Camera } from '../editor/camera';
import { useEditor, useEditorState } from '../editor/react';
import type { ProjectSession, ProjectSummary } from '../persistence/session';
import { Icon } from '../ui/Icon';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

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
  const dialogRef = useRef<HTMLDivElement>(null);

  const refresh = () =>
    session
      .listProjects()
      .then(setProjects)
      .catch((e: Error) => {
        editor.notify(e.message, 'error');
        setProjects([]);
      });

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
      await session.deleteProject(id);
      if (id === currentId) {
        const remaining = (await session.listProjects()).filter((p) => p.id !== id);
        onCameraRestore(remaining[0] ? await session.openProject(remaining[0].id) : await session.newProject());
      }
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
        aria-label="Projects"
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="dialog-head">
          Projects on this device
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog-body">
          {projects === null && <p className="layers-empty">Loading…</p>}
          {projects?.length === 0 && <p className="layers-empty">No saved projects yet.</p>}
          {projects?.map((p) => (
            <div key={p.id} className={`project-item${p.id === currentId ? ' is-current' : ''}`}>
              <div className="project-item-main">
                <div className="project-item-name">{p.name}</div>
                <div className="project-item-date">Edited {dateFormat.format(p.updatedAt)}</div>
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
                  <button type="button" className="button" disabled={p.id === currentId} onClick={() => void open(p.id)}>
                    Open
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
