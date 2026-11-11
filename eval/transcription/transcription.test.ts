import { describe, expect, it } from 'vitest';
import { alignWords, errorRate } from './align.ts';
import { normaliseTagged, normaliseWords } from './normalise.ts';
import { matchLabels, speakerScores } from './speakers.ts';
import { namesIn, termScores } from './terms.ts';
import { errorsBySpeaker, scoreSpeakers, scoreWords, scriptWords } from './score.ts';
import { engineTranscript, translateKey } from './downstream.ts';
import type { AnswerKey } from '../types.ts';

/** The transcription scorer (Phase 3 brief, decision 8 and WP2). */

const n = (text: string) => normaliseWords(text).join(' ');

describe('the normaliser', () => {
  it('ignores case, punctuation and fillers', () => {
    expect(n('Uh, so — the BINS, um, come in… at the tipper?')).toBe('so the bins come in at the tipper');
    expect(n('Mm. Ja.')).toBe('ja');
  });

  it('writes numbers as digits, however they were said', () => {
    expect(n('about a hundred and twenty a day')).toBe('about 120 a day');
    expect(n('two thousand four hundred bins')).toBe('2400 bins');
    expect(n('2,400 bins')).toBe('2400 bins');
    expect(n('R580,000 excluding VAT')).toBe('r 580000 excluding vat');
    expect(n('R 580 000 excluding VAT')).toBe('r 580000 excluding vat');
    expect(n('five hundred and eighty thousand rand')).toBe('580000 rand');
    expect(n('ten percent, 10% or 10 per cent')).toBe('10 percent 10 percent or 10 percent');
    expect(n('4.5 tonnes')).toBe('4.5 tons');
    expect(n('call oh eight two')).toBe('call 082');
  });

  it('leaves words that only look like numbers alone', () => {
    expect(n('a few of them, oh well')).toBe('a few of them oh well');
    expect(n('between two and three')).toBe('between 2 and 3');
    expect(n('the appointment point')).toBe('the appointment point');
  });

  it('makes British and American spelling the same word', () => {
    expect(n('We organise the centre’s programme and analyse the colour')).toBe(
      'we organize the centers program and analyze the color',
    );
    expect(n('organisation, prioritised, exercise, otherwise')).toBe('organization prioritized exercise otherwise');
  });

  it('reads numbers across an engine’s separate words, and remembers which word each came from', () => {
    expect(normaliseTagged(['About', 'a', 'hundred', 'and', 'twenty', 'a', 'day.'])).toEqual([
      { word: 'about', from: 0 },
      { word: '120', from: 1 },
      { word: 'a', from: 5 },
      { word: 'day', from: 6 },
    ]);
    expect(normaliseTagged(['R', '580', '000', 'or', '10', '%', 'per', 'cent']).map((t) => t.word)).toEqual([
      'r',
      '580000',
      'or',
      '10',
      'percent',
      'percent',
    ]);
  });

  it('splits hyphenated words and drops apostrophes', () => {
    expect(n("We're re-using the e-mail, don't worry")).toBe('were re using the e mail dont worry');
  });
});

