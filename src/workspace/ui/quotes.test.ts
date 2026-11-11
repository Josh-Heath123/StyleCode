import { describe, expect, it } from 'vitest';
import { findQuote } from './quotes';

describe('finding quoted words in a passage', () => {
  const text = "We've got about forty trucks, and   the drivers don’t like apps.";
  it('ignores case, white space and the style of apostrophes', () => {
    expect(findQuote(text, 'we’ve got about forty')).toEqual({ start: 0, end: 21 });
    expect(findQuote(text, "the drivers don't like")).toMatchObject({ start: 36 });
  });
  it('finds nothing for words that aren’t there, or no words', () => {
    expect(findQuote(text, 'fifty trucks')).toBeNull();
    expect(findQuote(text, '  ')).toBeNull();
    expect(findQuote(text, 'forty (trucks')).toBeNull();
  });
});
