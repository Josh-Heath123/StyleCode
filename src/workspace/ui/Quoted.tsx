import type { ReactNode } from 'react';
import { findQuote } from './quotes';

/** A passage's text with the words a proposal quotes from it marked. */
export function Quoted({ text, quotes }: { text: string; quotes: readonly string[] | undefined }): ReactNode {
  const spans = (quotes ?? [])
    .map((q) => findQuote(text, q))
    .filter((s): s is { start: number; end: number } => s !== null)
    .sort((a, b) => a.start - b.start);
  if (!spans.length) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.end <= at) continue;
    const start = Math.max(s.start, at);
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, s.end)}</mark>);
    at = s.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
