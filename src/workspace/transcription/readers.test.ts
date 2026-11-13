import { describe, expect, it } from 'vitest';
import { piecesFrom, readDiarization, readSherpaResults, readVadSegments, sherpaWords } from './sherpa';
import { readWhisperJson } from './whisper';

/** Reading the engines' output (Phase 3 brief, "Clarifications"), from output recorded on the user's laptop. */

describe('whisper.cpp', () => {
  // Cut down from whisper-cli -ojf on Karoo Freight (role-played, synthetic speech).
  const json = {
    transcription: [
      {
        offsets: { from: 880, to: 3760 },
        text: ' Morning, everyone. Thanks for making the time.',
        tokens: [
          { text: '[_BEG_]', offsets: { from: 0, to: 0 }, p: 0.9 },
          { text: ' Morning', offsets: { from: 880, to: 880 }, p: 0.978 },
          { text: ',', offsets: { from: 880, to: 890 }, p: 0.603 },
          { text: ' every', offsets: { from: 890, to: 1300 }, p: 0.99 },
          { text: 'one', offsets: { from: 1300, to: 1690 }, p: 0.95 },
          { text: '.', offsets: { from: 1910, to: 2000 }, p: 0.991 },
          { text: ' Thanks', offsets: { from: 2000, to: 2370 }, p: 0.973 },
          { text: '[_TT_188]', offsets: { from: 3760, to: 3760 }, p: 0.5 },
        ],
      },
    ],
  };

  it('joins tokens into words, leaves its markers out, and keeps the lowest probability', () => {
    expect(readWhisperJson(json)).toEqual([
      { text: 'Morning,', startMs: 880, endMs: 890, confidence: 0.603 },
      { text: 'everyone.', startMs: 890, endMs: 2000, confidence: 0.95 },
      { text: 'Thanks', startMs: 2000, endMs: 2370, confidence: 0.973 },
    ]);
  });

  it('with VAD, places tokens across their segment’s times, since their own are on the clock without pauses', () => {
    // From whisper-cli -ojf --vad on Karoo Freight's last segment: the segment at 204.8 s, its tokens at 191.1 s.
    const vad = {
      transcription: [
        {
          offsets: { from: 204800, to: 205700 },
          text: ' Thank you, everyone.',
          tokens: [
            { text: ' Thank', offsets: { from: 191140, to: 191140 }, p: 0.9 },
            { text: ' you', offsets: { from: 191140, to: 191280 }, p: 0.99 },
            { text: ',', offsets: { from: 191280, to: 191390 }, p: 0.8 },
            { text: ' everyone', offsets: { from: 191390, to: 191850 }, p: 0.97 },
            { text: '.', offsets: { from: 191850, to: 192040 }, p: 0.99 },
            { text: '[_TT_948]', offsets: { from: 192040, to: 192040 }, p: 0.5 },
          ],
        },
      ],
    };
    expect(readWhisperJson(vad, { vad: true })).toEqual(
      [
        { text: 'Thank', startMs: 204800, endMs: 204800 },
        { text: 'you,', startMs: 204800, endMs: 205050 },
        { text: 'everyone.', startMs: 205050, endMs: 205700 },
      ].map((w, i) => ({ ...w, confidence: [0.9, 0.8, 0.97][i] })),
    );
    // Read without the option, the words would sit 13 seconds before their segment.
    expect(readWhisperJson(vad).map((w) => w.startMs)).toEqual([191140, 191140, 191390]);
  });

  it('starts a word at each segment’s first token, even when its tokens end before the segment starts', () => {
    // From whisper-cli -ojf on a live 30-second piece of Bosveld Citrus: the tokens' starts moved up to the segment's, their ends not.
    const shifted = {
      transcription: [
        {
          offsets: { from: 3400, to: 3680 },
          text: ' them?',
          tokens: [{ text: ' them?', offsets: { from: 3400, to: 3680 }, p: 0.99 }],
        },
        {
          offsets: { from: 4580, to: 5000 },
          text: ' Precious can do',
          tokens: [
            { text: ' P', offsets: { from: 4580, to: 3750 }, p: 0.97 },
            { text: 'reci', offsets: { from: 4580, to: 4060 }, p: 0.99 },
            { text: 'ous', offsets: { from: 4580, to: 4290 }, p: 0.99 },
            { text: ' can', offsets: { from: 4580, to: 4520 }, p: 0.99 },
            { text: ' do', offsets: { from: 4580, to: 4650 }, p: 1 },
          ],
        },
      ],
    };
    const words = readWhisperJson(shifted);
    expect(words.map((w) => w.text)).toEqual(['them?', 'Precious', 'can', 'do']);
    expect(words.map((w) => [w.startMs, w.endMs])).toEqual([
      [3400, 3680],
      [4580, 4580],
      [4580, 4580],
      [4580, 4650],
    ]);
  });

  it('leaves out Whisper’s notes on sounds, which aren’t speech', () => {
    // From whisper-cli -ojf with small on the hard Bosveld Citrus, in its two-minute pause.
    const noted = {
      transcription: [
        {
          offsets: { from: 0, to: 1000 },
          text: ' on my desk.',
          tokens: [
            { text: ' on', offsets: { from: 0, to: 300 }, p: 0.99 },
            { text: ' my', offsets: { from: 300, to: 600 }, p: 0.99 },
            { text: ' desk', offsets: { from: 600, to: 950 }, p: 0.99 },
            { text: '.', offsets: { from: 950, to: 1000 }, p: 0.99 },
          ],
        },
        {
          offsets: { from: 21000, to: 25860 },
          text: ' [no audio]',
          tokens: [
            { text: ' [', offsets: { from: 21000, to: 21300 }, p: 0.99 },
            { text: 'no', offsets: { from: 21300, to: 22650 }, p: 0.99 },
            { text: ' audio', offsets: { from: 22650, to: 25500 }, p: 1 },
            { text: ']', offsets: { from: 25500, to: 25860 }, p: 1 },
          ],
        },
        { offsets: { from: 26000, to: 27000 }, text: ' [BLANK_AUDIO]', tokens: [] },
        { offsets: { from: 27000, to: 28000 }, text: ' (music) Right.' },
      ],
    };
    expect(readWhisperJson(noted).map((w) => w.text)).toEqual(['on', 'my', 'desk.', 'Right.']);
  });

  it('spreads a segment’s words over its time when there are no tokens, and refuses other JSON', () => {
    const plain = { transcription: [{ offsets: { from: 0, to: 1000 }, text: ' Yes fine.' }] };
    expect(readWhisperJson(plain)).toEqual([
      { text: 'Yes', startMs: 0, endMs: 500, confidence: null },
      { text: 'fine.', startMs: 500, endMs: 1000, confidence: null },
    ]);
    expect(() => readWhisperJson({ text: 'hello' })).toThrow(/whisper/);
  });
});

