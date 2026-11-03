import { worldToScreen } from '../editor/camera';
import { useEditorState } from '../editor/react';
import { topLevelIds } from '../model/document';
import { boundsOfPoints, worldCorners } from '../model/geometry';
import type { DesignDocument, Point } from '../model/types';
import { resizeCursor, ROTATE_CURSOR } from './cursors';
import type { HandleName } from './gestures';

/**
 * Screen-space editing feedback drawn above the canvas: hover and selection
 * outlines, resize and rotate handles, the marquee, drop targets and frame
 * labels. Lines stay 1px at every zoom level because they are drawn in
 * screen space rather than inside the zoomed content.
 */

const CORNERS: { name: HandleName; index: number; angle: number }[] = [
  { name: 'nw', index: 0, angle: 225 },
  { name: 'ne', index: 1, angle: 315 },
  { name: 'se', index: 2, angle: 45 },
  { name: 'sw', index: 3, angle: 135 },
];

const EDGES: { name: HandleName; from: number; to: number; angle: number }[] = [
  { name: 'n', from: 0, to: 1, angle: 270 },
  { name: 'e', from: 1, to: 2, angle: 0 },
  { name: 's', from: 2, to: 3, angle: 90 },
  { name: 'w', from: 3, to: 0, angle: 180 },
];

