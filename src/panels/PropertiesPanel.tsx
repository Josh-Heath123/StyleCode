import { useCallback, useEffect, useRef, useState } from 'react';
import { ALT_KEY, alignSelection, distributeSelection, MOD_KEY, SHORTCUT_LABELS as K, zoomToSelection } from '../app/actions';
import type { Editor } from '../editor/editor';
import { shallowArrayEqual, useEditor, useEditorState } from '../editor/react';
import { createNode, FRAME_PRESETS } from '../model/defaults';
import { topLevelIds } from '../model/document';
import { unionWorldBounds } from '../model/geometry';
import type { Op } from '../model/ops';
import type { DesignDocument, DesignNode, NodeProps, NodeType } from '../model/types';
import { FONT_FAMILIES } from '../render/css';
import { Icon, type IconName } from '../ui/Icon';
import { ColorField, MIXED, NumberField, Segmented, SelectField, type Mixed, type Phase } from './controls';
import { isAutoLayout } from '../model/layout';
import {
  AutoLayoutSection,
  BlurSection,
  ColumnSpanRow,
  common,
  CornersRow,
  fixedHeight,
  fixedWidth,
  GradientRow,
  ImageSection,
  LimitsRow,
  MobileSection,
  NoteSection,
  RoleRow,
  ShadowSection,
  SizingRow,
} from './sections';

export const TYPE_ICONS: Record<NodeType, IconName> = {
  page: 'page',
  frame: 'frame',
  rect: 'rect',
  ellipse: 'ellipse',
  text: 'text',
  image: 'image',
  note: 'note',
};

const TYPE_LABELS: Record<NodeType, string> = {
  page: 'Page',
  frame: 'Frame',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Text',
  image: 'Image',
  note: 'Note',
};

const WEIGHTS = [
  { value: 100, label: 'Thin' },
  { value: 200, label: 'Extra light' },
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
  { value: 800, label: 'Extra bold' },
  { value: 900, label: 'Black' },
];

/**
 * Writes property changes for the selected layers. Previews (scrubbing,
 * dragging in the colour picker) become one undo step when committed.
 */