describe('sherpa-onnx', () => {
  it('reads the VAD’s stretches of speech and the speaker turns', () => {
    expect(readVadSegments('VadModelConfig(...)\n1.062 -- 18.092\n18.854 -- 28.428\n')).toEqual([
      { startMs: 1062, endMs: 18092 },
      { startMs: 18854, endMs: 28428 },
    ]);
    expect(readDiarization('Started\n1.027 -- 2.039 speaker_00\n2.039 -- 13.025 speaker_02\nDuration : 206.965 s')).toEqual([
      { label: 'speaker_00', startMs: 1027, endMs: 2039 },
      { label: 'speaker_02', startMs: 2039, endMs: 13025 },
    ]);
  });

  it('reads Parakeet’s tokens as words, at their place in the whole audio', () => {
    const out = [
      'C:/a.wav',
      '----',
      '{"lang": "", "text": "Morning, everyone.", "timestamps": [1.04, 1.20, 1.36, 1.52, 1.68, 1.92], "durations": [0.16, 0.16, 0.16, 0.16, 0.24, 0.16], "tokens": [" M", "or", "ning", ",", " every", "one."], "ys_log_probs": [-0.0025, -0.0003, -0.5, -0.449, -0.00005, -0.01], "words": []}',
      'num threads: 8',
    ].join('\n');
    const [result] = readSherpaResults(out);
    const words = sherpaWords(result, 10_000);
    expect(words.map((w) => [w.text, w.startMs, w.endMs])).toEqual([
      ['Morning,', 11040, 11680],
      ['everyone.', 11680, 12080],
    ]);
    expect(words[0].confidence).toBeCloseTo(Math.exp(-0.5), 5);
  });

  it('cuts long audio into pieces at the speech, widened a little, at most 30 seconds each', () => {
    const pieces = piecesFrom(
      [
        { startMs: 1000, endMs: 5000 },
        { startMs: 5100, endMs: 70_000 },
      ],
      71_000,
    );
    expect(pieces[0]).toEqual({ startMs: 800, endMs: 5050 });
    expect(pieces.slice(1).every((p) => p.endMs - p.startMs <= 30_000)).toBe(true);
    expect(pieces[1].startMs).toBe(5050);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].startMs).toBeGreaterThanOrEqual(pieces[i - 1].endMs);
    expect(pieces.at(-1)!.endMs).toBe(70_200);
  });
});
