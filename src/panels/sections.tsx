import { addAutoLayout, removeAutoLayout, setFrameLayout } from '../app/actions';
import { replaceImage } from '../app/insert';
import type { Editor } from '../editor/editor';
import { canFill, effectiveSizing, isAutoLayout, isGrid } from '../model/layout';
import { sizingProps } from '../model/sizing';
export { fixedHeight, fixedWidth, sizingProps } from '../model/sizing';
import { MOBILE_BREAKPOINT, ROLES, type DesignNode, type NodeProps, type Role, type SizingMode } from '../model/types';
import { NOTE_COLORS } from '../render/css';
import { Icon } from '../ui/Icon';
import { ColorField, MIXED, NumberField, Segmented, SelectField, type Mixed, type Phase } from './controls';

/**
 * Phase 2 property sections: sizing, auto-layout, element role, effects and
 * images. They share the panel's writer, so every edit is one undo step and
 * scrubbing previews live.
 */

export type Writer = (
  ids: readonly string[],
  props: Partial<NodeProps> | ((node: DesignNode) => Partial<NodeProps>),
  phase: Phase,
  label: string,
) => void;

export function common<K extends keyof NodeProps>(nodes: readonly DesignNode[], key: K): Mixed<NodeProps[K]> {
  const first = nodes[0][key];
  return nodes.every((n) => n[key] === first) ? first : MIXED;
}

function same<T>(values: readonly T[]): Mixed<T> {
  return values.every((v) => v === values[0]) ? values[0] : MIXED;
}

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

type Axis = 'width' | 'height';

const SIZING_LABELS: Record<Axis, Record<SizingMode, string>> = {
  width: { fixed: 'Fixed width', hug: 'Hug width', fill: 'Fill width' },
  height: { fixed: 'Fixed height', hug: 'Hug height', fill: 'Fill height' },
};

/** Sizing choices that make sense for a layer: hug needs content to hug, fill needs space in an auto-layout parent. */
function sizingOptions(node: DesignNode, axis: Axis, parent: DesignNode | undefined): SizingMode[] {
  const options: SizingMode[] = ['fixed'];
  if (node.type === 'text' || isAutoLayout(node)) options.push('hug');
  if (canFill(node, axis, parent)) options.push('fill');
  return options;
}

