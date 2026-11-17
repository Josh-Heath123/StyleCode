import type { ReactNode } from 'react';
import { findQuote } from './quotes';

/**
 * A passage's text with the words a proposal quotes from it marked, and, in
 * a transcript made on this computer, the words the engine was unsure of
 * (decision 19, as changed at the WP3 check-in): a dotted underline, and
 * "may be misheard" on hover, on focus and for screen readers.
 */
export function Quoted({
  text,
  quotes,
  unsure = [],
}: {
  text: string;
  quotes: readonly string[] | undefined;
  /** `[start, end)` ranges of the words to mark "may be misheard". */
  unsure?: readonly (readonly [number, number])[];
}): ReactNode {
  const spans = (quotes ?? [])
    .map((q) => findQuote(text, q))
    .filter((s): s is { start: number; end: number } => s !== null)
    .sort((a, b) => a.start - b.start);
  if (!spans.length && !unsure.length) return text;

  /** `text` from `from` to `to`, with the quoted parts marked. */
  const marked = (from: number, to: number): ReactNode[] => {
    const parts: ReactNode[] = [];
    let at = from;
    for (const s of spans) {
      const start = Math.max(s.start, at);
      const end = Math.min(s.end, to);
      if (end <= start) continue;
      if (start > at) parts.push(text.slice(at, start));
      parts.push(<mark key={`q${start}`}>{text.slice(start, end)}</mark>);
      at = end;
    }
    if (at < to) parts.push(text.slice(at, to));
    return parts;
  };

  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of unsure) {
    if (start < at || end <= start) continue;
    if (start > at) parts.push(...marked(at, start));
    parts.push(
      <span key={`u${start}`} className="ws-unsure" tabIndex={0} data-unsure="May be misheard">
        {marked(start, end)}
        <span className="visually-hidden"> (may be misheard)</span>
      </span>,
    );
    at = end;
  }
  if (at < text.length) parts.push(...marked(at, text.length));
  return <>{parts}</>;
}
