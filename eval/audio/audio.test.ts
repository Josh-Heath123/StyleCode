import { describe, expect, it } from 'vitest';
import { decibels, resample, rms, roomNoise, roomReflections, seededRandom, seedOf, withEcho } from './dsp.ts';
import { hardRoom, mixTurns, normalise, NOISE_BELOW_SPEECH_DB, placeTurns, type SpokenTurn } from './timeline.ts';
import { spokenText, tooShort, trimSilence, turnsOf } from './speech.ts';
import { readWav, writeWav16 } from './wav.ts';

/** The test meetings' audio (Phase 3 brief, decision 3): WAV files, resampling, the timeline and the hard room. */

const tone = (hz: number, rate: number, seconds: number, level = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => level * Math.sin((2 * Math.PI * hz * i) / rate));

/** The strength of one frequency in the samples (a single DFT bin). */
function strength(samples: Float32Array, hz: number, rate: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < samples.length; i++) {
    re += samples[i] * Math.cos((2 * Math.PI * hz * i) / rate);
    im -= samples[i] * Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return Math.hypot(re, im) / samples.length;
}

describe('WAV files', () => {
  it('writes 16 kHz mono 16-bit and reads it back', () => {
    const samples = tone(440, 16000, 0.1);
    const bytes = writeWav16({ sampleRate: 16000, samples });
    expect(bytes.length).toBe(44 + samples.length * 2);
    const back = readWav(bytes);
    expect(back.sampleRate).toBe(16000);
    expect(back.samples.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i++) expect(back.samples[i]).toBeCloseTo(samples[i], 4);
  });

  it('reads 32-bit float stereo, averaged to mono, and refuses what isn’t a WAV', () => {
    const frames = 4;
    const bytes = new Uint8Array(44 + frames * 8);
    const view = new DataView(bytes.buffer);
    const text = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + frames * 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 3, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, 48000, true);
    view.setUint16(34, 32, true);
    text(36, 'data');
    view.setUint32(40, frames * 8, true);
    for (let i = 0; i < frames; i++) {
      view.setFloat32(44 + i * 8, 0.5, true);
      view.setFloat32(48 + i * 8, -0.1, true);
    }
    const read = readWav(bytes);
    expect(read.sampleRate).toBe(48000);
    expect([...read.samples].map((s) => +s.toFixed(3))).toEqual([0.2, 0.2, 0.2, 0.2]);
    expect(() => readWav(new TextEncoder().encode('not a wav file at all'))).toThrow(/Not a WAV/);
  });

  it('clips samples beyond ±1 rather than wrapping', () => {
    const back = readWav(writeWav16({ sampleRate: 16000, samples: Float32Array.from([2, -2]) }));
    expect(back.samples[0]).toBeCloseTo(1, 3);
    expect(back.samples[1]).toBeCloseTo(-1, 3);
  });
});

describe('resampling', () => {
  it('keeps a tone’s pitch and the length in time, 24 kHz to 16 kHz', () => {
    const out = resample(tone(1000, 24000, 0.5), 24000, 16000);
    expect(out.length).toBe(8000);
    expect(strength(out, 1000, 16000)).toBeGreaterThan(0.2);
  });

  it('removes what the lower rate can’t hold, instead of folding it back', () => {
    // 10 kHz is above 16 kHz's limit of 8 kHz; without filtering it would come back as 6 kHz.
    const out = resample(tone(10000, 24000, 0.5), 24000, 16000);
    expect(strength(out, 6000, 16000)).toBeLessThan(0.01);
    expect(rms(out)).toBeLessThan(0.02);
  });
});

