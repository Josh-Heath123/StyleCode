import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { listScreens } from '../codegen/screen';
import { useEditor } from '../editor/react';
import { Icon, type IconName } from '../ui/Icon';
import { previewDocument } from './codeExport';

type Device = 'design' | 'tablet' | 'mobile';

const DEVICES: { id: Device; label: string; icon: IconName; width?: number }[] = [
  { id: 'design', label: 'Design width', icon: 'monitor' },
  { id: 'tablet', label: 'Tablet', icon: 'tablet', width: 768 },
  { id: 'mobile', label: 'Mobile', icon: 'phone', width: 390 },
];

/**
 * The exported page, running in a sandboxed frame (no scripts, no access to
 * the app) at the design width, a tablet width or a phone width. It shows
 * exactly the HTML and CSS that export writes.
 */
export function PreviewDialog({ screenId, onClose }: { screenId: string; onClose: () => void }) {
  const editor = useEditor();
  const doc = editor.getState().doc;
  const screens = listScreens(doc);
  const [current, setCurrent] = useState(screens.some((s) => s.id === screenId) ? screenId : screens[0]?.id);
  const [device, setDevice] = useState<Device>('design');
  const [page, setPage] = useState<{ html: string; width: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!current) return;
    let alive = true;
    setPage(null);
    setFailed(null);
    previewDocument(doc, current)
      .then((result) => alive && setPage(result))
      .catch((error: Error) => alive && setFailed(error.message));
    return () => {
      alive = false;
    };
  }, [doc, current]);

  useEffect(() => dialogRef.current?.focus(), []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const width = DEVICES.find((d) => d.id === device)?.width ?? Math.round(page?.width ?? 1280);
  const scale = stage.width ? Math.min(1, (stage.width - 48) / width) : 1;
  const height = Math.max(200, (stage.height - 48) / scale);

  return (
    <div className="preview-backdrop">
      <div
        ref={dialogRef}
        className="preview"
        role="dialog"
        aria-modal="true"
        aria-label="Preview"
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="preview-bar">
          <span className="preview-title">
            <Icon name="play" size={14} /> Preview
          </span>
          {screens.length > 1 && (
            <select className="preview-select" aria-label="Screen" value={current} onChange={(e) => setCurrent(e.target.value)}>
              {screens.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || 'Screen'}
                </option>
              ))}
            </select>
          )}
          <div className="preview-devices" role="radiogroup" aria-label="Screen width">
            {DEVICES.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={device === d.id}
                className={`text-button${device === d.id ? ' is-on' : ''}`}
                onClick={() => setDevice(d.id)}
              >
                <Icon name={d.icon} size={14} />
                {d.label}
                <span className="preview-width">{d.width ?? Math.round(page?.width ?? 0)}px</span>
              </button>
            ))}
          </div>
          <span className="preview-scale">{scale < 1 ? `Shown at ${Math.round(scale * 100)}%` : ''}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Close preview"
            data-tip="Close  Esc"
            data-tip-side="left"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="preview-stage" ref={stageRef}>
          {failed ? (
            <p className="preview-message">The preview couldn&rsquo;t be built: {failed}</p>
          ) : !current ? (
            <p className="preview-message">Nothing to preview yet: each top-level frame becomes a page.</p>
          ) : !page ? (
            <p className="preview-message">Building the preview…</p>
          ) : (
            <div className="preview-device" style={{ width: width * scale, height: height * scale }}>
              <iframe
                title="Exported page"
                sandbox=""
                srcDoc={page.html}
                style={{ width, height, transform: `scale(${scale})` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
