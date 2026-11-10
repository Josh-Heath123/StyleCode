/**
 * The paragraphs of a Word document (`.docx`), as text. Only what a
 * transcript needs is read from `word/document.xml`: text runs, tabs and line
 * breaks, paragraph by paragraph. The XML is scanned rather than parsed with
 * `DOMParser`, which Node (and so the unit tests) doesn't have; the scan is
 * enough because WordprocessingML keeps text only in `<w:t>` elements.
 */
import { decodeText, decodeEntities } from './text.ts';
import { readZipEntry, ZipError } from './zip.ts';

/** The document's paragraphs, a tab as `\t` and a line break as `\n`; null if it isn't a Word document. */
export async function docxParagraphs(bytes: Uint8Array): Promise<string[] | null> {
  let xml: Uint8Array | null;
  try {
    xml = await readZipEntry(bytes, 'word/document.xml');
  } catch (error) {
    if (error instanceof ZipError) return null;
    throw error;
  }
  if (!xml) return null;
  return paragraphsOf(decodeText(xml));
}

/** Exported for tests: the paragraphs of WordprocessingML text. */
export function paragraphsOf(xml: string): string[] {
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? '';
  const paragraphs: string[] = [];
  // Each paragraph is `<w:p …>…</w:p>`, or empty as `<w:p/>`. Text boxes nest paragraphs; their text joins the outer one.
  const token =
    /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>|<\/w:p>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\s*\/>/g;
  let depth = 0;
  let current = '';
  for (const m of body.matchAll(token)) {
    const tag = m[0];
    if (tag.startsWith('<w:p') && tag.endsWith('/>')) {
      if (depth === 0) paragraphs.push('');
    } else if (tag.startsWith('<w:p')) {
      if (depth === 0) current = '';
      depth++;
    } else if (tag === '</w:p>') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) paragraphs.push(current);
    } else if (tag.startsWith('<w:tab')) current += '\t';
    else if (tag.startsWith('<w:br') || tag.startsWith('<w:cr')) current += '\n';
    else if (m[1] !== undefined) current += decodeEntities(m[1]);
  }
  return paragraphs;
}
