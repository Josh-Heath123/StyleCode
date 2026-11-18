import { createNode } from '../model/defaults';
import type { DesignNode, NodeProps, NodeType } from '../model/types';

/**
 * Ready-made blocks: common interface pieces built from auto-layout frames,
 * with semantic roles set, so they resize properly and export as clean code.
 * Each builder returns a fresh subtree, root first.
 */

export type BlockTheme = 'light' | 'dark';

interface Palette {
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  onPrimary: string;
  tint: string;
}

const PALETTES: Record<BlockTheme, Palette> = {
  light: {
    surface: '#ffffff',
    surfaceAlt: '#f4f5f8',
    text: '#11141a',
    muted: '#5b6474',
    border: '#e1e4ea',
    primary: '#2f7bff',
    onPrimary: '#ffffff',
    tint: '#2f7bff1f',
  },
  dark: {
    surface: '#121826',
    surfaceAlt: '#0f141f',
    text: '#f4f6fb',
    muted: '#a7afbf',
    border: '#ffffff1f',
    primary: '#2f7bff',
    onPrimary: '#ffffff',
    tint: '#2f7bff33',
  },
};

type Spec = { type: NodeType; props: Partial<NodeProps>; children?: Spec[] };

const el = (type: NodeType, props: Partial<NodeProps>, children: Spec[] = []): Spec => ({ type, props, children });

/** A text layer; `wrap` makes it fill the width available and wrap. */
const text = (content: string, props: Partial<NodeProps>, wrap = false): Spec =>
  el('text', {
    name: 'Text',
    text: content,
    ...(wrap ? { widthMode: 'fill', textResize: 'auto-height', width: 200 } : { textResize: 'auto-width' }),
    ...props,
  });

/** Turns a spec tree into nodes, root first, with ids wired up. */
function build(spec: Spec): DesignNode[] {
  const out: DesignNode[] = [];
  const visit = (s: Spec): DesignNode => {
    const node = createNode(s.type, s.props);
    out.push(node);
    node.children = (s.children ?? []).map((child) => {
      const c = visit(child);
      c.parentId = node.id;
      return c.id;
    });
    return node;
  };
  visit(spec);
  return out;
}

const frame = (props: Partial<NodeProps>, children: Spec[]) =>
  el('frame', { fill: null, clip: false, widthMode: 'hug', heightMode: 'hug', ...props }, children);

function button(p: Palette, label: string, primary: boolean, small = false): Spec {
  return frame(
    {
      name: `${label} button`,
      role: 'button',
      layout: 'row',
      justify: 'center',
      align: 'center',
      paddingTop: small ? 8 : 12,
      paddingBottom: small ? 8 : 12,
      paddingLeft: small ? 14 : 20,
      paddingRight: small ? 14 : 20,
      radius: 10,
      fill: primary ? p.primary : null,
      stroke: primary ? null : p.border,
      strokeWidth: 1,
    },
    [text(label, { fontSize: small ? 14 : 15, fontWeight: 600, fill: primary ? p.onPrimary : p.text })],
  );
}

function badge(p: Palette, label: string): Spec {
  return frame(
    {
      name: 'Badge',
      role: 'label',
      layout: 'row',
      align: 'center',
      paddingTop: 4,
      paddingBottom: 4,
      paddingLeft: 10,
      paddingRight: 10,
      radius: 999,
      fill: p.tint,
    },
    [text(label, { fontSize: 12, fontWeight: 600, fill: p.primary })],
  );
}

export interface BlockDefinition {
  id: string;
  name: string;
  description: string;
  build: (theme: BlockTheme) => DesignNode[];
}

