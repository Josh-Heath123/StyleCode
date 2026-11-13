/**
 * Key terms (Phase 3 brief, decision 8): the names, places and numbers in the
 * script, and whether the engine got each one. Pure.
 *
 * A key term is a normalised script word that is a number, or that the
 * script writes with a capital in the middle of a sentence (a name, a place,
 * a product), apart from "I". Each occurrence counts: found when the
 * alignment pairs it with the same word.
 */
import type { Step } from './align.ts';
import { normaliseWords } from './normalise.ts';

const NOT_TERMS = new Set(['i', 'im', 'ive', 'ill', 'id', 'ok']);

/** The normalised forms of the words the script capitalises mid-sentence. */
export function namesIn(texts: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const text of texts) {
    const tokens = text.split(/\s+/).filter(Boolean);
    for (let i = 1; i < tokens.length; i++) {
      const before = tokens[i - 1];
      if (/[.!?:]["')\]]*$/.test(before)) continue; // A sentence starts here.
      if (!/^["'(]*\p{Lu}/u.test(tokens[i])) continue;
      for (const w of normaliseWords(tokens[i])) if (!NOT_TERMS.has(w)) names.add(w);
    }
  }
  return names;
}

export const isNumber = (word: string) => /^\d+(\.\d+)?$/.test(word);

export interface TermScores {
  occurrences: number;
  found: number;
  /** Each term missed at least once, with how often it was missed and what was written instead. */
  missed: { term: string; times: number; writtenAs: string[] }[];
}

/** How many key-term occurrences in the script the engine wrote correctly. */
export function termScores(
  ref: readonly string[],
  hyp: readonly string[],
  steps: readonly Step[],
  names: Set<string>,
): TermScores {
  let occurrences = 0;
  let found = 0;
  const missed = new Map<string, { times: number; writtenAs: Set<string> }>();
  for (const s of steps) {
    if (s.op === 'ins') continue;
    const term = ref[s.ref];
    if (!isNumber(term) && !names.has(term)) continue;
    occurrences++;
    if (s.op === 'match') found++;
    else {
      const m = missed.get(term) ?? { times: 0, writtenAs: new Set<string>() };
      m.times++;
      m.writtenAs.add(s.op === 'sub' ? hyp[s.hyp] : '(nothing)');
      missed.set(term, m);
    }
  }
  return {
    occurrences,
    found,
    missed: [...missed]
      .map(([term, m]) => ({ term, times: m.times, writtenAs: [...m.writtenAs].sort() }))
      .sort((a, b) => b.times - a.times || a.term.localeCompare(b.term)),
  };
}
