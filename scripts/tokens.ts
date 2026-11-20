/**
 * The token rules (docs/brand/IDENTITY.md, I6, I8 and I10): app chrome sets colours through app.css's tokens, by
 * role, and orange is only the AI's. Pure functions over a file's path and text, so the tests can give them bad
 * examples. `scripts/check-tokens.ts` runs them over the repository.
 */

/** Where app chrome lives (I6). Design content in these folders is declared below. */
export const CHROME_DIRS = ['src/app', 'src/panels', 'src/canvas', 'src/ui', 'src/workspace/ui', 'src/styles'];

/**
 * Files that are the user's design content, not chrome (I6): the blocks, and the colours new layers start with.
 * Their colours are the user's work and keep their own values.
 */
export const DESIGN_CONTENT_FILES = ['src/app/blocks.ts'];

/**
 * A line whose colour isn't chrome's says why, in a comment, with one of these reasons: `token-check: design content`
 * (a colour of the user's design), `token-check: not shown` (a value never drawn), `token-check: cursor` (a cursor's
 * data URL, which no token reaches).
 */
const MARKED = /(?:\/\/|\/\*)\s*token-check:\s*(?:design content|not shown|cursor)\b/;

/** The file that defines the tokens. Literals are allowed in its `:root` blocks only. */
export const TOKEN_FILE = 'src/styles/app.css';

/**
 * What shows the AI's work (I1, I8): only CSS rules whose every selector contains one of these may use `--ai`,
 * `--ai-soft` and the other `--ai-…` tokens. Each is matched as whole class names: `.ws-run-coverage` doesn't match
 * `.ws-run-coverage-actions`.
 */
export const AI_SELECTORS = [
  '.ov-proposal-changed', // the proposal on the canvas: changed and new layers
  '.ov-proposal-removed', // and layers it would delete
  '.dock .dock-ai', // the assistant's button in the tool dock
  '.assistant-mark', // the assistant's sparkle
  ".assistant[data-status='review']", // the assistant while its proposal is under review
  '.assistant-explanation.is-streaming', // the AI writing its explanation
  '.assistant-swatch', // the key to the proposal's colour
  '.assistant-pulse', // the AI working
  '.assistant-drew-on', // the findings the AI's proposal drew on (Workspace Phase 4, decision 16)
  '.assistant-drew-on-label',
  ".ai-button[data-on='true']", // the AI settings button, when the AI is on
  '.ask-ai', // the sparkle on "Ask the AI for findings" (I13)
  '.ws-proposal', // the AI's proposed findings under review
  '.ws-run-coverage', // an AI run's coverage
  '.ws-badge.is-ai', // "Proposed by the AI"
  '.ws-segment.is-quoted', // the passage a proposal quotes, in the transcript
  '.ws-segment mark',
  '.ws-note.is-quoted', // and in the notes
  '.ws-note mark',
  '.app-nav-run', // an AI run, in the top bar
  '.welcome-points li:nth-child(3)', // the welcome screen's "Ask the AI"
  '.mark-dot', // the mark's dot: the AI's part of it
];

/** Whether a selector shows the AI's work: it contains one of AI_SELECTORS, ending at a class name's end. */
export function isAiSelector(selector: string): boolean {
  return AI_SELECTORS.some((a) => {
    for (let at = selector.indexOf(a); at >= 0; at = selector.indexOf(a, at + 1))
      if (!/[\w-]/.test(selector[at + a.length] ?? '')) return true;
    return false;
  });
}

/** Common CSS colour names: a colour written as a word is a literal too. */
const NAMED_COLOURS =
  'white|black|red|green|blue|orange|yellow|purple|pink|gray|grey|tomato|gold|navy|teal|silver|maroon|olive|lime|aqua|fuchsia|cyan|magenta|coral|salmon|crimson|indigo|violet|brown|beige|ivory|khaki|lavender|orangered|darkorange|whitesmoke|snow';
/** Properties that take one colour, where any word but a keyword is a named colour. */
const COLOUR_PROPERTY =
  /^\s*(?:color|fill|stroke|background-color|border(?:-(?:top|right|bottom|left))?-color|outline-color|caret-color|text-decoration-color|accent-color|column-rule-color|stop-color|flood-color)\s*:\s*([^;]*)/;
const COLOUR_KEYWORDS = /^(?:currentcolor|transparent|inherit|initial|unset|revert|none)$/i;

/** Script files that may name an `--ai` token (none today: the AI's colour is set in app.css). */
export const AI_FILES: string[] = [];

const COLOUR_LITERAL =
  /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<=[:\s,(])(?:white|black)(?=\s*[;,)]|\s*$)/g;

export interface Problem {
  file: string;
  line: number;
  message: string;
}

/** Whether a path is app chrome, checked by these rules. */
export function isChrome(path: string): boolean {
  return (
    CHROME_DIRS.some((d) => path.startsWith(`${d}/`)) &&
    /\.(css|tsx?)$/.test(path) &&
    !/\.test\.tsx?$/.test(path) &&
    !DESIGN_CONTENT_FILES.includes(path)
  );
}

