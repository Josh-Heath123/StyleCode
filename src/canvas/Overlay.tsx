import { useEffect, useState } from 'react';
import { worldToScreen } from '../editor/camera';
import { useEditorState } from '../editor/react';
import { topLevelIds } from '../model/document';
import { boundsOfPoints, unionWorldBounds, worldBounds, worldCorners } from '../model/geometry';
import type { DesignDocument, Point, Rect } from '../model/types';
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

/** Where the line from a box's centre towards a point leaves the box. */
function edgePoint(r: Rect, toward: Point): Point {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: cx, y: cy };
  const s = Math.min(r.width / 2 / Math.max(Math.abs(dx), 1e-6), r.height / 2 / Math.max(Math.abs(dy), 1e-6));
  return { x: cx + dx * s, y: cy + dy * s };
}

const centre = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

type Measure = { x1: number; y1: number; x2: number; y2: number; label: string };

/**
 * Distances from `a` (the selection) to `b` (the layer under the pointer, or
 * the frame around the selection), in world space: to each side of a frame
 * that contains it, or across the gap to a layer beside it.
 */
export function measureLines(a: Rect, b: Rect): Measure[] {
  const out: Measure[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const length = Math.abs(x2 - x1) + Math.abs(y2 - y1);
    if (length >= 0.5) out.push({ x1, y1, x2, y2, label: formatSize(Math.round(length * 10) / 10) });
  };
  const ar = a.x + a.width;
  const ab = a.y + a.height;
  const br = b.x + b.width;
  const bb = b.y + b.height;
  const mid = centre(a);
  if (b.x <= a.x && b.y <= a.y && br >= ar && bb >= ab) {
    add(b.x, mid.y, a.x, mid.y);
    add(ar, mid.y, br, mid.y);
    add(mid.x, b.y, mid.x, a.y);
    add(mid.x, ab, mid.x, bb);
    return out;
  }
  // Across the part where they overlap on the other axis, or level with the selection's middle.
  const y = Math.max(a.y, b.y) < Math.min(ab, bb) ? (Math.max(a.y, b.y) + Math.min(ab, bb)) / 2 : mid.y;
  const x = Math.max(a.x, b.x) < Math.min(ar, br) ? (Math.max(a.x, b.x) + Math.min(ar, br)) / 2 : mid.x;
  if (ar <= b.x) add(ar, y, b.x, y);
  else if (br <= a.x) add(br, y, a.x, y);
  if (ab <= b.y) add(x, ab, x, b.y);
  else if (bb <= a.y) add(x, bb, x, a.y);
  return out;
}

/** Whether Alt (Option) is held, for showing distances. */
function useAltHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const update = (e: KeyboardEvent) => setHeld(e.altKey);
    const clear = () => setHeld(false);
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return held;
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
  const proposal = useEditorState((s) => s.proposal);
  const altHeld = useAltHeld();

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

  // Notes and the layers they point at.
  const arrows = root.children
    .map((id) => doc.nodes[id])
    .filter((n) => n.type === 'note' && n.visible && n.noteTarget && doc.nodes[n.noteTarget]?.visible)
    .map((n) => {
      const from = boundsOfPoints(screenCorners(doc, n.id, camera));
      const to = boundsOfPoints(screenCorners(doc, n.noteTarget, camera));
      return { id: n.id, a: edgePoint(from, centre(to)), b: edgePoint(to, centre(from)) };
    });
  const connector =
    single?.type === 'note' && !editingSelected && box
      ? { x: (box[1].x + box[2].x) / 2 + 12, y: (box[1].y + box[2].y) / 2 }
      : null;

  // Alt: distances from the selection to the layer under the pointer, or to the frame around it.
  let measures: Measure[] = [];
  if (altHeld && selected.length && !gesturing) {
    const parentId = doc.nodes[selected[0]].parentId;
    const other =
      hoverId && doc.nodes[hoverId] && !selected.includes(hoverId) && hoverId !== doc.rootId
        ? hoverId
        : parentId && parentId !== doc.rootId
          ? parentId
          : null;
    if (other) {
      const toScreen = (m: Measure): Measure => {
        const p = worldToScreen(camera, { x: m.x1, y: m.y1 });
        const q = worldToScreen(camera, { x: m.x2, y: m.y2 });
        return { x1: p.x, y1: p.y, x2: q.x, y2: q.y, label: m.label };
      };
      const bounds = unionWorldBounds(doc, selected);
      if (bounds) measures = measureLines(bounds, worldBounds(doc, other)).map(toScreen);
    }
  }

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

        {/* AI proposals draw over the selection outline so what would change stays visible. */}
        {proposal && (
          <g className="ov-proposal" aria-hidden="true">
            {proposal.removed.map(({ id, corners }) => (
              <polygon
                key={`r-${id}`}
                className="ov-proposal-removed"
                points={toPoints(corners.map((p) => worldToScreen(camera, p)))}
              />
            ))}
            {[...proposal.changed, ...proposal.created]
              .filter((id) => doc.nodes[id])
              .map((id) => (
                <polygon key={id} className="ov-proposal-changed" points={toPoints(screenCorners(doc, id, camera))} />
              ))}
          </g>
        )}

        <defs>
          <marker
            id="ov-arrowhead"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 10 5 0 10z" className="ov-arrowhead" />
          </marker>
        </defs>
        {arrows.map(({ id, a, b }) => (
          <line
            key={`arrow-${id}`}
            className="ov-note-arrow"
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            markerEnd="url(#ov-arrowhead)"
          />
        ))}

        {guides.map((g, i) => {
          const a = worldToScreen(camera, { x: g.x1, y: g.y1 });
          const b = worldToScreen(camera, { x: g.x2, y: g.y2 });
          if (g.kind === 'gap')
            return <Dimension key={i} className="ov-gap" x1={a.x} y1={a.y} x2={b.x} y2={b.y} label={g.label} />;
          const className = g.kind === 'insert' ? 'ov-insert' : g.kind === 'connector' ? 'ov-connector-line' : 'ov-guide';
          return <line key={i} className={className} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}

        {measures.map((m, i) => (
          <Dimension key={`m-${i}`} className="ov-measure" {...m} />
        ))}

        {marquee && (
          <rect
            className="ov-marquee"
            x={marquee.x * camera.zoom + camera.x}
            y={marquee.y * camera.zoom + camera.y}
            width={marquee.width * camera.zoom}
            height={marquee.height * camera.zoom}
          />
        )}

        {connector && (
          <g className="ov-connector" data-note-connector={single!.id}>
            <circle cx={connector.x} cy={connector.y} r={11} className="ov-hit" data-note-connector={single!.id} />
            <circle cx={connector.x} cy={connector.y} r={5} className="ov-connector-dot" data-note-connector={single!.id} />
          </g>
        )}

        {showHandles && box && (
          <g className="ov-handles">
            {single &&
              single.type !== 'note' &&
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

/** A measured distance: a line with end ticks and its length. */
function Dimension({
  x1,
  y1,
  x2,
  y2,
  label,
  className,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  className: string;
}) {
  const horizontal = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  const tick = (x: number, y: number) =>
    horizontal ? <line x1={x} y1={y - 4} x2={x} y2={y + 4} /> : <line x1={x - 4} y1={y} x2={x + 4} y2={y} />;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g className={className}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {tick(x1, y1)}
      {tick(x2, y2)}
      {label && (
        <text x={horizontal ? mx : mx + 6} y={horizontal ? my - 6 : my + 4} textAnchor={horizontal ? 'middle' : 'start'}>
          {label}
        </text>
      )}
    </g>
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
