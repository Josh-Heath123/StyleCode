/**
 * The README's truth check (docs/presentation/PRESENTATION-BRIEF.md, P7), as pure functions so the tests can show each
 * rule failing on a mutation. `scripts/check-readme.ts` runs them over the repository.
 *
 * 1. Links: every relative link and image in every tracked Markdown file resolves, and every `#anchor` names a heading
 *    in its target (as GitHub and the docs site make them).
 * 2. Figures: every figure the README quotes from research (a percentage, or a number of minutes) sits in a paragraph
 *    or list item that links to a section of a research document, and appears in one of the sections it links to.
 * 3. Counts: the README names no count that drifts with every merge (tests, files, lines, commits).
 */
import { slugify } from './markdown.ts';

export interface Problem {
  file: string;
  line: number;
  message: string;
}

/** Research documents, whose sections the README's figures come from. */
export const RESEARCH = /^docs\/research\/[^/]+\.md$/;

/** Lines outside fenced code blocks, with their line numbers; inline code spans blanked so their text isn't read. */
function prose(source: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let fenced = false;
  source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((text, i) => {
      if (/^\s*(```|~~~)/.test(text)) {
        fenced = !fenced;
        return;
      }
      if (!fenced) out.push({ text: text.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)), line: i + 1 });
    });
  return out;
}

/** The anchors a document's headings get: the docs site's (scripts/markdown.ts) and GitHub's, numbered when repeated. */
export function anchors(source: string): Set<string> {
  const found = new Set<string>();
  const used = new Map<string, number>();
  for (const { text } of prose(source)) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(text)?.[1];
    if (!heading) continue;
    const github = heading
      .replace(/<[^>]+>/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/ /g, '-');
    for (const base of new Set([slugify(heading) || 'section', github])) {
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      found.add(n ? `${base}-${n}` : base);
    }
  }
  return found;
}

/** The text of the section a heading anchor starts: up to the next heading of the same level or higher. */
export function section(source: string, anchor: string): string | null {
  const lines = prose(source).map((l) => l.text);
  const used = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    const base = slugify(m[2]) || 'section';
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    if ((n ? `${base}-${n}` : base) !== anchor) continue;
    const level = m[1].length;
    const end = lines.findIndex((l, j) => j > i && /^(#{1,6})\s/.test(l) && /^#+/.exec(l)![0].length <= level);
    return lines.slice(i + 1, end < 0 ? undefined : end).join('\n');
  }
  return null;
}

/** Every link and image target in a document's prose, with its line. */
export function links(source: string): { target: string; line: number }[] {
  const out: { target: string; line: number }[] = [];
  for (const { text, line } of prose(source))
    for (const m of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ target: m[1], line });
  return out;
}

const join = (dir: string, rel: string) => {
  const parts = dir ? dir.split('/') : [];
  for (const p of rel.split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
};

/**
 * Rule 1. `exists` says whether a repository path is a file or folder; `read` gives a Markdown file's text. Paths are
 * the repository's, with forward slashes.
 */
export function linkProblems(
  file: string,
  source: string,
  exists: (path: string) => boolean,
  read: (path: string) => string,
): Problem[] {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  const problems: Problem[] = [];
  for (const { target, line } of links(source)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // https:, mailto: and the like
    const [rawPath, anchor] = target.split('#') as [string, string | undefined];
    const path = rawPath ? join(dir, decodeURIComponent(rawPath)) : file;
    if (!exists(path)) {
      problems.push({ file, line, message: `${target}: ${path} doesn't exist` });
      continue;
    }
    if (anchor && path.endsWith('.md') && !anchors(read(path)).has(anchor))
      problems.push({ file, line, message: `${target}: ${path} has no heading #${anchor}` });
  }
  return problems;
}

/** Figures quoted from research: percentages (a range "63 to 69%" gives both ends) and numbers of minutes. */
export function figures(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?) to (\d+(?:\.\d+)?)%/g)) found.push(`${m[1]}%`, `${m[2]}%`);
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?%/g)) found.push(m[0]);
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?) minutes\b/g)) found.push(`${m[1]} minutes`);
  return [...new Set(found)];
}

/** A README's paragraphs, list items and table rows, each with its first line. */
function blocks(source: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let current: { text: string; line: number } | null = null;
  for (const { text, line } of prose(source)) {
    const starts = /^\s*([-*+]|\d+\.)\s|^\s*\||^#/.test(text);
    if (!text.trim() || starts) {
      if (current) out.push(current);
      current = text.trim() ? { text, line } : null;
    } else if (current) current.text += `\n${text}`;
    else current = { text, line };
  }
  if (current) out.push(current);
  return out;
}

/** Rules 2 and 3, for the README. `read` gives a repository file's text. */
export function readmeProblems(file: string, source: string, read: (path: string) => string): Problem[] {
  const problems: Problem[] = [];
  for (const { text, line } of blocks(source)) {
    const counts = /\b\d[\d,]*\s+(?:unit\s+|browser\s+|end-to-end\s+)?(?:tests?|test files|files|specs|commits|lines)\b/i.exec(
      text,
    );
    if (counts) problems.push({ file, line, message: `"${counts[0]}" is a count that drifts with every merge; leave it out` });

    const quoted = figures(text);
    if (!quoted.length) continue;
    const sources = links(text)
      .map((l) => l.target)
      .filter((t) => t.includes('#') && RESEARCH.test(t.split('#')[0]));
    if (!sources.length) {
      problems.push({
        file,
        line,
        message: `${quoted.join(', ')}: a figure needs a link to the research section it comes from, beside it`,
      });
      continue;
    }
    const texts = sources.map((t) => {
      const [path, anchor] = t.split('#');
      return section(read(path), anchor) ?? '';
    });
    for (const figure of quoted)
      if (!texts.some((t) => t.includes(figure)))
        problems.push({ file, line, message: `${figure} isn't in ${sources.join(' or ')}` });
  }
  return problems;
}