const toPoints = (pts: Point[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

function screenCorners(doc: DesignDocument, id: string, camera: { x: number; y: number; zoom: number }): Point[] {
  return worldCorners(doc, id).map((p) => worldToScreen(camera, p));
}

function formatSize(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

export function Overlay() {
  const doc = useEditorState((s) => s.doc);
  const camera = useEditorState((s) => s.camera);
  const selection = useEditorState((s) => s.selection);
  const hoverId = useEditorState((s) => s.hoverId);
  const marquee = useEditorState((s) => s.marquee);
  const dropTargetId = useEditorState((s) => s.dropTargetId);
  const editingTextId = useEditorState((s) => s.editingTextId);
  const gesturing = useEditorState((s) => s.gesturing);
  const guides = useEditorState((s) => s.guides);

  const selected = topLevelIds(doc, selection).filter((id) => doc.nodes[id] && doc.nodes[id].type !== 'page');
  const single = selected.length === 1 ? doc.nodes[selected[0]] : null;
  const editingSelected = !!editingTextId && selected.includes(editingTextId);

  // Selection box: the rotated box for one layer, the axis-aligned bounds for several.
  let box: Point[] | null = null;
  let boxRotation = 0;
  if (single) {
    box = screenCorners(doc, single.id, camera);
    boxRotation = (Math.atan2(box[1].y - box[0].y, box[1].x - box[0].x) * 180) / Math.PI;
  } else if (selected.length > 1) {
    const b = boundsOfPoints(selected.flatMap((id) => screenCorners(doc, id, camera)));
    box = [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
      { x: b.x, y: b.y + b.height },
    ];
  }
  const showHandles = !!box && !editingSelected && selected.every((id) => !doc.nodes[id].locked);

  let sizeLabel: string | null = null;
  if (single) sizeLabel = `${formatSize(single.width)} × ${formatSize(single.height)}`;
  else if (selected.length > 1) {
    const b = boundsOfPoints(selected.flatMap((id) => worldCorners(doc, id)));
    sizeLabel = `${formatSize(Math.round(b.width * 10) / 10)} × ${formatSize(Math.round(b.height * 10) / 10)}`;
  }

  const root = doc.nodes[doc.rootId];
  const frameLabels = root.children
    .map((id) => doc.nodes[id])
    .filter((n) => n.type === 'frame' && n.visible)
    .map((n) => {
      const corners = screenCorners(doc, n.id, camera);
      const b = boundsOfPoints(corners);
      return { node: n, x: b.x, y: b.y, width: b.width };
    });

  const showHover = hoverId && !gesturing && !selection.includes(hoverId) && doc.nodes[hoverId] && hoverId !== doc.rootId;

  return (
    <div className="overlay">
      <svg className="overlay-svg">
        {showHover && <polygon className="ov-hover" points={toPoints(screenCorners(doc, hoverId!, camera))} />}

        {dropTargetId && doc.nodes[dropTargetId] && (
          <polygon className="ov-drop" points={toPoints(screenCorners(doc, dropTargetId, camera))} />
        )}

        {!editingSelected &&
          selected.length > 1 &&
          selected.map((id) => <polygon key={id} className="ov-outline" points={toPoints(screenCorners(doc, id, camera))} />)}

        {box && !editingSelected && <polygon className="ov-selection" points={toPoints(box)} />}

        {guides.map((g, i) => {
          const a = worldToScreen(camera, { x: g.x1, y: g.y1 });
          const b = worldToScreen(camera, { x: g.x2, y: g.y2 });
          return <line key={i} className={g.kind === 'insert' ? 'ov-insert' : 'ov-guide'} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}

        {marquee && (
          <rect
            className="ov-marquee"
            x={marquee.x * camera.zoom + camera.x}
            y={marquee.y * camera.zoom + camera.y}
            width={marquee.width * camera.zoom}
            height={marquee.height * camera.zoom}
          />
        )}

        {showHandles && box && (
          <g className="ov-handles">
            {single &&
              CORNERS.map(({ name, index, angle }) => {
                const p = box![index];
                const rad = ((angle + boxRotation) * Math.PI) / 180;
                // Just outside each corner, clear of the resize handle.
                const cx = p.x + Math.cos(rad) * 19;
                const cy = p.y + Math.sin(rad) * 19;
                return (
                  <rect
                    key={`r-${name}`}
                    className="ov-hit"
                    data-rotate={name}
                    x={cx - 11}
                    y={cy - 11}
                    width={22}
                    height={22}
                    style={{ cursor: ROTATE_CURSOR }}
                  />
                );
              })}
            {EDGES.map(({ name, from, to, angle }) => {
              const a = box![from];
              const b = box![to];
              const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
              // Outward normal (corners run clockwise). The grab band sits mostly outside the
              // box so small layers can still be moved by dragging their inside.
              const nx = (b.y - a.y) / len;
              const ny = -(b.x - a.x) / len;
              const out = 6;
              const inside = 2;
              return (
                <polygon
                  key={name}
                  className="ov-hit"
                  data-handle={name}
                  data-cursor={resizeCursor(angle + boxRotation)}
                  points={toPoints([
                    { x: a.x + nx * out, y: a.y + ny * out },
                    { x: b.x + nx * out, y: b.y + ny * out },
                    { x: b.x - nx * inside, y: b.y - ny * inside },
                    { x: a.x - nx * inside, y: a.y - ny * inside },
                  ])}
                  style={{ cursor: resizeCursor(angle + boxRotation) }}
                />
              );
            })}
            {CORNERS.map(({ name, index, angle }) => {
              const p = box![index];
              const cursor = resizeCursor(angle + boxRotation);
              const rad = ((angle + boxRotation) * Math.PI) / 180;
              const hx = p.x + Math.cos(rad) * 3;
              const hy = p.y + Math.sin(rad) * 3;
              return (
                <g key={name}>
                  <rect
                    className="ov-hit"
                    data-handle={name}
                    data-cursor={cursor}
                    x={hx - 7}
                    y={hy - 7}
                    width={14}
                    height={14}
                    style={{ cursor }}
                  />
                  <rect
                    className="ov-handle"
                    x={p.x - 4}
                    y={p.y - 4}
                    width={8}
                    height={8}
                    rx={1.5}
                    transform={`rotate(${boxRotation} ${p.x} ${p.y})`}
                  />
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {frameLabels.map(({ node, x, y, width }) => (
        <div
          key={node.id}
          className={`ov-frame-label${selection.includes(node.id) ? ' is-selected' : ''}${hoverId === node.id ? ' is-hover' : ''}`}
          data-frame-label={node.id}
          style={{ transform: `translate(${x}px, ${y - 20}px)`, maxWidth: Math.max(24, width) }}
          title={node.name}
        >
          {node.name || 'Frame'}
        </div>
      ))}

      {sizeLabel && box && !editingSelected && <SizeBadge box={box} label={sizeLabel} />}
    </div>
  );
}

function SizeBadge({ box, label }: { box: Point[]; label: string }) {
  const b = boundsOfPoints(box);
  return (
    <div className="ov-size" style={{ transform: `translate(${b.x + b.width / 2}px, ${b.y + b.height + 8}px) translateX(-50%)` }}>
      {label}
    </div>
  );
}