function usePropertyWriter(editor: Editor) {
  // Ends a preview that was never explicitly committed (e.g. a colour picker closed oddly).
  const pendingSettle = useRef<(() => void) | null>(null);
  // The document as it was when a preview started; previews are computed from it, not from themselves.
  const previewBase = useRef<DesignDocument | null>(null);
  return useCallback(
    (
      ids: readonly string[],
      props: Partial<NodeProps> | ((node: DesignNode) => Partial<NodeProps>),
      phase: Phase,
      label: string,
    ) => {
      const doc = (pendingSettle.current && previewBase.current) || editor.getState().doc;
      const ops: Op[] = ids
        .filter((id) => doc.nodes[id])
        .map((id) => ({ type: 'update', id, props: typeof props === 'function' ? props(doc.nodes[id]) : props }));
      if (ops.length === 0) return;
      if (phase === 'preview') {
        if (!pendingSettle.current) {
          previewBase.current = doc;
          editor.beginGesture();
          const cleanup = () => {
            window.removeEventListener('pointerdown', settle, true);
            window.removeEventListener('keydown', settle, true);
            pendingSettle.current = null;
            previewBase.current = null;
          };
          const settle = (e: Event) => {
            // Shift and Alt change the scrub step; they must not end the scrub.
            if (e instanceof KeyboardEvent && ['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) return;
            cleanup();
            if (editor.inGesture) editor.commitGesture(label);
          };
          window.addEventListener('pointerdown', settle, true);
          window.addEventListener('keydown', settle, true);
          pendingSettle.current = cleanup;
        }
        editor.previewGesture(ops);
      } else if (pendingSettle.current) {
        pendingSettle.current();
        editor.previewGesture(ops);
        editor.commitGesture(label);
      } else {
        editor.apply(ops, { label });
      }
    },
    [editor],
  );
}

export function PropertiesPanel() {
  const editor = useEditor();
  const selection = useEditorState((s) => topLevelIds(s.doc, s.selection), shallowArrayEqual);
  const nodes = useEditorState((s) => selection.map((id) => s.doc.nodes[id]).filter(Boolean), shallowArrayEqual);
  const write = usePropertyWriter(editor);
  const parents = useEditorState((s) => nodes.map((n) => (n.parentId ? s.doc.nodes[n.parentId] : undefined)), shallowArrayEqual);
  const parentHasLayout = parents.map((p) => isAutoLayout(p));
  const noteTarget = useEditorState((s) => {
    const only = nodes.length === 1 && nodes[0].type === 'note' ? s.doc.nodes[nodes[0].noteTarget] : undefined;
    return only ? only.name || only.type : null;
  });
  const [limitsOpen, setLimitsOpen] = useState(false);

  if (nodes.length === 0) return <PagePanel editor={editor} />;
  if (nodes.some((n) => n.type === 'note')) {
    return <NotesPanel editor={editor} nodes={nodes} targetName={noteTarget} write={write} />;
  }

  const ids = nodes.map((n) => n.id);
  const types = new Set(nodes.map((n) => n.type));
  const all = (...t: NodeType[]) => nodes.every((n) => t.includes(n.type));
  const set = (props: Partial<NodeProps>, phase: Phase, label: string) => write(ids, props, phase, label);
  const single = nodes.length === 1 ? nodes[0] : null;
  const parentIsPage = single?.parentId === editor.getState().doc.rootId;
  const inFlow = nodes.map((n, i) => parentHasLayout[i] && n.visible && n.positioning !== 'absolute');
  const allInFlow = inFlow.every(Boolean);
  // Distributing only moves layers that are not placed by auto layout.
  const canDistribute = inFlow.filter((f) => !f).length >= 3;
  const allInLayoutParent = parentHasLayout.every(Boolean);

  return (
    <>
      <div className="props-header">
        {single ? (
          <>
            <Icon name={TYPE_ICONS[single.type]} className="layer-icon" />
            <NameInput node={single} onRename={(name) => set({ name }, 'commit', 'Rename')} />
          </>
        ) : (
          <span className="props-header-count">{nodes.length} layers</span>
        )}
      </div>
      <RoleRow nodes={nodes} write={write} />

      <div className="align-bar" role="toolbar" aria-label="Align">
        {(
          [
            ['left', 'alignLeft', `Align left  ${K.alignLeft}`],
            ['hcenter', 'alignHCenter', `Align centre  ${K.alignHCenter}`],
            ['right', 'alignRight', `Align right  ${K.alignRight}`],
            ['top', 'alignTop', `Align top  ${K.alignTop}`],
            ['vcenter', 'alignVCenter', `Align middle  ${K.alignVCenter}`],
            ['bottom', 'alignBottom', `Align bottom  ${K.alignBottom}`],
          ] as const
        ).map(([alignment, icon, tip]) => (
          <button
            key={alignment}
            type="button"
            className="icon-button"
            aria-label={tip}
            data-tip={tip}
            disabled={(!!single && parentIsPage) || allInFlow}
            onClick={() => alignSelection(editor, alignment)}
          >
            <Icon name={icon} />
          </button>
        ))}
        <button
          type="button"
          className="icon-button"
          aria-label="Distribute horizontally"
          data-tip="Distribute horizontally"
          data-tip-side="left"
          disabled={!canDistribute}
          onClick={() => distributeSelection(editor, 'horizontal')}
        >
          <Icon name="distributeH" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Distribute vertically"
          data-tip="Distribute vertically"
          data-tip-side="left"
          disabled={!canDistribute}
          onClick={() => distributeSelection(editor, 'vertical')}
        >
          <Icon name="distributeV" />
        </button>
      </div>

      <div className="panel-scroll">
        <section className="section" aria-label="Layout">
          <div className="section-head">Layout</div>
          {all('frame') && (
            <div className="row">
              <SelectField
                name="Frame size"
                value={presetValue(nodes)}
                options={[
                  ...FRAME_PRESETS.map((p) => ({ value: p.label, label: `${p.label}  ${p.width}×${p.height}` })),
                  ...(presetValue(nodes) === 'custom' ? [{ value: 'custom', label: 'Custom size' }] : []),
                ]}
                onChange={(label) => {
                  const preset = FRAME_PRESETS.find((p) => p.label === label);
                  if (preset)
                    set(
                      { width: preset.width, height: preset.height, widthMode: 'fixed', heightMode: 'fixed' },
                      'commit',
                      'Resize',
                    );
                }}
              />
            </div>
          )}
          <div className="grid-2">
            <NumberField
              label="X"
              name="X position"
              value={common(nodes, 'x')}
              disabled={allInFlow}
              onChange={(v, p) => set({ x: v }, p, 'Move')}
            />
            <NumberField
              label="Y"
              name="Y position"
              value={common(nodes, 'y')}
              disabled={allInFlow}
              onChange={(v, p) => set({ y: v }, p, 'Move')}
            />
            <NumberField
              label="W"
              name="Width"
              value={common(nodes, 'width')}
              min={1}
              onChange={(v, p) => write(ids, (n) => ({ width: v, ...fixedWidth(n) }), p, 'Resize')}
            />
            <NumberField
              label="H"
              name="Height"
              value={common(nodes, 'height')}
              min={1}
              onChange={(v, p) => write(ids, (n) => ({ height: v, ...fixedHeight(n) }), p, 'Resize')}
            />
            <NumberField
              label={<Icon name="rotate" size={12} />}
              name="Rotation"
              value={common(nodes, 'rotation')}
              suffix="°"
              precision={1}
              onChange={(v, p) => set({ rotation: v }, p, 'Rotate')}
            />
            {all('frame') && (
              <label className="toggle-row" title="Hide anything that overflows the frame">
                <input
                  type="checkbox"
                  checked={common(nodes, 'clip') === true}
                  ref={(el) => {
                    if (el) el.indeterminate = common(nodes, 'clip') === MIXED;
                  }}
                  onChange={(e) => set({ clip: e.target.checked }, 'commit', e.target.checked ? 'Clip content' : 'Show overflow')}
                />
                Clip content
              </label>
            )}
          </div>
          <SizingRow nodes={nodes} parents={parents} write={write} />
          <ColumnSpanRow nodes={nodes} parents={parents} write={write} />
          {(allInFlow || all('frame')) && (allInFlow || nodes.every(isAutoLayout)) && (
            <LimitsRow nodes={nodes} open={limitsOpen} onOpen={() => setLimitsOpen(true)} write={write} />
          )}
          {allInLayoutParent && (
            <label className="toggle-row" title="Keep this layer at its own position instead of in the row or column">
              <input
                type="checkbox"
                checked={common(nodes, 'positioning') === 'absolute'}
                onChange={(e) =>
                  set(
                    { positioning: e.target.checked ? 'absolute' : 'auto' },
                    'commit',
                    e.target.checked ? 'Ignore auto layout' : 'Join auto layout',
                  )
                }
              />
              Ignore auto layout
            </label>
          )}
          {allInFlow && <p className="panel-hint">Placed by the parent's auto layout. Drag to reorder.</p>}
        </section>

        {all('frame') && <AutoLayoutSection editor={editor} nodes={nodes} write={write} />}

        <section className="section" aria-label="Appearance">
          <div className="section-head">Appearance</div>
          <div className="grid-2">
            <NumberField
              label={<Icon name="opacity" size={12} />}
              name="Opacity"
              value={common(nodes, 'opacity')}
              scale={100}
              precision={0}
              min={0}
              max={100}
              suffix="%"
              onChange={(v, p) => set({ opacity: v }, p, 'Opacity')}
            />
          </div>
          {all('frame', 'rect', 'image') && <CornersRow nodes={nodes} write={write} />}
        </section>

        {types.has('text') && all('text') && <TextSection nodes={nodes} write={write} />}

        {all('image') && <ImageSection editor={editor} nodes={nodes} write={write} />}

        <PaintSection
          title={all('text') ? 'Colour' : 'Fill'}
          value={common(nodes, 'fill')}
          defaultColor={all('text') ? '#11141a' : all('frame') ? '#ffffff' : '#d9dde4'}
          removable={!all('text')}
          onChange={(fill, phase, label) =>
            // Removing the fill removes a gradient too, rather than leaving one with no controls.
            write(ids, (n) => (fill === null && n.gradientTo ? { fill, gradientTo: null } : { fill }), phase, label)
          }
        >
          {all('frame', 'rect', 'ellipse') && <GradientRow nodes={nodes} write={write} />}
        </PaintSection>

        {all('frame', 'rect', 'ellipse', 'image') && (
          <StrokeSection nodes={nodes} onChange={(props, phase, label) => set(props, phase, label)} />
        )}
        {all('frame', 'rect', 'ellipse', 'image') && <ShadowSection nodes={nodes} write={write} />}
        {all('frame', 'rect', 'ellipse') && <BlurSection nodes={nodes} write={write} />}

        <MobileSection nodes={nodes} parents={parents} write={write} />

        {single && (
          <section className="section" aria-label="View">
            <button type="button" className="text-button" onClick={() => zoomToSelection(editor)}>
              <Icon name="fit" size={14} /> Zoom to {TYPE_LABELS[single.type].toLowerCase()}
              <kbd>{K.zoomSelection}</kbd>
            </button>
          </section>
        )}
      </div>
    </>
  );
}

/** Notes: where they are, their colour and what they point at. Notes mixed with layers can only be moved. */
function NotesPanel({
  editor,
  nodes,
  targetName,
  write,
}: {
  editor: Editor;
  nodes: DesignNode[];
  targetName: string | null;
  write: ReturnType<typeof usePropertyWriter>;
}) {
  const ids = nodes.map((n) => n.id);
  const onlyNotes = nodes.every((n) => n.type === 'note');
  const single = nodes.length === 1 ? nodes[0] : null;
  return (
    <>
      <div className="props-header">
        {single ? (
          <>
            <Icon name="note" className="layer-icon" />
            <NameInput node={single} onRename={(name) => write(ids, { name }, 'commit', 'Rename')} />
          </>
        ) : (
          <span className="props-header-count">
            {nodes.length} {onlyNotes ? 'notes' : 'layers'}
          </span>
        )}
      </div>
      <div className="panel-scroll">
        <section className="section" aria-label="Position">
          <div className="section-head">Position</div>
          <div className="grid-2">
            <NumberField
              label="X"
              name="X position"
              value={common(nodes, 'x')}
              onChange={(v, p) => write(ids, { x: v }, p, 'Move')}
            />
            <NumberField
              label="Y"
              name="Y position"
              value={common(nodes, 'y')}
              onChange={(v, p) => write(ids, { y: v }, p, 'Move')}
            />
            {onlyNotes && (
              <NumberField
                label="W"
                name="Width"
                value={common(nodes, 'width')}
                min={80}
                onChange={(v, p) => write(ids, { width: v }, p, 'Resize')}
              />
            )}
          </div>
        </section>
        {onlyNotes ? (
          <NoteSection nodes={nodes} targetName={targetName} write={write} />
        ) : (
          <p className="panel-hint panel-pad">Select only notes, or only layers, to change more.</p>
        )}
        {single && (
          <section className="section" aria-label="View">
            <button type="button" className="text-button" onClick={() => zoomToSelection(editor)}>
              <Icon name="fit" size={14} /> Zoom to note
              <kbd>{K.zoomSelection}</kbd>
            </button>
          </section>
        )}
      </div>
    </>
  );
}

function presetValue(nodes: DesignNode[]): string {
  const w = common(nodes, 'width');
  const h = common(nodes, 'height');
  return FRAME_PRESETS.find((p) => p.width === w && p.height === h)?.label ?? 'custom';
}

function NameInput({ node, onRename }: { node: DesignNode; onRename: (name: string) => void }) {
  const [value, setValue] = useState(node.name);
  useEffect(() => setValue(node.name), [node.name, node.id]);
  const commit = () => {
    const name = value.trim();
    if (name && name !== node.name) onRename(name);
    else setValue(node.name);
  };
  return (
    <input
      className="props-header-name"
      aria-label="Layer name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setValue(node.name);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

function PaintSection({
  title,
  value,
  defaultColor,
  removable,
  onChange,
  children,
}: {
  title: string;
  value: Mixed<string | null>;
  defaultColor: string;
  removable: boolean;
  onChange: (value: string | null, phase: Phase, label: string) => void;
  children?: React.ReactNode;
}) {
  const empty = value === null;
  return (
    <section className="section" aria-label={title}>
      <div className={`section-head${empty ? ' is-empty' : ''}`}>
        {title}
        {empty ? (
          <button
            type="button"
            className="icon-button"
            aria-label={`Add ${title.toLowerCase()}`}
            data-tip={`Add ${title.toLowerCase()}`}
            data-tip-side="left"
            onClick={() => onChange(defaultColor, 'commit', `Add ${title.toLowerCase()}`)}
          >
            <Icon name="plus" size={14} />
          </button>
        ) : (
          removable && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${title.toLowerCase()}`}
              data-tip={`Remove ${title.toLowerCase()}`}
              data-tip-side="left"
              onClick={() => onChange(null, 'commit', `Remove ${title.toLowerCase()}`)}
            >
              <Icon name="minus" size={14} />
            </button>
          )
        )}
      </div>
      {!empty && (
        <ColorField
          name={title}
          value={value === MIXED ? MIXED : (value as string)}
          onChange={(v, phase) => onChange(v, phase, title === 'Colour' ? 'Text colour' : 'Fill')}
        />
      )}
      {!empty && children}
    </section>
  );
}

function StrokeSection({
  nodes,
  onChange,
}: {
  nodes: DesignNode[];
  onChange: (props: Partial<NodeProps>, phase: Phase, label: string) => void;
}) {
  const stroke = common(nodes, 'stroke');
  const empty = stroke === null;
  return (
    <section className="section" aria-label="Stroke">
      <div className={`section-head${empty ? ' is-empty' : ''}`}>
        Stroke
        {empty ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Add stroke"
            data-tip="Add stroke"
            data-tip-side="left"
            onClick={() => onChange({ stroke: '#11141a', strokeWidth: 1 }, 'commit', 'Add stroke')}
          >
            <Icon name="plus" size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-button"
            aria-label="Remove stroke"
            data-tip="Remove stroke"
            data-tip-side="left"
            onClick={() => onChange({ stroke: null }, 'commit', 'Remove stroke')}
          >
            <Icon name="minus" size={14} />
          </button>
        )}
      </div>
      {!empty && (
        <>
          <ColorField
            name="Stroke"
            value={stroke === MIXED ? MIXED : (stroke as string)}
            onChange={(v, p) => onChange({ stroke: v }, p, 'Stroke')}
          />
          <div className="grid-2">
            <NumberField
              label="W"
              name="Stroke width"
              value={common(nodes, 'strokeWidth')}
              min={0}
              step={1}
              onChange={(v, p) => onChange({ strokeWidth: v }, p, 'Stroke width')}
            />
          </div>
        </>
      )}
    </section>
  );
}

function TextSection({ nodes, write }: { nodes: DesignNode[]; write: ReturnType<typeof usePropertyWriter> }) {
  const ids = nodes.map((n) => n.id);
  const set = (props: Partial<NodeProps>, phase: Phase, label = 'Text style') => write(ids, props, phase, label);
  return (
    <section className="section" aria-label="Text">
      <div className="section-head">Text</div>
      <div className="row">
        <SelectField
          name="Font"
          value={common(nodes, 'fontFamily')}
          options={FONT_FAMILIES.map((f) => ({ value: f.value as string, label: f.label }))}
          onChange={(fontFamily) => set({ fontFamily }, 'commit', 'Font')}
        />
      </div>
      <div className="grid-2">
        <SelectField
          name="Weight"
          value={common(nodes, 'fontWeight')}
          options={WEIGHTS}
          onChange={(fontWeight) => set({ fontWeight }, 'commit', 'Font weight')}
        />
        <NumberField
          label="Aa"
          name="Font size"
          value={common(nodes, 'fontSize')}
          min={1}
          onChange={(v, p) => set({ fontSize: v }, p, 'Font size')}
        />
        <NumberField
          label="LH"
          name="Line height"
          value={common(nodes, 'lineHeight')}
          step={0.05}
          min={0.5}
          max={5}
          onChange={(v, p) => set({ lineHeight: v }, p, 'Line height')}
        />
        <NumberField
          label="LS"
          name="Letter spacing"
          value={common(nodes, 'letterSpacing')}
          step={0.1}
          precision={1}
          onChange={(v, p) => set({ letterSpacing: v }, p, 'Letter spacing')}
        />
      </div>
      <div className="grid-2">
        <Segmented
          name="Alignment"
          value={common(nodes, 'textAlign')}
          options={[
            { value: 'left', icon: 'textLeft', label: 'Align left' },
            { value: 'center', icon: 'textCenter', label: 'Align centre' },
            { value: 'right', icon: 'textRight', label: 'Align right' },
          ]}
          onChange={(textAlign) => set({ textAlign }, 'commit', 'Text alignment')}
        />
      </div>
    </section>
  );
}

/** Shown when nothing is selected: page settings and quick frame creation. */
function PagePanel({ editor }: { editor: Editor }) {
  const rootId = useEditorState((s) => s.doc.rootId);
  const fill = useEditorState((s) => s.doc.nodes[s.doc.rootId].fill);
  const write = usePropertyWriter(editor);

  const addFrame = (preset: (typeof FRAME_PRESETS)[number]) => {
    const { doc } = editor.getState();
    const bounds = unionWorldBounds(doc, doc.nodes[doc.rootId].children);
    const x = bounds ? Math.round(bounds.x + bounds.width + 120) : 0;
    const y = bounds ? Math.round(bounds.y) : 0;
    const frame = createNode('frame', { name: preset.label, x, y, width: preset.width, height: preset.height });
    const tx = editor.apply(
      [{ type: 'create', parentId: doc.rootId, index: doc.nodes[doc.rootId].children.length, nodes: [frame] }],
      {
        label: `Add ${preset.label.toLowerCase()} frame`,
        selection: [frame.id],
      },
    );
    if (tx) zoomToSelection(editor);
  };

  return (
    <>
      <div className="props-header">
        <Icon name="page" className="layer-icon" />
        <span className="props-header-count">Page</span>
      </div>
      <div className="panel-scroll">
        <PaintSection
          title="Background"
          value={fill}
          defaultColor="#0d1017"
          removable={false}
          onChange={(v, phase) => write([rootId], { fill: v }, phase, 'Page background')}
        />
        <section className="section" aria-label="New frame">
          <div className="section-head">New frame</div>
          <div className="preset-grid">
            {FRAME_PRESETS.map((p) => (
              <button key={p.label} type="button" className="preset" onClick={() => addFrame(p)}>
                <span>{p.label}</span>
                <span>
                  {p.width} × {p.height}
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="section" aria-label="Shortcuts">
          <div className="section-head">Shortcuts</div>
          <ul className="hint-list">
            <li>
              Pan <kbd>Space + drag</kbd>
            </li>
            <li>
              Zoom <kbd>{MOD_KEY} + scroll</kbd>
            </li>
            <li>
              Select inside a frame <kbd>{MOD_KEY} + click</kbd>
            </li>
            <li>
              Duplicate while moving <kbd>{ALT_KEY} + drag</kbd>
            </li>
            <li>
              Keep proportions <kbd>Shift + drag</kbd>
            </li>
            <li>
              Zoom to fit <kbd>{K.zoomFit}</kbd>
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