describe('the alignment', () => {
  const words = (s: string) => s.split(' ');

  it('counts substitutions, deletions and insertions', () => {
    const ref = words('the bins come in at the tipper');
    const hyp = words('the bins come into the tipper now');
    const steps = alignWords(ref, hyp);
    expect(errorRate(steps, ref.length)).toMatchObject({ match: 5, sub: 1, del: 1, ins: 1 });
    expect(errorRate(steps, ref.length).wer).toBeCloseTo(3 / 7);
  });

  it('pairs every script word with what was written for it, in order', () => {
    const ref = words('a b c d e');
    const hyp = words('a x c e');
    const steps = alignWords(ref, hyp);
    expect(steps).toEqual([
      { op: 'match', ref: 0, hyp: 0 },
      { op: 'sub', ref: 1, hyp: 1 },
      { op: 'match', ref: 2, hyp: 2 },
      { op: 'del', ref: 3 },
      { op: 'match', ref: 4, hyp: 3 },
    ]);
  });

  it('finds the fewest edits on long texts too, the same as the full table', () => {
    // A seeded pseudo-random text of 3,000 words, and a copy with every 17th word changed, every 23rd dropped and every 31st doubled.
    let seed = 7;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed);
    const vocab = ['bins', 'grower', 'portal', 'tipper', 'scale', 'packhouse', 'rand', 'season', 'report', 'export'];
    const ref = Array.from({ length: 3000 }, () => vocab[next() % vocab.length]);
    const hyp: string[] = [];
    let changed = 0;
    let dropped = 0;
    let doubled = 0;
    for (const [i, w] of ref.entries()) {
      if (i % 23 === 0) {
        dropped++;
        continue;
      }
      if (i % 17 === 0) {
        hyp.push('misheard');
        changed++;
      } else hyp.push(w);
      if (i % 31 === 0) {
        hyp.push(w);
        doubled++;
      }
    }
    const steps = alignWords(ref, hyp);
    const rate = errorRate(steps, ref.length);
    // At most the edits made (an alignment may find a cheaper explanation, never a dearer one).
    expect(rate.sub + rate.del + rate.ins).toBeLessThanOrEqual(changed + dropped + doubled);
    expect(rate.match + rate.sub + rate.del).toBe(ref.length);
    expect(rate.match + rate.sub + rate.ins).toBe(hyp.length);
    // The steps walk both texts in order.
    let r = -1;
    let h = -1;
    for (const s of steps) {
      if ('ref' in s) expect(s.ref).toBe(++r);
      if ('hyp' in s) expect(s.hyp).toBe(++h);
    }
  });

  it('gives exactly the edit distance of the full table', () => {
    const distance = (a: string[], b: string[]) => {
      const t = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)),
      );
      for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
          t[i][j] = Math.min(t[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), t[i - 1][j] + 1, t[i][j - 1] + 1);
      return t[a.length][b.length];
    };
    let seed = 3;
    const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed);
    for (let k = 0; k < 20; k++) {
      const a = Array.from({ length: 50 + (next() % 150) }, () => String(next() % 6));
      const b = Array.from({ length: 50 + (next() % 150) }, () => String(next() % 6));
      const rate = errorRate(alignWords(a, b), a.length);
      expect(rate.sub + rate.del + rate.ins).toBe(distance(a, b));
    }
  });

  it('handles empty texts', () => {
    expect(alignWords([], ['a'])).toEqual([{ op: 'ins', hyp: 0 }]);
    expect(alignWords(['a'], [])).toEqual([{ op: 'del', ref: 0 }]);
    expect(errorRate([], 0).wer).toBe(0);
  });
});

describe('speakers', () => {
  const ref = [
    { speaker: 'Thandi', startMs: 0, endMs: 10_000 },
    { speaker: 'Pieter', startMs: 11_000, endMs: 21_000 },
    { speaker: 'Thandi', startMs: 22_000, endMs: 32_000 },
  ];

  it('matches each label to the person it overlaps most, splits included', () => {
    const hyp = [
      { label: 'spk_0', startMs: 0, endMs: 10_000 },
      { label: 'spk_1', startMs: 11_000, endMs: 21_000 },
      { label: 'spk_2', startMs: 22_000, endMs: 32_000 },
    ];
    expect([...matchLabels(ref, hyp)]).toEqual([
      ['spk_0', 'Thandi'],
      ['spk_1', 'Pieter'],
      ['spk_2', 'Thandi'],
    ]);
    const scores = speakerScores(ref, hyp);
    expect(scores).toMatchObject({ people: 2, labels: 3, labelsPerPerson: { Thandi: 2, Pieter: 1 }, wrongSpeaker: 0, missed: 0 });
  });

  it('counts time given the wrong person, time missed, and speech where nobody spoke', () => {
    const hyp = [
      // Thandi's first turn: the last 2 s given to Pieter's label.
      { label: 'A', startMs: 0, endMs: 8000 },
      { label: 'B', startMs: 8000, endMs: 10_000 },
      // Pieter: 1 s missed at the start, and 1 s of "speech" in the gap after.
      { label: 'B', startMs: 12_000, endMs: 22_000 },
      { label: 'A', startMs: 22_000, endMs: 32_000 },
    ];
    const s = speakerScores(ref, hyp);
    expect(s.wrongSpeaker).toBeCloseTo(2000 / 29_000, 3);
    expect(s.missed).toBeCloseTo(1000 / 30_000, 3);
    expect(s.falseSpeech).toBeCloseTo(1000 / 30_000, 3);
  });

  it('counts two labels at once for different people as wrong', () => {
    const s = speakerScores(
      [
        { speaker: 'Thandi', startMs: 0, endMs: 10_000 },
        { speaker: 'Pieter', startMs: 20_000, endMs: 30_000 },
      ],
      [
        { label: 'A', startMs: 0, endMs: 10_000 },
        { label: 'B', startMs: 20_000, endMs: 30_000 },
        { label: 'B', startMs: 5000, endMs: 6000 },
      ],
    );
    expect(s.wrongSpeaker).toBeCloseTo(1000 / 20_000, 3);
  });
});

