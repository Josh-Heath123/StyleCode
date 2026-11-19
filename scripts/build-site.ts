/**
 * Builds the documentation site from the Markdown docs into `site/`:
 *
 *   node --experimental-strip-types scripts/build-site.ts
 *
 * The Pages workflow then builds the app itself into `site/app/`, so the site
 * has a live demo. No dependencies: Markdown is converted by ./markdown.ts.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, renderMarkdown } from './markdown.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, process.argv[2] ?? 'site');
const REPO = 'https://github.com/Josh-Heath123/StyleCode';

const PAGES = [
  { src: 'README.md', out: 'index.html', nav: 'Overview' },
  { src: 'docs/GUIDE.md', out: 'guide.html', nav: 'Guide' },
  { src: 'docs/ARCHITECTURE.md', out: 'architecture.html', nav: 'Architecture' },
  { src: 'docs/ROADMAP.md', out: 'roadmap.html', nav: 'Roadmap' },
  { src: 'CONTRIBUTING.md', out: 'contributing.html', nav: 'Contributing' },
];

/** Where a link in a document should point on the site. */
function linkFor(from: string, href: string): string {
  if (/^([a-z]+:|#|\/\/)/i.test(href)) return href;
  const [path, hash] = href.split('#');
  const resolved = normalize(join(dirname(from), path)).replace(/\\/g, '/');
  const page = PAGES.find((p) => p.src === resolved);
  if (page) return `${page.out}${hash ? `#${hash}` : ''}`;
  if (resolved.startsWith('docs/') && /\.(png|gif|jpe?g|svg|webp)$/i.test(resolved)) return resolved.slice('docs/'.length);
  // Anything else (source files, the licence) is shown on GitHub.
  return `${REPO}/blob/main/${resolved}${hash ? `#${hash}` : ''}`;
}

const CSS = `
@font-face { font-family: Inter; src: url(fonts/inter-latin-wght-normal.woff2) format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; }
@font-face { font-family: Inter; src: url(fonts/inter-latin-wght-italic.woff2) format('woff2'); font-weight: 100 900; font-style: italic; font-display: swap; }
/* The app's tokens (src/styles/app.css, docs/brand/IDENTITY.md): charcoal is the ground, warm white is you, orange the AI. */
:root { --bg: #121212; --surface: #1a1a1a; --surface-2: #222222; --line: rgba(253,249,234,.08); --line-strong: rgba(253,249,234,.14);
  --text: #fdf9ea; --text-2: #b9b5a8; --text-3: #8f8c82; --you: #fdf9ea; --on-you: #121212; --ai: #fe5105;
  --code: ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, monospace; color-scheme: dark; }
* { box-sizing: border-box; }
html { scroll-padding-top: 76px; }
body { margin: 0; background: var(--bg); color: var(--text-2); font: 16px/1.65 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; }
a { color: var(--you); text-decoration: underline; text-decoration-color: rgba(253,249,234,.45); text-underline-offset: 3px; }
a:hover { text-decoration-color: var(--you); }
:focus-visible { outline: 2px solid var(--you); outline-offset: 2px; }
.skip { position: absolute; left: -999px; } .skip:focus { left: 16px; top: 12px; z-index: 10; background: var(--surface-2); padding: 8px 12px; border-radius: 8px; }
header.top { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 24px; padding: 0 24px; height: 60px;
  background: rgba(18,18,18,.86); backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; color: var(--text); font-weight: 800; font-style: italic; letter-spacing: -.03em; text-decoration: none; font-size: 18px; }
nav.pages { display: flex; gap: 4px; overflow-x: auto; flex: 1; }
nav.pages a { color: var(--text-2); text-decoration: none; padding: 6px 10px; border-radius: 8px; white-space: nowrap; font-size: 14.5px; }
nav.pages a:hover { color: var(--text); background: var(--surface-2); }
nav.pages a[aria-current] { color: var(--text); background: var(--surface-2); }
.actions { display: flex; gap: 8px; }
.button { display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border-radius: 9px; font-size: 14px; font-weight: 600;
  text-decoration: none; color: var(--text); border: 1px solid var(--line-strong); white-space: nowrap; }
.button.primary { background: var(--you); border-color: var(--you); color: var(--on-you); }
.layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 48px; max-width: 1180px; margin: 0 auto; padding: 32px 24px 96px; }
aside.toc { position: sticky; top: 92px; align-self: start; max-height: calc(100vh - 120px); overflow: auto; font-size: 14px; }
aside.toc p { margin: 0 0 8px; color: var(--text-3); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
aside.toc ol { list-style: none; margin: 0; padding: 0; }
aside.toc li a { display: block; padding: 4px 0 4px 12px; color: var(--text-2); text-decoration: none; border-left: 1px solid var(--line); }
aside.toc li a:hover { color: var(--text); border-left-color: var(--you); }
main { min-width: 0; max-width: 820px; }
h1, h2, h3, h4 { color: var(--text); line-height: 1.25; position: relative; }
h1 { font-size: 40px; margin: 8px 0 16px; letter-spacing: -.02em; }
h2 { font-size: 26px; margin: 48px 0 12px; padding-top: 8px; border-top: 1px solid var(--line); }
h3 { font-size: 19px; margin: 32px 0 8px; }
.anchor { position: absolute; left: -22px; color: var(--text-3); text-decoration: none; opacity: 0; }
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, .anchor:focus { opacity: 1; }
p, li { color: var(--text-2); } strong { color: var(--text); }
img { max-width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--line); }
code { font-family: var(--code); font-size: .88em; background: var(--surface-2); padding: 2px 6px; border-radius: 6px; color: var(--text); }
pre { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 13.5px; line-height: 1.6; }
kbd { font: 600 12.5px Inter, system-ui, sans-serif; color: var(--text); background: var(--surface-2); border: 1px solid var(--line-strong);
  border-bottom-width: 2px; border-radius: 6px; padding: 1px 6px; white-space: nowrap; }
blockquote { margin: 20px 0; padding: 4px 20px; border-left: 3px solid var(--you); background: var(--surface); border-radius: 0 10px 10px 0; }
.table { overflow-x: auto; margin: 16px 0; border: 1px solid var(--line); border-radius: 12px; }
table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
th, td { text-align: left; padding: 9px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--text); background: var(--surface); font-weight: 600; } tr:last-child td { border-bottom: 0; }
hr { border: 0; border-top: 1px solid var(--line); margin: 40px 0; }
footer { border-top: 1px solid var(--line); padding: 24px; text-align: center; color: var(--text-3); font-size: 13.5px; }
@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 24px 16px 64px; }
  aside.toc { display: none; }
  header.top { flex-wrap: wrap; height: auto; padding: 10px 16px 6px; gap: 8px 12px; } .actions { margin-left: auto; }
  .actions .button:not(.primary) { display: none; }
  nav.pages { order: 3; flex-basis: 100%; margin: 0 -10px; } html { scroll-padding-top: 110px; }
  h1 { font-size: 32px; } .anchor { display: none; }
}`;

const LOGO = `<svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="5" width="15" height="15" rx="3" fill="none" stroke="#FDF9EA" stroke-width="2.6"/><circle cx="21.5" cy="21.5" r="6" fill="#FE5105"/></svg>`;

function page(
  current: (typeof PAGES)[number],
  body: string,
  title: string,
  toc: { id: string; text: string }[],
  hasApp: boolean,
): string {
  const nav = PAGES.map((p) => `<a href="${p.out}"${p === current ? ' aria-current="page"' : ''}>${p.nav}</a>`).join('');
  const tocHtml = toc.length
    ? `<aside class="toc" aria-label="On this page"><p>On this page</p><ol>${toc.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ol></aside>`
    : '<div></div>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<meta name="description" content="StyleCode: a local-first visual UI editor where the canvas is the prompt. Draw interfaces, work with an AI on the same design, and export real HTML, CSS and React.">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#content">Skip to the content</a>
<header class="top">
  <a class="brand" href="index.html">${LOGO}StyleCode</a>
  <nav class="pages" aria-label="Documentation">${nav}</nav>
  <div class="actions">
    ${hasApp ? '<a class="button primary" href="app/">Try it in your browser</a>' : ''}
    <a class="button" href="${REPO}">GitHub</a>
  </div>
</header>
<div class="layout">
  ${tocHtml}
  <main id="content">
${body}
  </main>
</div>
<footer>StyleCode is open source. Projects stay on your device; AI is optional and can run on your own computer.</footer>
</body>
</html>
`;
}

mkdirSync(OUT, { recursive: true });
const hasApp = process.env.STYLECODE_SITE_APP === '1' || existsSync(join(OUT, 'app', 'index.html'));
for (const p of PAGES) {
  const source = readFileSync(join(ROOT, p.src), 'utf8');
  const { html, headings } = renderMarkdown(source, (href) => linkFor(p.src, href));
  const h1 = headings.find((h) => h.level === 1)?.text ?? p.nav;
  const title = p.out === 'index.html' ? 'StyleCode: the canvas is the prompt' : `${h1} · StyleCode`;
  writeFileSync(
    join(OUT, p.out),
    page(
      p,
      html,
      title,
      headings.filter((h) => h.level === 2),
      hasApp,
    ),
  );
}
copyFileSync(join(ROOT, 'docs', 'editor.png'), join(OUT, 'editor.png'));
copyFileSync(join(ROOT, 'public', 'favicon.svg'), join(OUT, 'favicon.svg'));
// Inter, upright and its true italic for the wordmark, from the installed package (never committed).
mkdirSync(join(OUT, 'fonts'), { recursive: true });
for (const file of ['inter-latin-wght-normal.woff2', 'inter-latin-wght-italic.woff2'])
  copyFileSync(join(ROOT, 'node_modules', '@fontsource-variable', 'inter', 'files', file), join(OUT, 'fonts', file));
mkdirSync(join(OUT, 'media'), { recursive: true });
for (const file of readdirSync(join(ROOT, 'docs', 'media')))
  copyFileSync(join(ROOT, 'docs', 'media', file), join(OUT, 'media', file));
// GitHub Pages would otherwise run the site through Jekyll.
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`Documentation site written to ${OUT}`);
