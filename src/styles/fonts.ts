// Inter ships with the app so the canvas, text measurement and the UI look the
// same on every machine, offline included. It is registered as "Inter" so
// designs reference the same family name the exported code will use.
import latinExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url';
import latin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import { LATIN_EXT_RANGE, LATIN_RANGE } from '../codegen/fonts';

/** URLs of the bundled font files, by file name, for the canvas and for exported code. */
export const FONT_URLS: Record<string, string> = {
  'inter-latin-wght-normal.woff2': latin,
  'inter-latin-ext-wght-normal.woff2': latinExt,
};

/** Registers the bundled Inter font and resolves once it is ready to measure with. */
export async function loadFonts(): Promise<void> {
  const faces = [
    new FontFace('Inter', `url(${latin}) format('woff2')`, { weight: '100 900', style: 'normal', unicodeRange: LATIN_RANGE }),
    new FontFace('Inter', `url(${latinExt}) format('woff2')`, {
      weight: '100 900',
      style: 'normal',
      unicodeRange: LATIN_EXT_RANGE,
    }),
  ];
  for (const face of faces) document.fonts.add(face);
  try {
    await Promise.all(faces.map((f) => f.load()));
  } catch {
    // If the font cannot load the system fallback is used; the app still works.
  }
}
