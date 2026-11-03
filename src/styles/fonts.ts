// Inter ships with the app so the canvas, text measurement and the UI look the
// same on every machine, offline included. It is registered as "Inter" so
// designs reference the same family name the exported code will use.
import latinExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url';
import latin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';

const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT_RANGE =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

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
