import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  aiProblems,
  contrastProblems,
  cssRules,
  isAiSelector,
  isChrome,
  literalProblems,
  tokenProblems,
  TOKEN_FILE,
} from './tokens.ts';

/**
 * The token rules (docs/brand/IDENTITY.md). Each rule is shown failing on a mutation of the real stylesheet or a
 * real chrome file, so a rule that stops working can't pass unnoticed.
 */
const appCss = readFileSync(TOKEN_FILE, 'utf8');
/** Replaces exactly one occurrence, so a mutation can't silently miss. */
const mutate = (text: string, from: string, to: string) => {
  expect(text.split(from).length - 1, `"${from}" occurs once`).toBe(1);
  return text.replace(from, to);
};

describe('the real chrome', () => {
  it('passes every rule today', () => {
    expect(tokenProblems(TOKEN_FILE, appCss)).toEqual([]);
  });
});

describe('colour literals (I6)', () => {
  it('fails a literal in a chrome rule of app.css', () => {
    const mutated = mutate(
      appCss,
      '  color: var(--on-you);\n  box-shadow: 0 0 0 1px var(--halo);',
      '  color: #121212;\n  box-shadow: 0 0 0 1px var(--halo);',
    );
    expect(literalProblems(TOKEN_FILE, mutated)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('#121212') }),
    ]);
  });

  it('fails a literal in a component', () => {
    const path = 'src/ui/Mark.tsx';
    const mutated = mutate(
      readFileSync(path, 'utf8'),
      '<circle className="mark-dot"',
      '<circle className="mark-dot" fill="#FE5105"',
    );
    expect(literalProblems(path, mutated)).toHaveLength(1);
  });

  it('finds every way of writing a colour, and none in comments', () => {
    const path = 'src/panels/Example.tsx';
    for (const literal of [
      '#fff',
      '#ffffff',
      '#ffffff80',
      'rgb(1, 2, 3)',
      'rgba(1, 2, 3, 0.5)',
      'hsl(10 50% 50%)',
      'oklch(0.7 0.1 20)',
    ])
      expect(literalProblems(path, `const c = '${literal}';`), literal).toHaveLength(1);
    expect(literalProblems('src/styles/app.css', '.a {\n  color: white;\n}')).toHaveLength(1);
    expect(literalProblems(path, '// The old #2f7bff blue\n/* or rgba(0, 0, 0, 0.5) */')).toEqual([]);
  });

  it('allows the token definitions, a marked line with its reason, and design content', () => {
    expect(literalProblems(TOKEN_FILE, ':root {\n  --you: #fdf9ea;\n}')).toEqual([]);
    expect(literalProblems('src/panels/Example.tsx', "const fill = '#11141a'; // token-check: design content")).toEqual([]);
    // A marker without a reason doesn't count.
    expect(literalProblems('src/panels/Example.tsx', "const fill = '#11141a'; // token-check:")).toHaveLength(1);
    expect(isChrome('src/app/blocks.ts')).toBe(false);
    expect(isChrome('src/model/defaults.ts')).toBe(false);
    expect(isChrome('src/panels/CodePanel.test.ts')).toBe(false);
  });
});

describe('the AI’s colour only on the AI’s work (I8)', () => {
  it('fails orange on a snap guide, a canvas affordance', () => {
    const mutated = mutate(appCss, '.ov-guide {\n  stroke: var(--you);', '.ov-guide {\n  stroke: var(--ai);');
    expect(aiProblems(TOKEN_FILE, mutated)).toEqual([expect.objectContaining({ message: expect.stringContaining('.ov-guide') })]);
  });

  it('fails the soft fill and the selected fill too, and in a component', () => {
    expect(aiProblems(TOKEN_FILE, '.layer-row {\n  background: var(--ai-soft);\n}')).toHaveLength(1);
    expect(aiProblems(TOKEN_FILE, '.layer-row {\n  background: var(--ai-selected);\n}')).toHaveLength(1);
    expect(aiProblems('src/panels/Example.tsx', "<div style={{ color: 'var(--ai)' }} />")).toHaveLength(1);
  });

  it('fails a rule that lists the AI’s work beside something that isn’t', () => {
    expect(aiProblems(TOKEN_FILE, '.ws-proposal,\n.layer-row {\n  color: var(--ai);\n}')).toHaveLength(1);
  });

  it('allows the AI’s work, inside @media too, and defining the tokens', () => {
    expect(aiProblems(TOKEN_FILE, '.ws-proposal {\n  border-left: 3px solid var(--ai);\n}')).toEqual([]);
    expect(aiProblems(TOKEN_FILE, '@media (max-width: 900px) {\n  .assistant-mark {\n    color: var(--ai);\n  }\n}')).toEqual([]);
    expect(aiProblems(TOKEN_FILE, ':root {\n  --ai: #fe5105;\n  --ai-soft: rgba(254, 81, 5, 0.14);\n}')).toEqual([]);
  });
});

