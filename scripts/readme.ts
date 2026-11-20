/**
 * The README's truth check (docs/presentation/PRESENTATION-BRIEF.md, P7), as pure functions so the tests can show each
 * rule failing on a mutation. `scripts/check-readme.ts` runs them over the repository.
 *
 * 1. Links: every relative link and image in every tracked Markdown file resolves (reference-style definitions too),
 *    and every `#anchor` names a heading in its target, with the anchor GitHub and the docs site both give it.
 * 2. Figures: every figure the README quotes from research (a percentage, or a number of minutes) sits in a paragraph
 *    or list item that links to a section of a research document, and appears in one of the sections it links to, as
 *    a whole number.
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

/**
 * Lines outside fenced code blocks, with their line numbers. For prose, inline code spans are blanked so their text
 * isn't read as links or figures; headings are read raw, because code in a heading is part of its anchor.
 */
function prose(source: string, blankCode = true): { text: string; line: number }[] {
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
      if (fenced) return;
      out.push({ text: blankCode ? text.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)) : text, line: i + 1 });
    });
  return out;
}

/** GitHub's anchor for a heading: lower case, punctuation dropped (code's backticks too), each space a hyphen. */
export function githubSlug(heading: string): string {
  // Tags go until none is left, so removing one can't join the text around it into another ("<<b>b>").
  let text = heading;
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(/<[^<>]*>/g, '');
  }
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/ /g, '-');
}

interface Heading {
  level: number;
  /** The anchor GitHub gives it, and the one the docs site gives it (scripts/markdown.ts), each numbered when repeated. */
  github: string;
  site: string;
  /** Its index in the document's lines outside code blocks. */
  index: number;
}

function headings(source: string): Heading[] {
  const out: Heading[] = [];
  const usedGithub = new Map<string, number>();
  const usedSite = new Map<string, number>();
  const unique = (used: Map<string, number>, base: string) => {
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
  prose(source, false).forEach(({ text }, index) => {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
    if (!m) return;
    out.push({
      level: m[1].length,
      github: unique(usedGithub, githubSlug(m[2])),
      site: unique(usedSite, slugify(m[2]) || 'section'),
      index,
    });
  });
  return out;
}

/** The anchors a link may use: those that work both on GitHub and on the docs site. */
export function anchors(source: string): Set<string> {
  return new Set(headings(source).flatMap((h) => (h.github === h.site ? [h.github] : [])));
}

/** The anchors GitHub gives a document's headings, to say why a link that works on GitHub alone fails. */
export function githubAnchors(source: string): Set<string> {
  return new Set(headings(source).map((h) => h.github));
}

/** The text of the section a heading anchor starts: up to the next heading of the same level or higher. */
export function section(source: string, anchor: string): string | null {
  const all = headings(source);
  const at = all.findIndex((h) => h.github === anchor || h.site === anchor);
  if (at < 0) return null;
  const lines = prose(source).map((l) => l.text);
  const end = all.slice(at + 1).find((h) => h.level <= all[at].level);
  return lines.slice(all[at].index + 1, end ? end.index : undefined).join('\n');
}

/** Every link and image target in a document's prose, and every reference-style definition's, with its line. */
export function links(source: string): { target: string; line: number }[] {
  const out: { target: string; line: number }[] = [];
  for (const { text, line } of prose(source)) {
    for (const m of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ target: m[1], line });
    const definition = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/.exec(text);
    if (definition) out.push({ target: definition[1], line });
  }
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
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      problems.push({ file, line, message: `${target}: the path isn't valid URL encoding` });
      continue;
    }
    const path = rawPath ? join(dir, decoded) : file;
    if (!exists(path)) {
      problems.push({ file, line, message: `${target}: ${path} doesn't exist` });
      continue;
    }
    if (anchor && path.endsWith('.md') && !anchors(read(path)).has(anchor))
      problems.push({
        file,
        line,
        message: githubAnchors(read(path)).has(anchor)
          ? `${target}: the docs site gives that heading another anchor, so the link works on GitHub only`
          : `${target}: ${path} has no heading #${anchor}`,
      });
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

/**
 * Whether a figure appears in a section as a whole number: "4%" isn't in "94%", and "1.7 minutes" isn't in "11.7". A
 * number of minutes may stand alone, as in a table's "Minutes per hour" column.
 */
export function appears(figure: string, text: string): boolean {
  const number = /^\d+(?:\.\d+)?/.exec(figure)![0].replace('.', '\\.');
  const after = figure.endsWith('%') ? '%' : '(?!\\.?\\d)';
  return new RegExp(`(?<![\\d.])${number}${after}`).test(text);
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
      if (!texts.some((t) => appears(figure, t)))
        problems.push({ file, line, message: `${figure} isn't in ${sources.join(' or ')}` });
  }
  return problems;
}