describe('key terms', () => {
  it('are numbers and words capitalised mid-sentence, apart from I', () => {
    const names = namesIn(['Morning, everyone. I drive from Bloemfontein to Colesberg with Thandi.', 'Thandi said so.']);
    expect([...names].sort()).toEqual(['bloemfontein', 'colesberg', 'thandi']);
  });

  it('count each occurrence, found when written the same', () => {
    const ref = normaliseWords('Thandi drives 120 kilometres to Colesberg and Thandi agrees');
    const hyp = normaliseWords('Tandy drives a hundred and twenty kilometers to Colesburg and Thandi agrees');
    const s = termScores(ref, hyp, alignWords(ref, hyp), new Set(['thandi', 'colesberg']));
    expect(s.occurrences).toBe(4);
    expect(s.found).toBe(2);
    expect(s.missed).toEqual([
      { term: 'colesberg', times: 1, writtenAs: ['colesburg'] },
      { term: 'thandi', times: 1, writtenAs: ['tandy'] },
    ]);
  });
});

describe('scoring a run', () => {
  const turns = [
    { turn: 'T1', speaker: 'Sam', segments: ['s1'], text: 'Morning, everyone.', startMs: 0, endMs: 1000 },
    {
      turn: 'T2',
      speaker: 'Thandi',
      segments: ['s2', 's3'],
      text: 'We run forty trucks from Midrand.',
      startMs: 1500,
      endMs: 4000,
    },
  ];
  const w = (text: string, startMs: number, confidence: number) => ({ text, startMs, endMs: startMs + 300, confidence });
  const words = [
    w('Morning,', 0, 0.9),
    w('everyone.', 400, 0.95),
    w('We', 1500, 0.9),
    w('run', 1800, 0.9),
    w('40', 2100, 0.95),
    w('trucks', 2400, 0.9),
    w('from', 2700, 0.9),
    w('Midrent.', 3000, 0.3),
  ];

  it('counts word errors after normalising, key terms, and how well low confidence marks the errors', () => {
    const s = scoreWords(turns, words);
    expect(s).toMatchObject({ refWords: 8, wer: 1 / 8, sub: 1, del: 0, ins: 0 });
    expect(s.terms).toMatchObject({ occurrences: 2, found: 1 });
    const at = (t: number) => s.confidence!.find((c) => c.threshold === t)!;
    expect(at(0.5)).toMatchObject({ wrongBelow: 1, wrongAbove: 0, caught: 1 });
    expect(at(0.5).below).toBeCloseTo(1 / 8);
  });

  it('counts words given the right person, and errors by person', () => {
    const s = scoreWords(turns, words);
    const speakers = [
      { label: 'a', startMs: 0, endMs: 1000 },
      { label: 'b', startMs: 1500, endMs: 2600 },
      { label: 'a', startMs: 2600, endMs: 4000 },
    ];
    // "from" and "Midrent" fall in a stretch given to Sam's label.
    expect(scoreSpeakers(turns, words, speakers, s.steps).wordsRightSpeaker).toBeCloseTo(6 / 8);
    expect(errorsBySpeaker(s.steps, scriptWords(turns).speakers)).toEqual({
      Sam: { words: 2, errors: 0, rate: 0 },
      Thandi: { words: 6, errors: 1, rate: 1 / 6 },
    });
  });

  it('translates the key’s turns into the engine’s segments by time', () => {
    const transcript = engineTranscript('m', 'M', 'UTC', '', turns, words, null, 'test');
    // Without speakers, one segment holds everything; both turns overlap it.
    expect(transcript.segments).toHaveLength(1);
    const key = {
      meeting: 'm',
      status: '',
      findings: [{ id: 'F1', kind: 'existing-system', status: 'confirmed', statement: '', turns: ['T2'], segments: ['s2'] }],
    } as unknown as AnswerKey;
    expect(translateKey(key, turns, transcript).findings[0].segments).toEqual(['e1']);
  });
});