/** Blanks comments, keeping line breaks and the design-content marker, so line numbers stay true. */
function withoutComments(text: string, css: boolean): string {
  const blank = (m: string) => (MARKED.test(m) ? m : m.replace(/[^\n]/g, ' '));
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (!css) out = out.replace(/(^|[^:'"`])\/\/.*$/gm, (m, before: string) => before + blank(m.slice(before.length)));
  return out;
}

/** Colour literals in chrome, outside the token definitions and lines marked as design content (I6). */
export function literalProblems(path: string, text: string): Problem[] {
  if (!isChrome(path)) return [];
  const css = path.endsWith('.css');
  const problems: Problem[] = [];
  const add = (i: number, what: string) =>
    problems.push({ file: path, line: i + 1, message: `a colour literal (${what}): use a token from ${TOKEN_FILE}` });
  // The token definitions: the lines inside :root blocks of the token file.
  const rootDepth: number[] = [];
  let depth = 0;
  let root = -1;
  for (const line of withoutComments(text, css).split('\n')) {
    if (root < 0 && /:root\s*\{/.test(line)) root = depth;
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    rootDepth.push(root);
    if (root >= 0 && depth <= root) root = -1;
  }
  withoutComments(text, css)
    .split('\n')
    .forEach((line, i) => {
      if (MARKED.test(line)) return;
      if (path === TOKEN_FILE && rootDepth[i] >= 0 && /^\s*--[\w-]+\s*:/.test(line)) return;
      for (const m of line.matchAll(COLOUR_LITERAL)) add(i, m[0].replace(/\($/, '(…)'));
      if (css) {
        const value = COLOUR_PROPERTY.exec(line)?.[1] ?? '';
        for (const word of value.replace(/var\([^)]*\)/g, ' ').match(/[a-z][\w-]*/gi) ?? [])
          if (!COLOUR_KEYWORDS.test(word) && !/^(?:white|black)$/i.test(word)) add(i, word);
      } else {
        // Lowercase, as code writes colours: a label such as 'Black' (a font weight) isn't one.
        for (const m of line.matchAll(new RegExp(`(['"\`])(?:${NAMED_COLOURS})\\1`, 'g'))) add(i, m[0]);
      }
    });
  return problems;
}

interface Rule {
  selectors: string[];
  declarations: Map<string, string>;
  line: number;
}

/** A stylesheet's rules, flattened out of @media and other blocks, with each one's declarations and first line. */
export function cssRules(text: string): Rule[] {
  const source = withoutComments(text, true);
  const rules: Rule[] = [];
  const stack: { selector: string; line: number; body: string }[] = [];
  let buffer = '';
  let line = 1;
  let bufferLine = 1;
  for (const ch of source) {
    if (ch === '{') {
      stack.push({ selector: buffer.trim(), line: bufferLine, body: '' });
      buffer = '';
    } else if (ch === '}') {
      const block = stack.pop();
      if (block && !block.selector.startsWith('@')) {
        const declarations = new Map<string, string>();
        for (const part of (block.body + buffer).split(';')) {
          const colon = part.indexOf(':');
          if (colon > 0) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
        }
        rules.push({ selectors: block.selector.split(',').map((s) => s.trim()), declarations, line: block.line });
      }
      buffer = '';
    } else {
      if (!buffer.trim() && ch.trim()) bufferLine = line;
      buffer += ch;
      // Declarations end with ';': keep them in the open block's body.
      if (ch === ';' && stack.length) {
        stack[stack.length - 1].body += buffer;
        buffer = '';
      }
    }
    if (ch === '\n') line++;
  }
  return rules;
}

const usesAi = (value: string) => /var\(--ai(?:-[\w-]+)?\)/.test(value);

/** `--ai` tokens outside what shows the AI's work (I8). */
export function aiProblems(path: string, text: string): Problem[] {
  if (!isChrome(path)) return [];
  if (!path.endsWith('.css')) {
    if (AI_FILES.includes(path)) return [];
    return withoutComments(text, false)
      .split('\n')
      .flatMap((line, i) =>
        /var\(--ai(?:-[\w-]+)?\)/.test(line)
          ? [{ file: path, line: i + 1, message: 'the AI’s colour outside the files that show the AI’s work' }]
          : [],
      );
  }
  const problems: Problem[] = [];
  for (const rule of cssRules(text)) {
    // The tokens are defined in :root; anywhere else, a custom property that carries the AI's colour counts too.
    if (rule.selectors.every((s) => s === ':root')) continue;
    const ai = [...rule.declarations].filter(([, value]) => usesAi(value));
    if (!ai.length) continue;
    if (rule.selectors.every(isAiSelector)) continue;
    problems.push({
      file: path,
      line: rule.line,
      message: `the AI’s colour (${ai.map(([p]) => p).join(', ')}) on ${rule.selectors.join(', ')}, which isn’t the AI’s work`,
    });
  }
  return problems;
}

/** I10's contrast rules, where one CSS rule sets both the text and its ground. */
export function contrastProblems(path: string, text: string): Problem[] {
  if (!path.endsWith('.css') || !isChrome(path)) return [];
  const problems: Problem[] = [];
  for (const rule of cssRules(text)) {
    const color = rule.declarations.get('color') ?? '';
    const ground = `${rule.declarations.get('background') ?? ''} ${rule.declarations.get('background-color') ?? ''}`;
    const where = rule.selectors.join(', ');
    if (/var\(--ai\)/.test(color) && /var\(--ai-(?:soft|selected)\)/.test(ground))
      problems.push({ file: path, line: rule.line, message: `orange text on the orange soft fill (${where})` });
    if (/var\(--text-subtle\)/.test(color) && /var\(--surface-[45]\)/.test(ground))
      problems.push({ file: path, line: rule.line, message: `the subtle grey on a surface above --surface-3 (${where})` });
    // A rule that sets text on a danger fill; a dot or a bar with no text sets no colour.
    if (/var\(--danger(?:-hi)?\)/.test(ground) && color && !/var\(--on-danger\)/.test(color))
      problems.push({ file: path, line: rule.line, message: `a danger fill without charcoal text, --on-danger (${where})` });
  }
  return problems;
}

/** Every token problem in one file. */
export function tokenProblems(path: string, text: string): Problem[] {
  return [...literalProblems(path, text), ...aiProblems(path, text), ...contrastProblems(path, text)];
}
