/**
 * A small Markdown to HTML converter for the documentation site, covering
 * what StyleCode's own docs use: headings (with anchors), paragraphs, lists
 * (nested), block quotes, fenced code, tables, rules, and inline code,
 * emphasis, links, images and a few inline HTML tags (kbd, br). Anything else
 * that looks like HTML is escaped. Written for our docs, not as a general
 * Markdown implementation, so the site needs no dependencies.
 */

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface Rendered {
  html: string;
  headings: Heading[];
}

const INLINE_TAGS = /^<\/?(kbd|br|sub|sup)\s*\/?>/i;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Only web, mail and relative links: anything else (javascript:, data:…) becomes a dead link. */
export function safeHref(href: string): string {
  // As a browser reads it: control characters and spaces around and inside the scheme are ignored.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.replace(/[\u0000-\u0020]/g, ''))?.[1].toLowerCase();
  return !scheme || scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? href : '#';
}

export function slugify(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Inline Markdown: code spans first (their content is literal), then images, links, emphasis. */
export function inline(text: string, link: (href: string) => string = (h) => h): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    // Code span
    const code = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest);
    if (code) {
      out += `<code>${escapeHtml(code[2].replace(/^ (.*) $/, '$1'))}</code>`;
      i += code[0].length;
      continue;
    }
    // Image ![alt](src)
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (image) {
      out += `<img src="${escapeHtml(safeHref(link(image[2])))}" alt="${escapeHtml(image[1])}" loading="lazy">`;
      i += image[0].length;
      continue;
    }
    // Link [text](href)
    const anchor = /^\[((?:[^\]]|\][^(])*)\]\(([^)\s]+)\)/.exec(rest);
    if (anchor) {
      const href = safeHref(link(anchor[2]));
      const external = /^https?:/.test(href);
      out += `<a href="${escapeHtml(href)}"${external ? ' rel="noopener"' : ''}>${inline(anchor[1], link)}</a>`;
      i += anchor[0].length;
      continue;
    }
    // Autolink <https://…>
    const auto = /^<(https?:\/\/[^>\s]+)>/.exec(rest);
    if (auto) {
      out += `<a href="${escapeHtml(auto[1])}" rel="noopener">${escapeHtml(auto[1])}</a>`;
      i += auto[0].length;
      continue;
    }
    // Allowed inline HTML
    const tag = INLINE_TAGS.exec(rest);
    if (tag) {
      out += tag[0].toLowerCase().replace(/\s+/g, '');
      i += tag[0].length;
      continue;
    }
    // Strong, then emphasis
    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong) {
      out += `<strong>${inline(strong[2], link)}</strong>`;
      i += strong[0].length;
      continue;
    }
    const em = /^(\*|_)(?=\S)([\s\S]*?\S)\1(?![\w*])/.exec(rest);
    if (em && (em[1] === '*' || !/\w/.test(text[i - 1] ?? ''))) {
      out += `<em>${inline(em[2], link)}</em>`;
      i += em[0].length;
      continue;
    }
    // Backslash escape
    if (rest[0] === '\\' && /[\\`*_[\]()#+\-.!|<>]/.test(rest[1] ?? '')) {
      out += escapeHtml(rest[1]);
      i += 2;
      continue;
    }
    out += escapeHtml(rest[0]);
    i++;
  }
  return out;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === '`') inCode = !inCode;
    if (c === '\\' && trimmed[i + 1] === '|') {
      cell += '|';
      i++;
      continue;
    }
    if (c === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** Renders a Markdown document. `link` rewrites link and image targets (for the site's own paths). */
export function renderMarkdown(source: string, link: (href: string) => string = (h) => h): Rendered {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const html = blocks(lines, 0, lines.length);
  return { html, headings };

  function uniqueId(text: string): string {
    const base = slugify(text) || 'section';
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  }

  function blocks(src: string[], from: number, to: number): string {
    let out = '';
    let i = from;
    while (i < to) {
      const line = src[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      // Fenced code
      const fence = /^\s*(```|~~~)\s*([\w-]*)\s*$/.exec(line);
      if (fence) {
        const body: string[] = [];
        i++;
        while (i < to && !src[i].trim().startsWith(fence[1])) body.push(src[i++]);
        i++;
        const lang = fence[2] ? ` class="language-${fence[2]}"` : '';
        out += `<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>\n`;
        continue;
      }
      // Heading
      const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        const content = inline(heading[2], link);
        const id = uniqueId(heading[2]);
        headings.push({ level, text: heading[2].replace(/<[^>]+>/g, '').replace(/[`*]/g, ''), id });
        out += `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${content}</h${level}>\n`;
        i++;
        continue;
      }
      // Rule
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        out += '<hr>\n';
        i++;
        continue;
      }
      // Table: a header row followed by a separator row
      if (line.includes('|') && i + 1 < to && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(src[i + 1])) {
        const head = splitRow(line);
        const align = splitRow(src[i + 1]).map((c) =>
          c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '',
        );
        const style = (k: number) => (align[k] ? ` style="text-align:${align[k]}"` : '');
        i += 2;
        let rows = '';
        while (i < to && src[i].includes('|') && src[i].trim()) {
          const cells = splitRow(src[i++]);
          rows += `<tr>${head.map((_, k) => `<td${style(k)}>${inline(cells[k] ?? '', link)}</td>`).join('')}</tr>\n`;
        }
        out += `<div class="table"><table><thead><tr>${head.map((h, k) => `<th${style(k)}>${inline(h, link)}</th>`).join('')}</tr></thead><tbody>\n${rows}</tbody></table></div>\n`;
        continue;
      }
      // Block quote
      if (/^\s*>/.test(line)) {
        const body: string[] = [];
        while (i < to && /^\s*>/.test(src[i])) body.push(src[i++].replace(/^\s*>\s?/, ''));
        out += `<blockquote>\n${blocks(body, 0, body.length)}</blockquote>\n`;
        continue;
      }
      // List
      const item = LIST_ITEM.exec(line);
      if (item) {
        const indent = item[1].length;
        const ordered = /\d/.test(item[2]);
        let items = '';
        while (i < to) {
          const m = LIST_ITEM.exec(src[i]);
          if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
          // The item's own lines: its first line, continuation lines and anything indented deeper.
          const body = [m[3]];
          i++;
          while (i < to) {
            const next = src[i];
            if (!next.trim()) {
              // A blank line ends the item unless more of it (indented) follows.
              if (i + 1 < to && /^\s+/.test(src[i + 1]) && src[i + 1].match(/^\s*/)![0].length > indent) {
                body.push('');
                i++;
                continue;
              }
              break;
            }
            const nested = LIST_ITEM.exec(next);
            const deeper = next.match(/^\s*/)![0].length > indent;
            if (nested && !deeper) break;
            if (!deeper && /^\s*(#{1,6}\s|```|>|\|)/.test(next)) break;
            body.push(deeper ? next.replace(new RegExp(`^\\s{0,${indent + 4}}`), '') : next.trim());
            i++;
          }
          items += `<li>${listItem(body)}</li>\n`;
          while (i < to && !src[i].trim() && i + 1 < to && LIST_ITEM.exec(src[i + 1])?.[1].length === indent) i++;
        }
        out += ordered ? `<ol>\n${items}</ol>\n` : `<ul>\n${items}</ul>\n`;
        continue;
      }
      // Paragraph
      const para: string[] = [];
      while (
        i < to &&
        src[i].trim() &&
        !/^\s*(#{1,6}\s|```|~~~|>)/.test(src[i]) &&
        !LIST_ITEM.test(src[i]) &&
        !(src[i].includes('|') && i + 1 < to && /^\s*\|?\s*:?-{3,}/.test(src[i + 1]))
      ) {
        para.push(src[i++].trim());
      }
      if (para.length === 0) {
        out += `<p>${inline(src[i++].trim(), link)}</p>\n`;
        continue;
      }
      out += `<p>${inline(para.join('\n'), link)}</p>\n`;
    }
    return out;
  }

  /** A list item: plain text when it is one line of text, blocks otherwise. */
  function listItem(body: string[]): string {
    const first = body[0];
    if (body.length === 1) return inline(first, link);
    const firstBlockEnd = body.findIndex((l, k) => k > 0 && (!l.trim() || LIST_ITEM.test(l) || /^\s*```/.test(l)));
    const end = firstBlockEnd === -1 ? body.length : firstBlockEnd;
    const text = inline(body.slice(0, end).join('\n'), link);
    return end < body.length ? `${text}\n${blocks(body, end, body.length)}` : text;
  }
}
