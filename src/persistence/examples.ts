import { measureText } from '../canvas/measure';
import { createNode } from '../model/defaults';
import { createDocument } from '../model/document';
import { OpBuilder } from '../model/ops';
import type { DesignDocument, NodeProps, NodeType } from '../model/types';

/**
 * A small example project: a landing page roughed out with frames, shapes
 * and text, the way someone might sketch one before refining it. It shows
 * nesting, typography and styling, and gives new users something to poke at.
 */
export function createExampleDocument(): DesignDocument {
  const builder = new OpBuilder(createDocument('Example: landing page'));
  const rootId = builder.doc.rootId;

  const add = (parentId: string, type: NodeType, props: Partial<NodeProps>): string => {
    const node = createNode(type, props);
    if (type === 'text') {
      const size = measureText(node);
      if (node.textResize === 'auto-width') node.width = size.width;
      if (node.textResize !== 'fixed') node.height = size.height;
    }
    const index = builder.doc.nodes[parentId].children.length;
    builder.push({ type: 'create', parentId, index, nodes: [node] });
    return node.id;
  };

  const text = (parentId: string, props: Partial<NodeProps>) =>
    add(parentId, 'text', { name: 'Text', fontFamily: 'Inter', textResize: 'auto-width', ...props });

  /** A button: a rounded frame with its label centred inside. */
  const button = (parentId: string, label: string, x: number, y: number, width: number, height: number, primary: boolean) => {
    const id = add(parentId, 'frame', {
      name: `${label} button`,
      x,
      y,
      width,
      height,
      radius: 12,
      clip: false,
      fill: primary ? '#2f7bff' : null,
      stroke: primary ? null : '#ffffff33',
      strokeWidth: 1,
    });
    const inset = primary ? 0 : 1;
    const probe = createNode('text', { text: label, fontSize: 16, fontWeight: 600 });
    const size = measureText(probe);
    text(id, {
      text: label,
      fontSize: 16,
      fontWeight: 600,
      fill: '#ffffff',
      x: Math.round((width - size.width) / 2 - inset),
      y: Math.round((height - size.height) / 2 - inset),
    });
    return id;
  };

  const page = add(rootId, 'frame', { name: 'Landing page', x: 0, y: 0, width: 1440, height: 900, fill: '#0b0f17' });

  // Navigation
  const nav = add(page, 'frame', { name: 'Navigation', x: 0, y: 0, width: 1440, height: 76, fill: null, clip: false });
  text(nav, { text: 'Fieldnote', fontSize: 20, fontWeight: 700, letterSpacing: -0.3, fill: '#ffffff', x: 64, y: 24 });
  let linkX = 560;
  for (const label of ['Product', 'Pricing', 'Customers', 'Docs']) {
    const id = text(nav, { text: label, fontSize: 15, fontWeight: 500, fill: '#a7afbf', x: linkX, y: 27 });
    linkX += builder.doc.nodes[id].width + 40;
  }
  button(nav, 'Get started', 1240, 16, 136, 44, true);

  // Hero
  text(page, {
    name: 'Headline',
    text: 'Research notes that\norganise themselves',
    fontSize: 60,
    fontWeight: 700,
    lineHeight: 1.08,
    letterSpacing: -1.5,
    fill: '#ffffff',
    x: 64,
    y: 188,
  });
  text(page, {
    name: 'Subheading',
    text: 'Capture interviews, tag what matters and share findings with your team, without the busywork.',
    fontSize: 19,
    lineHeight: 1.5,
    fill: '#a7afbf',
    textResize: 'auto-height',
    width: 520,
    x: 64,
    y: 352,
  });
  button(page, 'Start free', 64, 460, 156, 52, true);
  button(page, 'Watch demo', 236, 460, 156, 52, false);

  // Product shot, roughed out with shapes
  const shot = add(page, 'frame', {
    name: 'Product shot',
    x: 760,
    y: 132,
    width: 616,
    height: 400,
    radius: 20,
    fill: '#131a27',
    stroke: '#ffffff17',
    strokeWidth: 1,
  });
  add(shot, 'rect', { name: 'Sidebar', x: 20, y: 20, width: 140, height: 358, radius: 10, fill: '#1a2232' });
  add(shot, 'rect', { name: 'Toolbar', x: 176, y: 20, width: 418, height: 40, radius: 10, fill: '#1a2232' });
  add(shot, 'rect', { name: 'Note', x: 176, y: 76, width: 200, height: 140, radius: 10, fill: '#1f2a3d' });
  add(shot, 'rect', { name: 'Note', x: 392, y: 76, width: 202, height: 140, radius: 10, fill: '#1f2a3d' });
  add(shot, 'rect', { name: 'Chart', x: 176, y: 232, width: 418, height: 146, radius: 10, fill: '#1a2232' });
  add(shot, 'ellipse', { name: 'Highlight', x: 520, y: 100, width: 48, height: 48, fill: '#ffa05c' });

  // Feature cards
  const features = [
    { title: 'Tag as you go', body: 'Highlight a quote and tag it. Patterns surface on their own.', accent: '#2f7bff' },
    {
      title: 'Shared by default',
      body: 'Every note links back to its source, so findings travel with evidence.',
      accent: '#ffa05c',
    },
    {
      title: 'Answers, not folders',
      body: 'Ask a question across every interview and get the quotes that answer it.',
      accent: '#3ecf8e',
    },
  ];
  features.forEach((f, i) => {
    const card = add(page, 'frame', {
      name: `${f.title} card`,
      x: 64 + i * 448,
      y: 624,
      width: 416,
      height: 200,
      radius: 16,
      fill: '#121826',
      stroke: '#ffffff12',
      strokeWidth: 1,
    });
    add(card, 'ellipse', { name: 'Icon', x: 27, y: 27, width: 40, height: 40, fill: f.accent });
    text(card, { name: 'Title', text: f.title, fontSize: 19, fontWeight: 600, fill: '#ffffff', x: 27, y: 87 });
    text(card, {
      name: 'Description',
      text: f.body,
      fontSize: 15,
      lineHeight: 1.5,
      fill: '#a7afbf',
      textResize: 'auto-height',
      width: 340,
      x: 27,
      y: 121,
    });
  });

  return builder.doc;
}
