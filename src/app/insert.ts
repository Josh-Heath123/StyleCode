import { screenToWorld } from '../editor/camera';
import type { Editor } from '../editor/editor';
import { flowInsertion } from '../model/autolayout';
import { applyToPoint, childSpaceMatrix, invert, worldBounds } from '../model/geometry';
import { createDocument } from '../model/document';
import { applyOps } from '../model/ops';
import { normalizeDocument } from '../canvas/normalize';
import { containerAtPoint } from '../model/hit';
import { createNode } from '../model/defaults';
import { isAutoLayout } from '../model/layout';
import { cloneNodes } from '../model/commands';
import type { DesignNode, Point } from '../model/types';
import { storeImage } from '../persistence/assets';

/**
 * Inserting things: images from files and ready-made blocks. Both go to the
 * point they were dropped at, or, when added with a click, into the selected
 * frame or the frame in the middle of the view.
 */

/** Where an inserted layer goes: into a container at an index, centred on a point or placed below a sibling. */
interface Placement {
  parentId: string;
  index: number;
  center?: Point;
  below?: string;
}

/**
 * Where a click-inserted layer goes. Plain frames (a screen, a row) receive
 * it inside; a selected component (anything with a role, or a shape) gets the
 * new layer next to it. With nothing selected it goes in the middle of the view.
 */
function clickPlacement(editor: Editor): Placement {
  const { doc, selection, camera } = editor.getState();
  const only = selection.length === 1 ? doc.nodes[selection[0]] : null;
  if (only?.type === 'frame' && only.role === 'auto') {
    const m = childSpaceMatrix(doc, only.id);
    return { parentId: only.id, index: only.children.length, center: applyToPoint(m, { x: only.width / 2, y: only.height / 2 }) };
  }
  if (only?.parentId) {
    return { parentId: only.parentId, index: doc.nodes[only.parentId].children.indexOf(only.id) + 1, below: only.id };
  }
  const center = screenToWorld(camera, { x: editor.viewport.width / 2, y: editor.viewport.height / 2 });
  const parentId = containerAtPoint(doc, center);
  return { parentId, index: doc.nodes[parentId].children.length, center };
}

function dropPlacement(editor: Editor, at: Point): Placement {
  const { doc } = editor.getState();
  const parentId = containerAtPoint(doc, at);
  const local = applyToPoint(invert(childSpaceMatrix(doc, parentId)), at);
  const index = isAutoLayout(doc.nodes[parentId])
    ? flowInsertion(doc, parentId, local, new Set()).index
    : doc.nodes[parentId].children.length;
  return { parentId, index, center: at };
}

/** Resolves auto-layout and text sizes of a detached subtree, so it can be placed by its real size. */
function laidOut(nodes: DesignNode[]): DesignNode[] {
  const base = createDocument();
  let doc = applyOps(base, [{ type: 'create', parentId: base.rootId, index: 0, nodes }]).doc;
  const extra = normalizeDocument(doc, new Set(nodes.map((n) => n.id)), base);
  if (extra.length) doc = applyOps(doc, extra).doc;
  return nodes.map((n) => doc.nodes[n.id]);
}

/** Inserts a subtree (root first) with fresh ids and selects it. */
export function insertNodes(editor: Editor, nodes: DesignNode[], placement: Placement, label: string): void {
  const { doc } = editor.getState();
  const copy = cloneNodes(laidOut(nodes));
  const root = copy[0];
  let center = placement.center;
  if (placement.below) {
    const b = worldBounds(doc, placement.below);
    center = { x: b.x + root.width / 2, y: b.y + b.height + 24 + root.height / 2 };
  }
  const local = applyToPoint(invert(childSpaceMatrix(doc, placement.parentId)), center ?? { x: 0, y: 0 });
  copy[0] = {
    ...root,
    parentId: placement.parentId,
    x: Math.round(local.x - root.width / 2),
    y: Math.round(local.y - root.height / 2),
  };
  editor.apply([{ type: 'create', parentId: placement.parentId, index: placement.index, nodes: copy }], {
    label,
    selection: [root.id],
  });
}

export function insertAtPoint(editor: Editor, nodes: DesignNode[], at: Point, label: string): void {
  insertNodes(editor, nodes, dropPlacement(editor, at), label);
}

const IMAGE_LIMIT = 480;

/** Stores image files and adds them as image layers. */
export async function insertImageFiles(editor: Editor, files: readonly File[], dropAt?: Point): Promise<void> {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (images.length === 0) return editor.notify('Those files are not images.', 'error');
  const projectId = editor.getState().doc.id;
  for (const [i, file] of images.entries()) {
    try {
      const asset = await storeImage(file);
      await editor.whenIdle();
      // Another project was opened while the image was loading.
      if (editor.getState().doc.id !== projectId) return;
      const scale = Math.min(1, IMAGE_LIMIT / Math.max(asset.width, asset.height));
      const node = createNode('image', {
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Image',
        src: asset.id,
        width: Math.max(1, Math.round(asset.width * scale)),
        height: Math.max(1, Math.round(asset.height * scale)),
      });
      if (dropAt) insertAtPoint(editor, [node], { x: dropAt.x + i * 24, y: dropAt.y + i * 24 }, 'Add image');
      else insertNodes(editor, [node], clickPlacement(editor), 'Add image');
    } catch (error) {
      editor.notify((error as Error).message, 'error');
    }
  }
}

/** Opens the system file picker for images. */
export function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export async function insertImagesFromPicker(editor: Editor): Promise<void> {
  const files = await pickImages();
  if (files.length) await insertImageFiles(editor, files);
}

/** Replaces the picture in an existing image layer, keeping its box. */
export async function replaceImage(editor: Editor, id: string): Promise<void> {
  const [file] = await pickImages();
  if (!file) return;
  try {
    const asset = await storeImage(file);
    await editor.whenIdle();
    if (editor.getState().doc.nodes[id]?.type !== 'image') return;
    editor.apply([{ type: 'update', id, props: { src: asset.id } }], { label: 'Replace image' });
  } catch (error) {
    editor.notify((error as Error).message, 'error');
  }
}

/** Inserts with a click: into the selected container, next to the selected layer, or mid-view. */
export function insertAtClickTarget(editor: Editor, nodes: DesignNode[], label: string): void {
  insertNodes(editor, nodes, clickPlacement(editor), label);
}