export const BLOCKS: readonly BlockDefinition[] = [
  {
    id: 'button',
    name: 'Button',
    description: 'Primary action',
    build: (t) => build(button(PALETTES[t], 'Button', true)),
  },
  {
    id: 'button-secondary',
    name: 'Secondary button',
    description: 'Outlined action',
    build: (t) => build(button(PALETTES[t], 'Button', false)),
  },
  {
    id: 'badge',
    name: 'Badge',
    description: 'Small pill label',
    build: (t) => build(badge(PALETTES[t], 'New')),
  },
  {
    id: 'text-field',
    name: 'Text field',
    description: 'Label and input',
    build: (t) => {
      const p = PALETTES[t];
      return build(
        frame({ name: 'Text field', layout: 'column', gap: 6, widthMode: 'fixed', width: 280 }, [
          text('Email', { name: 'Label', role: 'label', fontSize: 13, fontWeight: 500, fill: p.muted }),
          frame(
            {
              name: 'Input',
              role: 'input',
              layout: 'row',
              align: 'center',
              widthMode: 'fill',
              paddingTop: 10,
              paddingBottom: 10,
              paddingLeft: 12,
              paddingRight: 12,
              radius: 8,
              fill: p.surface,
              stroke: p.border,
              strokeWidth: 1,
            },
            [text('you@example.com', { name: 'Placeholder', fontSize: 15, fill: p.muted })],
          ),
        ]),
      );
    },
  },
  {
    id: 'card',
    name: 'Card',
    description: 'Image, title, text and action',
    build: (t) => {
      const p = PALETTES[t];
      return build(
        frame(
          {
            name: 'Card',
            role: 'card',
            layout: 'column',
            gap: 12,
            paddingTop: 16,
            paddingBottom: 20,
            paddingLeft: 16,
            paddingRight: 16,
            widthMode: 'fixed',
            width: 320,
            radius: 16,
            fill: p.surface,
            stroke: p.border,
            strokeWidth: 1,
            shadowColor: t === 'light' ? '#0b0f171a' : '#00000066',
            shadowY: 8,
            shadowBlur: 24,
            clip: true,
          },
          [
            el('image', { name: 'Image', role: 'image', widthMode: 'fill', height: 160, radius: 10, fill: p.surfaceAlt }),
            text('Card title', { name: 'Title', role: 'heading', fontSize: 18, fontWeight: 600, fill: p.text }, true),
            text(
              'A short description of what this card is about.',
              { name: 'Description', role: 'paragraph', fontSize: 15, lineHeight: 1.5, fill: p.muted },
              true,
            ),
            button(p, 'Learn more', false, true),
          ],
        ),
      );
    },
  },
  {
    id: 'navigation',
    name: 'Navigation bar',
    description: 'Logo, links and a button',
    build: (t) => {
      const p = PALETTES[t];
      return build(
        frame(
          {
            name: 'Navigation',
            role: 'nav',
            layout: 'row',
            justify: 'space-between',
            align: 'center',
            gap: 24,
            widthMode: 'fixed',
            width: 1200,
            paddingTop: 16,
            paddingBottom: 16,
            paddingLeft: 32,
            paddingRight: 32,
            fill: p.surface,
          },
          [
            text('Brand', { name: 'Logo', fontSize: 19, fontWeight: 700, letterSpacing: -0.3, fill: p.text }),
            frame(
              { name: 'Links', role: 'list', layout: 'row', gap: 28, align: 'center' },
              ['Product', 'Pricing', 'About'].map((label) =>
                text(label, { name: label, role: 'link', fontSize: 15, fontWeight: 500, fill: p.muted }),
              ),
            ),
            button(p, 'Sign up', true, true),
          ],
        ),
      );
    },
  },
  {
    id: 'hero',
    name: 'Hero section',
    description: 'Headline, text and two actions',
    build: (t) => {
      const p = PALETTES[t];
      return build(
        frame(
          {
            name: 'Hero',
            role: 'section',
            layout: 'column',
            gap: 20,
            align: 'center',
            widthMode: 'fixed',
            width: 960,
            paddingTop: 72,
            paddingBottom: 72,
            paddingLeft: 64,
            paddingRight: 64,
            radius: 24,
            fill: p.surfaceAlt,
          },
          [
            badge(p, 'New'),
            text(
              'A headline that says what it does',
              {
                name: 'Headline',
                role: 'heading',
                fontSize: 44,
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: -1,
                textAlign: 'center',
                fill: p.text,
              },
              true,
            ),
            text(
              'One or two sentences that explain the value, written for the people who will use it.',
              { name: 'Subheading', role: 'paragraph', fontSize: 18, lineHeight: 1.5, textAlign: 'center', fill: p.muted },
              true,
            ),
            frame({ name: 'Actions', layout: 'row', gap: 12, align: 'center' }, [
              button(p, 'Get started', true),
              button(p, 'Learn more', false),
            ]),
          ],
        ),
      );
    },
  },
];

export function findBlock(id: string): BlockDefinition | undefined {
  return BLOCKS.find((b) => b.id === id);
}
