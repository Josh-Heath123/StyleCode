import { describe, expect, it } from 'vitest';
import { anchors, figures, linkProblems, readmeProblems, section } from './readme.ts';

/** A small repository: the README, the guide and a research document. Each test mutates one thing and sees it fail. */
const RESEARCH = `# Extraction

## Results

| Model | Precision | Recall |
| --- | --: | --: |
| qwen3:4b | 98% | 69% |
| qwen3:4b, again | 98% | 63% |

It takes about 25 minutes per hour of meeting.

## Recommendations

Use qwen3:4b at 70% of the context.
`;
const GUIDE = `# Guide

## Shortcuts

Press ? for all of them.

## Working with the AI

\`\`\`md
## Not a heading, in code
\`\`\`
`;
const README = `# StyleCode

![The hero](docs/media/hero.png)

See the [guide](docs/GUIDE.md), its [shortcuts](docs/GUIDE.md#shortcuts) and [the AI](docs/GUIDE.md#working-with-the-ai).

- **Extraction.** 98% precision and 63 to 69% recall, about 25 minutes per hour. [Results](docs/research/EXTRACTION.md#results).
- **Tests.** Unit tests, browser tests and an accessibility check.

[Ownership](#stylecode)
`;
const FILES: Record<string, string> = {
  'README.md': README,
  'docs/GUIDE.md': GUIDE,
  'docs/research/EXTRACTION.md': RESEARCH,
  'docs/media/hero.png': '',
};
const exists = (p: string) => p in FILES || Object.keys(FILES).some((f) => f.startsWith(`${p}/`));
const read = (p: string) => FILES[p];
const check = (readme: string) => [
  ...linkProblems('README.md', readme, exists, read),
  ...readmeProblems('README.md', readme, read),
];

describe('the README check', () => {
  it('passes the README as it is', () => {
    expect(check(README)).toEqual([]);
  });

  it('rule 1: a link to a file that doesn’t exist fails', () => {
    const problems = check(README.replace('docs/GUIDE.md)', 'docs/GUIDES.md)'));
    expect(problems.map((p) => p.message)).toEqual(["docs/GUIDES.md: docs/GUIDES.md doesn't exist"]);
  });

  it('rule 1: an image that doesn’t exist fails', () => {
    expect(check(README.replace('hero.png', 'hero2.png'))).toHaveLength(1);
  });

  it('rule 1: an anchor with no heading fails, in another file and in the same one', () => {
    expect(check(README.replace('#shortcuts', '#shortcutz'))[0].message).toContain('has no heading #shortcutz');
    expect(check(README.replace('(#stylecode)', '(#ownership)'))[0].message).toContain('README.md has no heading #ownership');
  });

  it('rule 1: a heading inside a code block isn’t an anchor, and links inside code aren’t read', () => {
    expect(anchors(GUIDE).has('not-a-heading-in-code')).toBe(false);
    expect(check(`${README}\n\`[nothing](missing.md)\`\n`)).toEqual([]);
  });

  it('rule 2: a figure changed from its source fails', () => {
    const problems = check(README.replace('63 to 69%', '63 to 70%'));
    expect(problems.map((p) => p.message)).toEqual(["70% isn't in docs/research/EXTRACTION.md#results"]);
  });

  it('rule 2: a figure with no link to its research section beside it fails', () => {
    const problems = check(README.replace(' [Results](docs/research/EXTRACTION.md#results).', ''));
    expect(problems[0].message).toContain('a figure needs a link to the research section it comes from');
  });

  it('rule 2: a figure is looked for in the linked section only, not elsewhere in the document', () => {
    // 70% is in the research document, but under Recommendations, not Results.
    expect(check(README.replace('63 to 69%', '63 to 70%'))).toHaveLength(1);
    expect(section(RESEARCH, 'results')).not.toContain('70%');
  });

  it('rule 3: a count that drifts with every merge fails', () => {
    expect(check(README.replace('Unit tests,', '847 unit tests,'))[0].message).toContain('"847 unit tests"');
    expect(check(README.replace('Unit tests,', 'Unit tests in 212 files,'))).toHaveLength(1);
  });

  it('reads figures: percentages, ranges and minutes', () => {
    expect(figures('98% precision and 63 to 69% recall, in 2.6 minutes, 37 minutes in all')).toEqual([
      '63%',
      '69%',
      '98%',
      '2.6 minutes',
      '37 minutes',
    ]);
  });
});
