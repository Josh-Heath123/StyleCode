import { isValidId } from '../../model/ids.ts';
import type { Timestamp } from './types.ts';

export { createId, isValidId } from '../../model/ids.ts';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(error: string): Result<T> => ({ ok: false, error });

/** Own keys only, so ids such as "constructor" can never resolve to something inherited. */
export function has(map: object, key: unknown): boolean {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
}

export function get<T>(map: Record<string, T>, key: unknown): T | undefined {
  return has(map, key) ? map[key as string] : undefined;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isTimestamp(value: unknown): value is Timestamp {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Milliseconds since the epoch, for comparing timestamps written with different offsets. */
export function time(value: Timestamp): number {
  return Date.parse(value);
}

export function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isText(value: unknown): value is string {
  return typeof value === 'string';
}

export function isId(value: unknown): value is string {
  return isValidId(value);
}

/**
 * Whether quoted words appear in a passage. Differences in white space, letter
 * case and the style of quotation marks and apostrophes are ignored; anything
 * else (a changed word, a missing comma) counts as not appearing, so evidence
 * can't be paraphrased.
 */
export function quoteAppearsIn(text: string, quote: string): boolean {
  const q = normaliseForQuote(quote);
  return q.length > 0 && normaliseForQuote(text).includes(q);
}

/** The fewest words a quote may have, unless it is the whole passage (so "a" can't count as evidence). */
export const MIN_QUOTE_WORDS = 3;

/** Whether a quote is long enough to be evidence: at least three words, or the whole passage. */
export function isQuoteLongEnough(text: string, quote: string): boolean {
  const q = normaliseForQuote(quote);
  if (!q) return false;
  if (q.split(' ').length >= MIN_QUOTE_WORDS) return true;
  const bare = (v: string) => v.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return bare(q) === bare(normaliseForQuote(text));
}

function normaliseForQuote(value: string): string {
  return value
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
