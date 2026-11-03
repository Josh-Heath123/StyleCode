import { BUNDLED_FONTS, fontFilesFor } from './fonts';
import { baseCss, screenCss, screenHtml, usesDisplayContents } from './html';
import { kebab } from './names';
import { screenReact } from './react';
import { buildScreen, listScreens, type Screen } from './screen';
import type { DesignDocument } from '../model/types';

/**
 * Whole exports: a static website (HTML and CSS) or a small Vite + React
 * app. Both are pure functions of the document plus the bytes of the images
 * and fonts it uses, so they can be tested without a browser.
 */

export interface ExportFile {
  path: string;
  content: string | Uint8Array;
}

export interface ExportInput {
  doc: DesignDocument;
  /** Images available on this device, by asset id. */
  images: ReadonlyMap<string, { type: string; data: Uint8Array }>;
  /** Bundled font files, by file name. */
  fonts: ReadonlyMap<string, Uint8Array>;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

export function extensionFor(type: string): string {
  return EXTENSIONS[type] ?? 'img';
}

/** Whether exported code can use an image of this type (browsers show it, and it has a file extension). */
export function isExportableImage(type: string): boolean {
  return type in EXTENSIONS;
}

/** The screens to export, built with knowledge of which images exist. */
export function buildScreens(input: Pick<ExportInput, 'doc' | 'images'>): Screen[] {
  const available = new Set([...input.images].filter(([, image]) => isExportableImage(image.type)).map(([id]) => id));
  // `index` and `base` are taken by the first page and the shared stylesheet.
  const slugs = new Set<string>(['index', 'base']);
  return listScreens(input.doc).map((frame) => {
    const screen = buildScreen(input.doc, frame.id, { availableAssets: available });
    // Each screen gets its own file name.
    let slug = screen.slug;
    for (let n = 2; slugs.has(slug); n++) slug = `${screen.slug}-${n}`;
    slugs.add(slug);
    return { ...screen, slug };
  });
}

function imageFile(input: ExportInput, asset: string): string {
  return `${asset}.${extensionFor(input.images.get(asset)?.type ?? '')}`;
}

function allFonts(screens: Screen[]): string[] {
  return [...new Set(screens.flatMap((s) => s.fonts))];
}

function fontFiles(input: ExportInput, screens: Screen[], folder: string): ExportFile[] {
  return fontFilesFor(allFonts(screens))
    .filter((f) => input.fonts.has(f.file))
    .map((f) => ({ path: `${folder}/${f.file}`, content: input.fonts.get(f.file)! }));
}

function imageFiles(input: ExportInput, screens: Screen[], folder: string): ExportFile[] {
  const assets = [...new Set(screens.flatMap((s) => s.assets))];
  return assets.map((asset) => ({ path: `${folder}/${imageFile(input, asset)}`, content: input.images.get(asset)!.data }));
}

// ---------------------------------------------------------------------------
// Static site
// ---------------------------------------------------------------------------

/** One HTML page per screen (the first is index.html), a stylesheet per screen, shared base styles and assets. */
export function staticSiteFiles(input: ExportInput): ExportFile[] {
  const screens = buildScreens(input);
  const files: ExportFile[] = [];
  const contents = screens.some((s) => usesDisplayContents(s.root));
  files.push({ path: 'base.css', content: baseCss(allFonts(screens), contents, { fontUrl: (f) => `assets/fonts/${f}` }) });
  screens.forEach((screen, i) => {
    const page = i === 0 ? 'index.html' : `${screen.slug}.html`;
    files.push({
      path: page,
      content: screenHtml(screen, {
        imageUrl: (asset) => `assets/${imageFile(input, asset)}`,
        stylesheets: ['base.css', `${screen.slug}.css`],
      }).content,
    });
    files.push({ path: `${screen.slug}.css`, content: screenCss(screen).content });
  });
  files.push(...imageFiles(input, screens, 'assets'), ...fontFiles(input, screens, 'assets/fonts'));
  files.push({ path: 'README.md', content: staticReadme(input.doc, screens) });
  return files;
}

function staticReadme(doc: DesignDocument, screens: Screen[]): string {
  const list = screens.map((s, i) => `- \`${i === 0 ? 'index.html' : `${s.slug}.html`}\`: ${s.name || 'Screen'}`).join('\n');
  return `# ${doc.name || 'Untitled'}

Exported from StyleCode as a static website: plain HTML and CSS, no build step and no JavaScript.

${list}

Open \`index.html\` in a browser, or upload the whole folder to any static host.

- \`base.css\` holds shared base styles${screens.some((s) => s.fonts.includes('Inter')) ? ' and the bundled Inter font (SIL Open Font License)' : ''}.
- Each page has its own stylesheet. Pages match the design at its width; below it, the rules at the end of each stylesheet let rows wrap and large text and spacing scale down.
- \`assets/\` holds the images and fonts the pages use.
`;
}

// ---------------------------------------------------------------------------
// React app
// ---------------------------------------------------------------------------

/** Kept in step with the versions StyleCode itself is built and tested with. */
const VERSIONS = {
  react: '^19.3.1',
  'react-dom': '^19.3.1',
  '@types/react': '^19.3.0',
  '@types/react-dom': '^19.3.0',
  '@vitejs/plugin-react': '^6.2.1',
  typescript: '^7.0.2',
  vite: '^8.3.5',
};

/** A Vite + React + TypeScript app with one component per screen. */
export function reactAppFiles(input: ExportInput): ExportFile[] {
  const screens = buildScreens(input);
  const name = kebab(input.doc.name, 6) || 'stylecode-app';
  const files: ExportFile[] = [];
  const components: { name: string; slug: string }[] = [];

  for (const screen of screens) {
    // Screen components need names App.tsx doesn't already use.
    const reserved = new Set([...APP_NAMES, ...components.map((c) => c.name)]);
    const printed = screenReact(screen, { imagePath: (asset) => `../assets/${imageFile(input, asset)}`, reserved });
    const componentName = printed.componentName;
    components.push({ name: componentName, slug: screen.slug });
    files.push({ path: `src/screens/${componentName}.tsx`, content: printed.tsx.content });
    files.push({ path: `src/screens/${componentName}.module.css`, content: printed.css.content });
  }

  const contents = screens.some((s) => usesDisplayContents(s.root));
  files.push({ path: 'src/index.css', content: baseCss(allFonts(screens), contents, { fontUrl: (f) => `./fonts/${f}` }) });
  files.push({ path: 'src/App.tsx', content: appTsx(components) });
  files.push({ path: 'src/main.tsx', content: MAIN_TSX });
  files.push({ path: 'src/vite-env.d.ts', content: '/// <reference types="vite/client" />\n' });
  files.push({ path: 'index.html', content: indexHtml(input.doc.name || 'Untitled') });
  files.push({ path: 'package.json', content: packageJson(name) });
  files.push({ path: 'tsconfig.json', content: TSCONFIG });
  files.push({ path: 'vite.config.ts', content: VITE_CONFIG });
  files.push({ path: '.gitignore', content: 'node_modules\ndist\n' });
  files.push({ path: 'README.md', content: reactReadme(input.doc, components) });
  files.push(...imageFiles(input, screens, 'src/assets'), ...fontFiles(input, screens, 'src/fonts'));
  return files;
}

const APP_NAMES = new Set(['App', 'Screen', 'ScreenName', 'StrictMode']);

function appTsx(components: { name: string; slug: string }[]): string {
  if (components.length === 0) return 'export default function App() {\n  return null;\n}\n';
  const imports = components.map((c) => `import ${c.name} from './screens/${c.name}';`).join('\n');
  if (components.length === 1) {
    return `${imports}\n\nexport default function App() {\n  return <${components[0].name} />;\n}\n`;
  }
  const entries = components.map((c) => `  '${c.slug}': ${c.name},`).join('\n');
  return `import { useEffect, useState } from 'react';
${imports}

// Each screen has its own address: #${components[1].slug} shows ${components[1].name}, and so on.
const screens = {
${entries}
};

type ScreenName = keyof typeof screens;

function screenFromHash(): ScreenName {
  const name = window.location.hash.slice(1);
  return Object.hasOwn(screens, name) ? (name as ScreenName) : '${components[0].slug}';
}

export default function App() {
  const [name, setName] = useState(screenFromHash);
  useEffect(() => {
    const update = () => setName(screenFromHash());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const Screen = screens[name];
  return <Screen />;
}
`;
}

const MAIN_TSX = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

function indexHtml(title: string): string {
  const safe = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safe}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function packageJson(name: string): string {
  return `${JSON.stringify(
    {
      name,
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview' },
      dependencies: { react: VERSIONS.react, 'react-dom': VERSIONS['react-dom'] },
      devDependencies: {
        '@types/react': VERSIONS['@types/react'],
        '@types/react-dom': VERSIONS['@types/react-dom'],
        '@vitejs/plugin-react': VERSIONS['@vitejs/plugin-react'],
        typescript: VERSIONS.typescript,
        vite: VERSIONS.vite,
      },
    },
    null,
    2,
  )}\n`;
}

const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      isolatedModules: true,
      skipLibCheck: true,
      types: ['vite/client'],
      noEmit: true,
    },
    include: ['src', 'vite.config.ts'],
  },
  null,
  2,
)}\n`;

const VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

function reactReadme(doc: DesignDocument, components: { name: string; slug: string }[]): string {
  const list = components
    .map((c, i) => `- \`src/screens/${c.name}.tsx\`${components.length > 1 ? ` (${i === 0 ? '/' : `/#${c.slug}`})` : ''}`)
    .join('\n');
  return `# ${doc.name || 'Untitled'}

Exported from StyleCode as a Vite + React + TypeScript app. You need Node.js 22.12 or newer.

\`\`\`bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build in dist/
\`\`\`

## Screens

${list}

Each screen is a component with its own CSS module. Repeated structures, such as a row of cards, are components inside the screen's file, with whatever differs between them (text, images, colours) passed in as props.

Screens match the design at its width; below it, the rules at the end of each CSS module let rows wrap and large text and spacing scale down. Shared base styles${BUNDLED_FONTS.length ? ' and the bundled Inter font (SIL Open Font License)' : ''} are in \`src/index.css\`.
`;
}
