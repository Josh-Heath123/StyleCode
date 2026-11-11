const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where quoted words are in a passage, ignoring letter case, white space and
 * the style of quotation marks and apostrophes, as the evidence check does
 * (`quoteAppearsIn`). Null when they aren't there.
 */
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const pattern = words
    .map((w) =>
      escape(w)
        .replace(/['‘’‚′]/g, "['‘’‚′]")
        .replace(/["“”„″]/g, '["“”„″]'),
    )
    .join('\\s+');
  const match = new RegExp(pattern, 'i').exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
