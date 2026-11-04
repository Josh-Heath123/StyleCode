import { describe, expect, it } from 'vitest';
import { inline, renderMarkdown } from './markdown.ts';

describe('markdown for the docs site', () => {
  it('renders inline code, emphasis, links, images and keys', () => {
    expect(inline('Press <kbd>Shift</kbd>+<kbd>A</kbd> to **tidy** a *sketch*: `a < b`')).toBe(
      'Press <kbd>Shift</kbd>+<kbd>A</kbd> to <strong>tidy</strong> a <em>sketch</em>: <code>a &lt; b</code>',
    );
    expect(inline('[the guide](docs/GUIDE.md) and ![a picture](docs/editor.png)', (h) => h.replace('docs/', ''))).toBe(
      '<a href="GUIDE.md">the guide</a> and <img src="editor.png" alt="a picture" loading="lazy">',
    );
    expect(inline('snake_case_names stay as they are')).toBe('snake_case_names stay as they are');
  });

  it('escapes HTML it does not know, and drops links that would run code', () => {
    expect(inline('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(inline('[x](javascript:alert(1))')).toContain('href="#"');
    expect(inline('[x](JavaScript:void)')).toBe('<a href="#">x</a>');
    expect(inline('[x](\u0001javascript:void)')).toBe('<a href="#">x</a>');
    expect(inline('![x](data:text/html,hi)')).toContain('src="#"');
    expect(inline('[mail](mailto:a@b.c) [web](https://example.com) [here](#top)')).toBe(
      '<a href="mailto:a@b.c">mail</a> <a href="https://example.com" rel="noopener">web</a> <a href="#top">here</a>',
    );
  });

  it('renders headings with unique anchors and collects them', () => {
    const { html, headings } = renderMarkdown('# Title\n\n## Tests\n\n## Tests');
    expect(headings.map((h) => h.id)).toEqual(['title', 'tests', 'tests-1']);
    expect(html).toContain('<h2 id="tests-1">');
  });

  it('renders tables, code blocks, quotes and nested lists', () => {
    const { html } = renderMarkdown(
      [
        '| Action | How |',
        '| --- | --- |',
        '| Undo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> |',
        '',
        '```bash',
        'npm run dev',
        '```',
        '',
        '> A quote',
        '',
        '- one',
        '  - nested',
        '- two',
        '',
        '1. first',
        '2. second',
      ].join('\n'),
    );
    expect(html).toContain('<th>Action</th>');
    expect(html).toContain('<td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td>');
    expect(html).toContain('<pre><code class="language-bash">npm run dev</code></pre>');
    expect(html).toContain('<blockquote>\n<p>A quote</p>');
    expect(html).toMatch(/<li>one\n<ul>\n<li>nested<\/li>\n<\/ul>\n<\/li>/);
    expect(html).toContain('<ol>\n<li>first</li>\n<li>second</li>\n</ol>');
  });
});