describe('contrast rules (I10)', () => {
  it('fails orange text on the orange soft fill', () => {
    const mutated = mutate(
      appCss,
      ".dock .dock-ai[aria-expanded='true'] {\n  background: transparent;",
      ".dock .dock-ai[aria-expanded='true'] {\n  background: var(--ai-soft);",
    );
    expect(contrastProblems(TOKEN_FILE, mutated)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('orange text on the orange soft fill') }),
    ]);
  });

  it('fails the subtle grey on a surface above --surface-3', () => {
    const mutated = mutate(
      appCss,
      '  color: var(--text-muted);\n  background: var(--surface-4);\n}\n\n.layer-row.is-selected .layer-role',
      '  color: var(--text-subtle);\n  background: var(--surface-4);\n}\n\n.layer-row.is-selected .layer-role',
    );
    expect(contrastProblems(TOKEN_FILE, mutated)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('subtle grey') }),
    ]);
    expect(contrastProblems(TOKEN_FILE, '.tip {\n  color: var(--text-subtle);\n  background: var(--surface-5);\n}')).toHaveLength(
      1,
    );
    expect(contrastProblems(TOKEN_FILE, '.row {\n  color: var(--text-subtle);\n  background: var(--surface-3);\n}')).toEqual([]);
  });

  it('fails a filled danger button whose text isn’t charcoal', () => {
    const mutated = mutate(
      appCss,
      '.button.stop-button {\n  background: var(--danger);\n  border-color: var(--danger);\n  color: var(--on-danger);',
      '.button.stop-button {\n  background: var(--danger);\n  border-color: var(--danger);\n  color: var(--text);',
    );
    expect(contrastProblems(TOKEN_FILE, mutated)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('danger fill') }),
    ]);
    // A dot or a bar on the danger colour holds no text.
    expect(contrastProblems(TOKEN_FILE, '.dot::before {\n  background: var(--danger);\n}')).toEqual([]);
  });
});

describe('the holes the review found, closed', () => {
  it('fails a literal in a custom property outside :root, and the AI’s colour passed through one', () => {
    expect(literalProblems(TOKEN_FILE, '.foo {\n  --c: #fe5105;\n  color: var(--c);\n}')).toHaveLength(1);
    expect(aiProblems(TOKEN_FILE, '.foo {\n  --accent: var(--ai);\n  color: var(--accent);\n}')).toHaveLength(1);
    // Inside a :root block, also one inside @media, a literal defines a token.
    expect(literalProblems(TOKEN_FILE, '@media (x) {\n  :root {\n    --left-w: 208px;\n    --c: #121212;\n  }\n}')).toEqual([]);
  });

  it('fails a colour written as a word', () => {
    expect(literalProblems(TOKEN_FILE, '.a {\n  color: orange;\n}')).toHaveLength(1);
    expect(literalProblems(TOKEN_FILE, '.a {\n  border-color: tomato;\n}')).toHaveLength(1);
    expect(literalProblems(TOKEN_FILE, '.a {\n  fill: currentColor;\n  stroke: none;\n  color: var(--text);\n}')).toEqual([]);
    expect(literalProblems('src/panels/Example.tsx', "const c = 'white';")).toHaveLength(1);
    expect(literalProblems('src/panels/Example.tsx', "const weight = { label: 'Black' };")).toEqual([]);
  });

  it('accepts a marker only in a comment, with one of its reasons', () => {
    const path = 'src/panels/Example.tsx';
    expect(literalProblems(path, "const c = '#123456'; // token-check: because")).toHaveLength(1);
    expect(literalProblems(path, "const c = '#123456 token-check: design content';")).toHaveLength(1);
    expect(literalProblems(path, "const c = '#123456'; // token-check: not shown")).toEqual([]);
  });

  it('matches the AI’s selectors as whole class names', () => {
    expect(isAiSelector('.ws-note.is-quoted')).toBe(true);
    expect(isAiSelector('.ws-note mark')).toBe(true);
    for (const selector of [
      '.ws-note-text',
      '.ws-notes',
      '.ws-segment',
      '.assistant .button.primary',
      '.assistant-chip:hover',
      '.ws-run-actions',
    ])
      expect(isAiSelector(selector), selector).toBe(false);
    const mutated = mutate(
      appCss,
      '.assistant-chip:hover {\n  border-color: var(--line-strong);',
      '.assistant-chip:hover {\n  border-color: var(--ai-line);',
    );
    expect(aiProblems(TOKEN_FILE, mutated)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('.assistant-chip:hover') }),
    ]);
  });
});

describe('reading the stylesheet', () => {
  it('flattens @media blocks and keeps each rule’s first line', () => {
    const rules = cssRules('.a {\n  color: red;\n}\n\n@media (x) {\n  .b,\n  .c {\n    color: blue;\n  }\n}\n');
    expect(rules.map((r) => [r.selectors, r.line, r.declarations.get('color')])).toEqual([
      [['.a'], 1, 'red'],
      [['.b', '.c'], 6, 'blue'],
    ]);
  });
});
