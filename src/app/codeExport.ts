import { buildScreens, reactAppFiles, staticSiteFiles, type ExportInput } from '../codegen/exporters';
import { baseCss, screenCss, screenHtml, usesDisplayContents } from '../codegen/html';
import { kebab } from '../codegen/names';
import { listScreens } from '../codegen/screen';
import { zip } from '../codegen/zip';
import type { Editor } from '../editor/editor';
import type { DesignDocument } from '../model/types';
import { loadAssetFiles, toBase64 } from '../persistence/assets';
import { saveFile } from '../persistence/files';
import { FONT_URLS } from '../styles/fonts';

/**
 * The browser side of code export: gathering the images and fonts a design
 * uses, building the files, and saving them as a ZIP or showing a preview.
 */

let fontCache: Promise<Map<string, Uint8Array>> | null = null;

/** The bundled font files, fetched once from the app's own assets. */
function loadFontFiles(): Promise<Map<string, Uint8Array>> {
  fontCache ??= Promise.all(
    Object.entries(FONT_URLS).map(async ([file, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Couldn’t load the font ${file}.`);
      return [file, new Uint8Array(await response.arrayBuffer())] as const;
    }),
  )
    .then((entries) => new Map(entries))
    .catch((error) => {
      fontCache = null;
      throw error;
    });
  return fontCache;
}

function imageIds(doc: DesignDocument): string[] {
  return Object.values(doc.nodes)
    .filter((n) => n.type === 'image' && n.src)
    .map((n) => n.src);
}

export async function exportInput(doc: DesignDocument): Promise<ExportInput> {
  const [images, fonts] = await Promise.all([loadAssetFiles(imageIds(doc)), loadFontFiles()]);
  return { doc, images, fonts };
}

export type ExportKind = 'site' | 'react';

/** Saves the design as a ZIP: a static site or a React app. Returns false if cancelled. */
export async function exportZip(editor: Editor, kind: ExportKind): Promise<boolean> {
  const doc = editor.getState().doc;
  if (listScreens(doc).length === 0) {
    editor.notify('Nothing to export yet: each top-level frame becomes a page. Draw a frame with F.', 'error');
    return false;
  }
  const folder = `${kebab(doc.name, 6) || 'stylecode'}-${kind === 'site' ? 'site' : 'react'}`;
  return saveFile(`${folder}.zip`, { description: 'ZIP archive', mime: 'application/zip', extension: '.zip' }, async () => {
    const input = await exportInput(doc);
    const files = kind === 'site' ? staticSiteFiles(input) : reactAppFiles(input);
    const archive = zip(files.map((f) => ({ path: `${folder}/${f.path}`, content: f.content })));
    return new Blob([archive.buffer as ArrayBuffer], { type: 'application/zip' });
  });
}

const dataUrl = (type: string, data: Uint8Array) => `data:${type};base64,${toBase64(data)}`;

/**
 * A screen as one self-contained HTML document (styles, fonts and images
 * inlined), for the sandboxed preview.
 */
export async function previewDocument(doc: DesignDocument, screenId: string): Promise<{ html: string; width: number } | null> {
  const input = await exportInput(doc);
  const screen = buildScreens(input).find((s) => s.id === screenId);
  if (!screen) return null;
  const css =
    baseCss(screen.fonts, usesDisplayContents(screen.root), {
      fontUrl: (file) => dataUrl('font/woff2', input.fonts.get(file) ?? new Uint8Array()),
    }) +
    screenCss(screen).content +
    // Preview only: a scrollbar would take width from the page, so the preview at the design
    // width would lay out narrower than the design. The page still scrolls.
    '\nhtml { scrollbar-width: none; }\nhtml::-webkit-scrollbar { display: none; }\n';
  const html = screenHtml(screen, {
    imageUrl: (asset) => {
      const image = input.images.get(asset);
      return image ? dataUrl(image.type, image.data) : '';
    },
    inlineCss: css,
  }).content;
  return { html, width: screen.width };
}
