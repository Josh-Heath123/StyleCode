/**
 * Words as the transcription scorer compares them (Phase 3 brief, decision
 * 8): the same for the script and for every engine, so differences of
 * writing aren't counted as mishearings.
 *
 * - case and punctuation are ignored, and hyphenated words are split;
 * - fillers ("uh", "um", "mm"…) are left out on both sides;
 * - numbers are digits whether written as words or digits ("a hundred and
 *   twenty", "120"; "R580,000", "R 580 000"; "ten percent", "10%");
 * - British and American spellings are the same word ("organise",
 *   "organize"; "centre", "center").
 *
 * Pure.
 */

const FILLERS = new Set(['uh', 'um', 'umm', 'uhm', 'er', 'erm', 'ah', 'eh', 'hmm', 'hm', 'mm', 'mmm', 'mhm', 'uhhuh']);

const SMALL: Record<string, number> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000 };

/** Spellings made the same: British to American, as whole words. */
const SPELLINGS: Record<string, string> = {
  colour: 'color',
  colours: 'colors',
  favour: 'favor',
  favourite: 'favorite',
  labour: 'labor',
  neighbour: 'neighbor',
  behaviour: 'behavior',
  honour: 'honor',
  centre: 'center',
  centres: 'centers',
  metre: 'meter',
  metres: 'meters',
  kilometre: 'kilometer',
  kilometres: 'kilometers',
  litre: 'liter',
  litres: 'liters',
  programme: 'program',
  programmes: 'programs',
  licence: 'license',
  licences: 'licenses',
  defence: 'defense',
  catalogue: 'catalog',
  analyse: 'analyze',
  analysed: 'analyzed',
  analysing: 'analyzing',
  travelled: 'traveled',
  travelling: 'traveling',
  cancelled: 'canceled',
  cancelling: 'canceling',
  labelled: 'labeled',
  labelling: 'labeling',
  modelling: 'modeling',
  enrol: 'enroll',
  enrolment: 'enrollment',
  cheque: 'check',
  grey: 'gray',
  tonne: 'ton',
  tonnes: 'tons',
  okay: 'ok',
  alright: 'all right',
  percent: 'percent',
};

/** -ise words that are spelt -ize in American English (not "exercise", "otherwise", "rise"…). */
const ISE_STEMS = [
  'organ',
  'real',
  'recogn',
  'priorit',
  'final',
  'custom',
  'author',
  'standard',
  'summar',
  'digit',
  'minim',
  'maxim',
  'optim',
  'apolog',
  'emphas',
  'special',
  'util',
  'central',
  'categor',
  'familiar',
  'synchron',
  'capital',
  'computer',
  'local',
  'personal',
  'visual',
];
const ISE = new RegExp(`^(${ISE_STEMS.join('|')})is(e|es|ed|ing|ation|ations)$`);

function spelling(word: string): string {
  if (Object.hasOwn(SPELLINGS, word)) return SPELLINGS[word];
  const m = ISE.exec(word);
  return m ? `${m[1]}iz${m[2]}` : word;
}

/** Reads a run of number words ("two thousand four hundred", "a hundred and twenty") as a number; null if it isn't one. */
function numberFrom(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let any = false;
  for (const [i, w] of words.entries()) {
    if (w === 'and' || (w === 'a' && i === 0)) {
      if (w === 'a') current = 1;
      continue;
    }
    if (Object.hasOwn(SMALL, w)) {
      current += SMALL[w];
      any = true;
    } else if (w === 'hundred') {
      current = (current || 1) * 100;
      any = true;
    } else if (Object.hasOwn(SCALES, w)) {
      total += (current || 1) * SCALES[w];
      current = 0;
      any = true;
    } else return null;
  }
  return any ? total + current : null;
}

const isNumberWord = (w: string) => Object.hasOwn(SMALL, w) || Object.hasOwn(SCALES, w);
const isScale = (w: string) => Object.hasOwn(SCALES, w);

/** A normalised word and the piece of text (an engine's word) it came from. */
export interface TaggedWord {
  word: string;
  from: number;
}

/**
 * Turns runs of number words into digits. "and" joins number words only
 * after a scale; "a" starts one only before a scale. A run's digits are
 * tagged with the piece its first word came from.
 */
function wordsToDigits(words: TaggedWord[]): TaggedWord[] {
  const out: TaggedWord[] = [];
  const at = (k: number) => words[k]?.word ?? '';
  let i = 0;
  while (i < words.length) {
    const w = at(i);
    const startsRun = isNumberWord(w) || (w === 'a' && isScale(at(i + 1)));
    // "oh" is a number only inside a run of digits ("oh eight two"), never on its own.
    if (!startsRun || (w === 'oh' && !isNumberWord(at(i + 1)))) {
      out.push(words[i]);
      i++;
      continue;
    }
    let j = i + 1;
    // "and" carries on a number only after a scale, as in "a hundred and twenty"; "two and three" stays as it is.
    while (j < words.length && (isNumberWord(at(j)) || (at(j) === 'and' && isScale(at(j - 1)) && isNumberWord(at(j + 1))))) j++;
    const run = words.slice(i, j).map((x) => x.word);
    // A run of single digits ("oh eight two") is read digit by digit, as phone numbers are.
    const digits = run.every((x) => Object.hasOwn(SMALL, x) && SMALL[x] < 10);
    const value = digits && run.length > 1 ? run.map((x) => SMALL[x]).join('') : numberFrom(run);
    if (value === null) out.push(...words.slice(i, j));
    else out.push({ word: String(value), from: words[i].from });
    i = j;
  }
  return out;
}

/** One piece of text's words, before numbers are joined across pieces. */
function pieceWords(text: string): string[] {
  const spaced = (text.trim() === '%' ? 'percent' : text)
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    // Thousands written with commas or spaces between digit groups: "580,000", "580 000".
    .replace(/(\d)[, ](?=\d{3}\b)/g, '$1')
    // "R580000" → "r 580000"; "10%" → "10 percent".
    .replace(/\br(?=\d)/g, 'r ')
    .replace(/(\d)\s*%/g, '$1 percent')
    .replace(/per cent/g, 'percent')
    .replace(/[-–—/]/g, ' ')
    .replace(/(\d)\.(\d)/g, '$1decimalsep$2')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/'/g, '');
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/decimalsep/g, '.'))
    .filter((w) => !FILLERS.has(w))
    .map(spelling)
    .flatMap((w) => w.split(' '));
}

/**
 * Normalises several pieces of text as one (an engine's words, each its own
 * piece), so "a / hundred / and / twenty" across four words is still 120,
 * and tags each word with the piece it came from.
 */
export function normaliseTagged(pieces: readonly string[]): TaggedWord[] {
  const tagged = pieces.flatMap((p, from) => pieceWords(p).map((word) => ({ word, from })));
  // Joins across pieces: "per" "cent", and digit groups "580" "000".
  const joined: TaggedWord[] = [];
  for (const t of tagged) {
    const last = joined.at(-1);
    if (last && last.word === 'per' && t.word === 'cent') last.word = 'percent';
    else if (last && /^\d{1,3}$/.test(last.word) && /^\d{3}$/.test(t.word) && last.from !== t.from) last.word += t.word;
    else joined.push({ ...t });
  }
  return wordsToDigits(joined);
}

/** The text's words, normalised for comparing (see the file's comment). */
export function normaliseWords(text: string): string[] {
  return normaliseTagged([text]).map((w) => w.word);
}
