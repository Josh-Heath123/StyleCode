import { addAutoLayout, removeAutoLayout } from '../app/actions';
import { replaceImage } from '../app/insert';
import type { Editor } from '../editor/editor';
import { canFill, effectiveSizing, isAutoLayout } from '../model/layout';
import { ROLES, type DesignNode, type NodeProps, type Role, type SizingMode } from '../model/types';
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

/** The properties that give a layer a sizing mode. Text expresses hug and fixed through its resizing. */
export function sizingProps(node: DesignNode, axis: Axis, mode: SizingMode): Partial<NodeProps> {
  const modeKey = axis === 'width' ? 'widthMode' : 'heightMode';
  if (node.type !== 'text') return { [modeKey]: mode };
  if (axis === 'width') {
    if (mode === 'hug') return { widthMode: 'fixed', textResize: 'auto-width' };
    return { widthMode: mode, textResize: node.textResize === 'auto-width' ? 'auto-height' : node.textResize };
  }
  if (mode === 'fixed') return { heightMode: 'fixed', textResize: 'fixed' };
  // Text that hugs its width keeps doing so; the parent decides its height.
  if (mode === 'fill') return { heightMode: 'fill', textResize: node.textResize === 'auto-width' ? 'auto-width' : 'fixed' };
  return { heightMode: 'fixed', textResize: node.textResize === 'fixed' ? 'auto-height' : node.textResize };
}

/**
 * Typing a width or height gives the layer that size, so that axis stops
 * hugging or filling (as resizing with the handles does). Text that hugged its
 * width wraps at the new width instead.
 */
export function fixedWidth(node: DesignNode): Partial<NodeProps> {
  const props: Partial<NodeProps> = {};
  if (node.widthMode !== 'fixed') props.widthMode = 'fixed';
  if (node.type === 'text' && node.textResize === 'auto-width') props.textResize = 'auto-height';
  return props;
}

export function fixedHeight(node: DesignNode): Partial<NodeProps> {
  const props: Partial<NodeProps> = {};
  if (node.heightMode !== 'fixed') props.heightMode = 'fixed';
  if (node.type === 'text' && node.textResize !== 'fixed') props.textResize = 'fixed';
  return props;
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
              value={direction === MIXED ? MIXED : (direction as 'row' | 'column')}
              options={[
                { value: 'row', icon: 'arrowRight', label: 'Row' },
                { value: 'column', icon: 'arrowDown', label: 'Column' },
              ]}
              onChange={(layout) => set({ layout }, 'commit', 'Layout direction')}
            />
            <NumberField
              label={<Icon name="gap" size={12} />}
              name="Gap"
              value={common(nodes, 'gap')}
              min={0}
              onChange={(v, p) => set({ gap: v }, p, 'Gap')}
            />
          </div>
          <div className="grid-2">
            <Segmented
              name="Align items"
              value={common(nodes, 'align')}
              options={
                row
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
            <SelectField
              name="Distribution"
              value={common(nodes, 'justify')}
              options={JUSTIFY_OPTIONS.map((o) => ({ ...o }))}
              onChange={(justify) => set({ justify }, 'commit', 'Distribution')}
            />
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
        </>
      )}
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