export function SizingRow({
  nodes,
  parents,
  write,
}: {
  nodes: DesignNode[];
  parents: (DesignNode | undefined)[];
  write: Writer;
}) {
  const ids = nodes.map((n) => n.id);
  const options = (axis: Axis) => {
    const per = nodes.map((n, i) => sizingOptions(n, axis, parents[i]));
    return (['fixed', 'hug', 'fill'] as const)
      .filter((m) => per.every((o) => o.includes(m)))
      .map((m) => ({ value: m, label: SIZING_LABELS[axis][m] }));
  };
  const widthOptions = options('width');
  const heightOptions = options('height');
  if (widthOptions.length < 2 && heightOptions.length < 2) return null;
  const value = (axis: Axis) => same(nodes.map((n, i) => effectiveSizing(n, axis, parents[i])));
  return (
    <div className="grid-2">
      <SelectField
        name="Width sizing"
        value={value('width')}
        options={widthOptions}
        onChange={(mode) => write(ids, (n) => sizingProps(n, 'width', mode), 'commit', 'Width sizing')}
      />
      <SelectField
        name="Height sizing"
        value={value('height')}
        options={heightOptions}
        onChange={(mode) => write(ids, (n) => sizingProps(n, 'height', mode), 'commit', 'Height sizing')}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto layout
// ---------------------------------------------------------------------------

const JUSTIFY_OPTIONS = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Centre' },
  { value: 'end', label: 'End' },
  { value: 'space-between', label: 'Space between' },
] as const;

export function AutoLayoutSection({ editor, nodes, write }: { editor: Editor; nodes: DesignNode[]; write: Writer }) {
  const ids = nodes.map((n) => n.id);
  const on = nodes.every(isAutoLayout);
  const set = (props: Partial<NodeProps>, phase: Phase, label: string) => write(ids, props, phase, label);
  const direction = common(nodes, 'layout');
  const row = direction === 'row';
  const grid = direction === 'grid';

  return (
    <section className="section" aria-label="Auto layout">
      <div className={`section-head${on ? '' : ' is-empty'}`}>
        Auto layout
        {on ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Remove auto layout"
            data-tip="Remove auto layout"
            data-tip-side="left"
            onClick={() => removeAutoLayout(editor)}
          >
            <Icon name="minus" size={14} />
          </button>
        ) : (
          nodes.length === 1 && (
            <button
              type="button"
              className="icon-button"
              aria-label="Add auto layout"
              data-tip={'Add auto layout  Shift+A\nArranges the layers inside into rows and columns'}
              data-tip-side="left"
              onClick={() => addAutoLayout(editor)}
            >
              <Icon name="plus" size={14} />
            </button>
          )
        )}
      </div>
      {on && (
        <>
          <div className="grid-2">
            <Segmented
              name="Direction"
              value={direction === MIXED ? MIXED : (direction as 'row' | 'column' | 'grid')}
              options={[
                { value: 'row', icon: 'arrowRight', label: 'Row' },
                { value: 'column', icon: 'arrowDown', label: 'Column' },
                { value: 'grid', icon: 'grid', label: 'Grid' },
              ]}
              onChange={(layout) => setFrameLayout(editor, ids, layout)}
            />
            <NumberField
              label={<Icon name="gap" size={12} />}
              name="Gap"
              value={common(nodes, 'gap')}
              min={0}
              onChange={(v, p) => set({ gap: v }, p, 'Gap')}
            />
          </div>
          {grid && (
            <div className="grid-2">
              <NumberField
                label="Cols"
                name="Columns"
                value={common(nodes, 'columns')}
                min={1}
                max={24}
                precision={0}
                onChange={(v, p) => set({ columns: Math.round(v) }, p, 'Columns')}
              />
            </div>
          )}
          <div className="grid-2">
            <Segmented
              name="Align items"
              value={common(nodes, 'align')}
              options={
                row || grid
                  ? [
                      { value: 'start', icon: 'alignTop', label: 'Align top' },
                      { value: 'center', icon: 'alignVCenter', label: 'Align middle' },
                      { value: 'end', icon: 'alignBottom', label: 'Align bottom' },
                    ]
                  : [
                      { value: 'start', icon: 'alignLeft', label: 'Align left' },
                      { value: 'center', icon: 'alignHCenter', label: 'Align centre' },
                      { value: 'end', icon: 'alignRight', label: 'Align right' },
                    ]
              }
              onChange={(align) => set({ align }, 'commit', 'Alignment')}
            />
            {grid ? (
              <SelectField
                name="Place in cell"
                value={common(nodes, 'justify')}
                options={[
                  { value: 'start', label: 'Left in cell' },
                  { value: 'center', label: 'Centre in cell' },
                  { value: 'end', label: 'Right in cell' },
                ]}
                onChange={(justify) => set({ justify }, 'commit', 'Placement')}
              />
            ) : (
              <SelectField
                name="Distribution"
                value={common(nodes, 'justify')}
                options={JUSTIFY_OPTIONS.map((o) => ({ ...o }))}
                onChange={(justify) => set({ justify }, 'commit', 'Distribution')}
              />
            )}
          </div>
          <div className="grid-2">
            <NumberField
              label="T"
              name="Padding top"
              value={common(nodes, 'paddingTop')}
              min={0}
              onChange={(v, p) => set({ paddingTop: v }, p, 'Padding')}
            />
            <NumberField
              label="B"
              name="Padding bottom"
              value={common(nodes, 'paddingBottom')}
              min={0}
              onChange={(v, p) => set({ paddingBottom: v }, p, 'Padding')}
            />
            <NumberField
              label="L"
              name="Padding left"
              value={common(nodes, 'paddingLeft')}
              min={0}
              onChange={(v, p) => set({ paddingLeft: v }, p, 'Padding')}
            />
            <NumberField
              label="R"
              name="Padding right"
              value={common(nodes, 'paddingRight')}
              min={0}
              onChange={(v, p) => set({ paddingRight: v }, p, 'Padding')}
            />
          </div>
          {row && (
            <label className="toggle-row" title="Layers that don't fit move onto a new line, with the gap between lines">
              <input
                type="checkbox"
                checked={common(nodes, 'wrap') === true}
                ref={(el) => {
                  if (el) el.indeterminate = common(nodes, 'wrap') === MIXED;
                }}
                onChange={(e) => set({ wrap: e.target.checked }, 'commit', e.target.checked ? 'Wrap' : "Don't wrap")}
              />
              Wrap onto new lines
            </label>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Grid cells and size limits
// ---------------------------------------------------------------------------

/** How many columns a layer in a grid spans. */
export function ColumnSpanRow({
  nodes,
  parents,
  write,
}: {
  nodes: DesignNode[];
  parents: (DesignNode | undefined)[];
  write: Writer;
}) {
  if (!parents.every(isGrid) || nodes.some((n) => n.positioning === 'absolute')) return null;
  const most = Math.max(...parents.map((p) => p!.columns));
  return (
    <div className="grid-2">
      <NumberField
        label="Span"
        name="Column span"
        value={common(nodes, 'columnSpan')}
        min={1}
        max={most}
        precision={0}
        onChange={(v, p) =>
          write(
            nodes.map((n) => n.id),
            { columnSpan: Math.round(v) },
            p,
            'Column span',
          )
        }
      />
    </div>
  );
}

const LIMITS = [
  ['minWidth', 'Min W', 'Minimum width'],
  ['maxWidth', 'Max W', 'Maximum width'],
  ['minHeight', 'Min H', 'Minimum height'],
  ['maxHeight', 'Max H', 'Maximum height'],
] as const;

/**
 * Minimum and maximum sizes, for layers whose size auto layout decides. Shown
 * once one is set, or on request; 0 means no limit.
 */
export function LimitsRow({
  nodes,
  open,
  onOpen,
  write,
}: {
  nodes: DesignNode[];
  open: boolean;
  onOpen: () => void;
  write: Writer;
}) {
  const any = nodes.some((n) => LIMITS.some(([key]) => n[key] > 0));
  if (!any && !open) {
    return (
      <button type="button" className="text-button add-row" onClick={onOpen}>
        <Icon name="plus" size={12} /> Size limits
      </button>
    );
  }
  return (
    <div className="grid-2" role="group" aria-label="Size limits (0 for none)">
      {LIMITS.map(([key, label, name]) => (
        <NumberField
          key={key}
          label={label}
          name={`${name} (0 for none)`}
          value={common(nodes, key)}
          min={0}
          precision={0}
          onChange={(v, p) =>
            write(
              nodes.map((n) => n.id),
              { [key]: Math.max(0, Math.round(v)) },
              p,
              'Size limit',
            )
          }
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Corners
// ---------------------------------------------------------------------------

const CORNERS = [
  ['radiusTopLeft', 'TL', 'Top-left radius'],
  ['radiusTopRight', 'TR', 'Top-right radius'],
  ['radiusBottomLeft', 'BL', 'Bottom-left radius'],
  ['radiusBottomRight', 'BR', 'Bottom-right radius'],
] as const;

/** One radius for all corners, or one per corner. */
export function CornersRow({ nodes, write }: { nodes: DesignNode[]; write: Writer }) {
  const ids = nodes.map((n) => n.id);
  const independent = common(nodes, 'independentCorners') === true;
  const toggle = (
    <button
      type="button"
      className="icon-button"
      aria-pressed={independent}
      aria-label="Independent corners"
      data-tip="Independent corners"
      data-tip-side="left"
      onClick={() =>
        write(
          ids,
          (n) =>
            independent
              ? { independentCorners: false, radius: n.radiusTopLeft }
              : {
                  independentCorners: true,
                  radiusTopLeft: n.radius,
                  radiusTopRight: n.radius,
                  radiusBottomRight: n.radius,
                  radiusBottomLeft: n.radius,
                },
          'commit',
          independent ? 'Same corners' : 'Independent corners',
        )
      }
    >
      <Icon name="corners" size={14} />
    </button>
  );
  if (!independent) {
    return (
      <div className="field-with-button">
        <NumberField
          label={<Icon name="radius" size={12} />}
          name="Corner radius"
          value={common(nodes, 'radius')}
          min={0}
          onChange={(v, p) => write(ids, { radius: v }, p, 'Corner radius')}
        />
        {toggle}
      </div>
    );
  }
  return (
    <div className="corners">
      <div className="grid-2">
        {CORNERS.map(([key, label, name]) => (
          <NumberField
            key={key}
            label={label}
            name={name}
            value={common(nodes, key)}
            min={0}
            onChange={(v, p) => write(ids, { [key]: v }, p, 'Corner radius')}
          />
        ))}
      </div>
      {toggle}
    </div>
  );
}

// ---------------------------------------------------------------------------
// On phones
// ---------------------------------------------------------------------------

/**
 * Changes that apply to the exported page on phones (below the mobile
 * breakpoint): hide a layer, stack a row, use fewer grid columns, take the
 * full width, or set text differently. Preview at phone width shows them.
 */
export function MobileSection({
  nodes,
  parents,
  write,
}: {
  nodes: DesignNode[];
  parents: (DesignNode | undefined)[];
  write: Writer;
}) {
  const ids = nodes.map((n) => n.id);
  const set = (props: Partial<NodeProps>, phase: Phase, label: string) => write(ids, props, phase, label);
  const frames = nodes.every((n) => n.type === 'frame' && n.layout !== 'none');
  const grids = nodes.every(isGrid);
  const texts = nodes.every((n) => n.type === 'text');
  const inLayout = parents.every((p) => isAutoLayout(p)) && nodes.every((n) => n.positioning !== 'absolute');
  const changed = nodes.some(
    (n) =>
      n.hideOnMobile ||
      n.mobileFill ||
      n.mobileLayout !== 'same' ||
      n.mobileColumns > 0 ||
      n.mobileFontSize > 0 ||
      n.mobileTextAlign !== 'same',
  );
  const checkbox = (key: 'hideOnMobile' | 'mobileFill', label: string, on: string, off: string) => (
    <label className="toggle-row">
      <input
        type="checkbox"
        checked={common(nodes, key) === true}
        ref={(el) => {
          if (el) el.indeterminate = common(nodes, key) === MIXED;
        }}
        onChange={(e) => set({ [key]: e.target.checked }, 'commit', e.target.checked ? on : off)}
      />
      {label}
    </label>
  );
  return (
    <details className="section mobile-section" open={changed || undefined}>
      <summary className="section-head">
        <span className="section-title">
          <Icon name="phone2" size={13} /> On phones
        </span>
        {changed && <span className="section-badge">Changed</span>}
      </summary>
      <p className="panel-hint">In exported code, below {MOBILE_BREAKPOINT}px wide. Preview at phone width to see it.</p>
      {checkbox('hideOnMobile', 'Hide on phones', 'Hide on phones', 'Show on phones')}
      {inLayout && checkbox('mobileFill', 'Full width on phones', 'Full width on phones', 'Keep width on phones')}
      {frames && !grids && (
        <SelectField
          name="Layout on phones"
          value={common(nodes, 'mobileLayout')}
          options={[
            { value: 'same', label: 'Same layout on phones' },
            { value: 'column', label: 'Stack as a column' },
            { value: 'row', label: 'Arrange as a row' },
          ]}
          onChange={(mobileLayout) => set({ mobileLayout }, 'commit', 'Layout on phones')}
        />
      )}
      {grids && (
        <div className="grid-2">
          <NumberField
            label="Cols"
            name="Columns on phones"
            value={common(nodes, 'mobileColumns') === 0 ? 1 : common(nodes, 'mobileColumns')}
            min={1}
            max={24}
            precision={0}
            onChange={(v, p) => set({ mobileColumns: Math.round(v) }, p, 'Columns on phones')}
          />
        </div>
      )}
      {texts && (
        <div className="grid-2">
          <NumberField
            label="Size"
            name="Font size on phones (0 for automatic)"
            value={common(nodes, 'mobileFontSize')}
            min={0}
            onChange={(v, p) => set({ mobileFontSize: v }, p, 'Font size on phones')}
          />
          <SelectField
            name="Text alignment on phones"
            value={common(nodes, 'mobileTextAlign')}
            options={[
              { value: 'same', label: 'Same alignment' },
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(mobileTextAlign) => set({ mobileTextAlign }, 'commit', 'Alignment on phones')}
          />
        </div>
      )}
    </details>
  );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** A note's colour and the layer it points at. */
export function NoteSection({ nodes, targetName, write }: { nodes: DesignNode[]; targetName: string | null; write: Writer }) {
  const ids = nodes.map((n) => n.id);
  const fill = common(nodes, 'fill');
  return (
    <section className="section" aria-label="Note">
      <div className="section-head">Note</div>
      <div className="note-colors" role="group" aria-label="Note colour">
        {NOTE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-pressed={fill === color}
            aria-label={`Colour ${color}`}
            className="note-swatch"
            style={{ background: color }}
            onClick={() => write(ids, { fill: color }, 'commit', 'Note colour')}
          />
        ))}
      </div>
      {nodes.length === 1 &&
        (targetName ? (
          <div className="note-target">
            <span>
              Points at <strong>{targetName}</strong>
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => write(ids, { noteTarget: '' }, 'commit', 'Remove arrow')}
            >
              Remove arrow
            </button>
          </div>
        ) : (
          <p className="panel-hint">Drag the dot on the note's edge onto a layer to point at it.</p>
        ))}
      <p className="panel-hint">Notes stay on the canvas, out of the exported code. The AI reads them as instructions.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Element role
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<Role, string> = {
  auto: 'Auto',
  button: 'Button',
  link: 'Link',
  nav: 'Navigation',
  header: 'Header',
  footer: 'Footer',
  section: 'Section',
  card: 'Card',
  heading: 'Heading',
  paragraph: 'Paragraph',
  label: 'Label',
  input: 'Input',
  image: 'Image',
  list: 'List',
  'list-item': 'List item',
};

export function RoleRow({ nodes, write }: { nodes: DesignNode[]; write: Writer }) {
  return (
    <div className="role-row">
      <span className="role-label" id="role-label">
        Element
      </span>
      <SelectField
        name="Element role"
        value={common(nodes, 'role')}
        options={ROLES.map((role) => ({ value: role, label: role === 'auto' ? 'Auto (from layer type)' : ROLE_LABELS[role] }))}
        onChange={(role) =>
          write(
            nodes.map((n) => n.id),
            { role },
            'commit',
            'Element role',
          )
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function AddRemoveHead({
  title,
  active,
  onAdd,
  onRemove,
}: {
  title: string;
  active: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={`section-head${active ? '' : ' is-empty'}`}>
      {title}
      <button
        type="button"
        className="icon-button"
        aria-label={`${active ? 'Remove' : 'Add'} ${title.toLowerCase()}`}
        data-tip={`${active ? 'Remove' : 'Add'} ${title.toLowerCase()}`}
        data-tip-side="left"
        onClick={active ? onRemove : onAdd}
      >
        <Icon name={active ? 'minus' : 'plus'} size={14} />
      </button>
    </div>
  );
}

export function ShadowSection({ nodes, write }: { nodes: DesignNode[]; write: Writer }) {
  const ids = nodes.map((n) => n.id);
  const color = common(nodes, 'shadowColor');
  const active = color !== null;
  const set = (props: Partial<NodeProps>, phase: Phase) => write(ids, props, phase, 'Shadow');
  return (
    <section className="section" aria-label="Shadow">
      <AddRemoveHead
        title="Shadow"
        active={active}
        onAdd={() =>
          write(
            ids,
            { shadowColor: '#0b0f1733', shadowX: 0, shadowY: 8, shadowBlur: 24, shadowSpread: 0 },
            'commit',
            'Add shadow',
          )
        }
        onRemove={() => write(ids, { shadowColor: null }, 'commit', 'Remove shadow')}
      />
      {active && (
        <>
          <ColorField
            name="Shadow"
            value={color === MIXED ? MIXED : (color as string)}
            onChange={(v, p) => set({ shadowColor: v }, p)}
          />
          <div className="grid-2">
            <NumberField label="X" name="Shadow X" value={common(nodes, 'shadowX')} onChange={(v, p) => set({ shadowX: v }, p)} />
            <NumberField label="Y" name="Shadow Y" value={common(nodes, 'shadowY')} onChange={(v, p) => set({ shadowY: v }, p)} />
            <NumberField
              label="Blur"
              name="Shadow blur"
              value={common(nodes, 'shadowBlur')}
              min={0}
              onChange={(v, p) => set({ shadowBlur: v }, p)}
            />
            <NumberField
              label="Spr"
              name="Shadow spread"
              value={common(nodes, 'shadowSpread')}
              onChange={(v, p) => set({ shadowSpread: v }, p)}
            />
          </div>
        </>
      )}
    </section>
  );
}

export function BlurSection({ nodes, write }: { nodes: DesignNode[]; write: Writer }) {
  const ids = nodes.map((n) => n.id);
  const blur = common(nodes, 'backdropBlur');
  const active = blur !== 0;
  return (
    <section className="section" aria-label="Background blur">
      <AddRemoveHead
        title="Background blur"
        active={active}
        onAdd={() => write(ids, { backdropBlur: 16 }, 'commit', 'Add background blur')}
        onRemove={() => write(ids, { backdropBlur: 0 }, 'commit', 'Remove background blur')}
      />
      {active && (
        <>
          <div className="grid-2">
            <NumberField
              label="Blur"
              name="Background blur amount"
              value={blur}
              min={0}
              max={200}
              onChange={(v, p) => write(ids, { backdropBlur: v }, p, 'Background blur')}
            />
          </div>
          <p className="panel-hint">Blurs whatever is behind this layer. Use a semi-transparent fill for frosted glass.</p>
        </>
      )}
    </section>
  );
}

/** Gradient controls shown under a fill: off, or a second colour and an angle. */
export function GradientRow({ nodes, write }: { nodes: DesignNode[]; write: Writer }) {
  const ids = nodes.map((n) => n.id);
  const to = common(nodes, 'gradientTo');
  const active = to !== null;
  return (
    <>
      <label className="toggle-row gradient-toggle">
        <input
          type="checkbox"
          checked={active && to !== MIXED}
          onChange={(e) =>
            write(
              ids,
              { gradientTo: e.target.checked ? '#7c4dff' : null },
              'commit',
              e.target.checked ? 'Add gradient' : 'Remove gradient',
            )
          }
        />
        Gradient
      </label>
      {active && (
        <>
          <ColorField
            name="Gradient end"
            value={to === MIXED ? MIXED : (to as string)}
            onChange={(v, p) => write(ids, { gradientTo: v }, p, 'Gradient')}
          />
          <div className="grid-2">
            <NumberField
              label={<Icon name="rotate" size={12} />}
              name="Gradient angle"
              value={common(nodes, 'gradientAngle')}
              min={0}
              max={360}
              suffix="°"
              onChange={(v, p) => write(ids, { gradientAngle: v }, p, 'Gradient')}
            />
          </div>
        </>
      )}
    </>
  );
}

export function ImageSection({ editor, nodes, write }: { editor: Editor; nodes: DesignNode[]; write: Writer }) {
  const single = nodes.length === 1 ? nodes[0] : null;
  return (
    <section className="section" aria-label="Image">
      <div className="section-head">Image</div>
      <div className="grid-2">
        <SelectField
          name="Image fit"
          value={common(nodes, 'fit')}
          options={[
            { value: 'cover', label: 'Fill (crop)' },
            { value: 'contain', label: 'Fit (whole)' },
            { value: 'fill', label: 'Stretch' },
          ]}
          onChange={(fit) =>
            write(
              nodes.map((n) => n.id),
              { fit },
              'commit',
              'Image fit',
            )
          }
        />
        {single && (
          <button type="button" className="button" onClick={() => void replaceImage(editor, single.id)}>
            {single.src ? 'Replace…' : 'Choose…'}
          </button>
        )}
      </div>
    </section>
  );
}