describe('the seeded sources', () => {
  it('give the same sequence for the same seed, and another for another', () => {
    const a = seededRandom(seedOf('karoo/gaps'));
    const b = seededRandom(seedOf('karoo/gaps'));
    const c = seededRandom(seedOf('veldt/gaps'));
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

const turns: (SpokenTurn & { durationMs: number })[] = [
  { turn: 'T1', speaker: 'A', segments: ['s1'], text: 'Hello there, everyone.', durationMs: 2000 },
  { turn: 'T2', speaker: 'B', segments: ['s2', 's3'], text: 'Hello. We have a long story to tell.', durationMs: 4000 },
  { turn: 'T3', speaker: 'A', segments: ['s4'], text: 'Mm.', durationMs: 400 },
  { turn: 'T4', speaker: 'B', segments: ['s5'], text: 'So, as I was saying.', durationMs: 1500 },
];

describe('the timeline', () => {
  it('places turns in order, with gaps of 0.3 to 1.2 seconds, the same every time', () => {
    const one = placeTurns('m', 'clean', turns, { interjections: ['T3'] });
    expect(placeTurns('m', 'clean', turns, { interjections: ['T3'] })).toEqual(one);
    expect(one.turns[0]).toMatchObject({ turn: 'T1', startMs: 1000, endMs: 3000, segments: ['s1'] });
    for (let i = 1; i < one.turns.length; i++) {
      const gap = one.turns[i].startMs - one.turns[i - 1].endMs;
      expect(gap).toBeGreaterThanOrEqual(300);
      expect(gap).toBeLessThanOrEqual(1200);
    }
    expect(one.durationMs).toBe(one.turns[3].endMs + 1000);
  });

  it('in the hard version, an interjection overlaps the end of the turn before by up to half a second', () => {
    const clean = placeTurns('m', 'clean', turns, { interjections: ['T3'] });
    const hard = placeTurns('m', 'hard', turns, { interjections: ['T3'] });
    const [, t2, t3, t4] = hard.turns;
    const overlap = t2.endMs - t3.startMs;
    expect(overlap).toBeGreaterThanOrEqual(200);
    expect(overlap).toBeLessThanOrEqual(500);
    // The next turn waits for both to end, with its own gap.
    expect(t4.startMs - Math.max(t2.endMs, t3.endMs)).toBe(clean.turns[3].startMs - clean.turns[2].endMs);
    expect(hard.turns.slice(0, 2)).toEqual(clean.turns.slice(0, 2));
  });

  it('never overlaps more than half of a short turn', () => {
    const short = turns.map((t) => (t.turn === 'T2' ? { ...t, durationMs: 300 } : t));
    const [, t2, t3] = placeTurns('m', 'hard', short, { interjections: ['T3'] }).turns;
    expect(t2.endMs - t3.startMs).toBeLessThanOrEqual(150);
  });

  it('adds the pause after its turn in the hard version only', () => {
    const audio = { interjections: [], pause: { afterTurn: 'T2', seconds: 120 } };
    const clean = placeTurns('m', 'clean', turns, audio);
    const hard = placeTurns('m', 'hard', turns, audio);
    expect(hard.turns[2].startMs - clean.turns[2].startMs).toBe(120_000);
    expect(hard.durationMs - clean.durationMs).toBe(120_000);
  });
});

describe('the mix and the hard room', () => {
  it('puts each turn’s samples where the timeline says', () => {
    const placed = placeTurns('m', 'clean', turns, { interjections: [] });
    const rate = 1000;
    const out = mixTurns(placed.turns, placed.durationMs, rate, (t) => new Float32Array(10).fill(t === 'T2' ? 0.5 : 0.25));
    const at = (ms: number) => out[Math.round((ms / 1000) * rate)];
    expect(out.length).toBe(Math.ceil(placed.durationMs));
    expect(at(placed.turns[1].startMs)).toBe(0.5);
    expect(at(placed.turns[0].startMs)).toBe(0.25);
    expect(at(500)).toBe(0);
  });

  it('adds noise 15 dB below the speech, also where nobody speaks, and an echo after each sound', () => {
    const rate = 16000;
    const speech = new Float32Array(rate * 4);
    speech.set(tone(300, rate, 1), rate); // One second of "speech" from 1 s to 2 s.
    const loud = rms(speech.subarray(rate, 2 * rate));
    const hard = hardRoom(speech, loud, rate, 'm');
    expect(hard.length).toBe(speech.length);
    const quiet = rms(hard.subarray(3 * rate, 4 * rate)); // Only noise here.
    expect(decibels(loud, quiet)).toBeGreaterThan(NOISE_BELOW_SPEECH_DB - 1);
    expect(decibels(loud, quiet)).toBeLessThan(NOISE_BELOW_SPEECH_DB + 1);
    // The echo: just after the speech stops, the room still rings above the noise alone.
    expect(rms(hard.subarray(2 * rate, 2 * rate + rate / 20))).toBeGreaterThan(quiet * 1.2);
    expect(hardRoom(speech, loud, rate, 'm')).toEqual(hard);
  });

  it('builds reflections that decay, and an echo that lengthens the sound by the last one', () => {
    const taps = roomReflections(16000, 1);
    expect(taps.length).toBe(24);
    expect(Math.abs(taps[0].gain)).toBeGreaterThan(Math.abs(taps.at(-1)!.gain));
    expect(withEcho(new Float32Array(100), taps).length).toBe(100 + taps.at(-1)!.delay);
  });

  it('noise has the loudness asked for, and normalising leaves the loudest sample at 0.9', () => {
    expect(rms(roomNoise(16000, 0.05, 3))).toBeCloseTo(0.05, 5);
    const out = normalise(Float32Array.from([0.1, -0.3, 0.2]));
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(0.9, 6);
  });
});

describe('from a typed transcript to speech', () => {
  it('joins a turn’s segments, and keeps their ids', () => {
    const t = {
      consultation: 'm',
      title: '',
      startsAt: '',
      timeZone: 'UTC',
      source: { fileName: 'm.vtt', layout: 'teams-vtt' },
      segments: [
        { id: 's1', turn: 'T1', speakerLabel: 'A', startMs: 0, endMs: 1, text: 'One.' },
        { id: 's2', turn: 'T1', speakerLabel: 'A', startMs: 1, endMs: 2, text: 'Two.' },
        { id: 's3', turn: 'T2', speakerLabel: 'B', startMs: 2, endMs: 3, text: 'Three.' },
      ],
    };
    expect(turnsOf(t)).toEqual([
      { turn: 'T1', speaker: 'A', segments: ['s1', 's2'], text: 'One. Two.' },
      { turn: 'T2', speaker: 'B', segments: ['s3'], text: 'Three.' },
    ]);
  });

  it('gives the voice plain punctuation it knows', () => {
    expect(spokenText('It’s “fine” — mostly… really')).toBe('It\'s "fine", mostly... really');
  });

  it('flags a turn too short for its words, but not a one-word interjection', () => {
    expect(tooShort('one two three four five six seven eight nine ten', 1)).toBe(true);
    expect(tooShort('one two three four five six seven eight nine ten', 3)).toBe(false);
    expect(tooShort('Mm.', 0.1)).toBe(false);
  });

  it('trims the tool’s silence at either end, keeping 30 ms', () => {
    const rate = 1000;
    const s = new Float32Array(1000);
    s.fill(0.5, 400, 600);
    const out = trimSilence(s, rate);
    expect(out.length).toBe(200 + 60);
    expect(trimSilence(new Float32Array(10), rate).length).toBe(0);
  });
});
