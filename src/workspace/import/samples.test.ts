import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ParsedSegment } from '../model/transcripts.ts';
import { readPastedTranscript, readTranscriptFile, type TranscriptLayout } from './read.ts';
import { tidy } from './text.ts';

/**
 * Every sample layout against the meeting it holds (Phase 2 brief, WP2):
 * the same speakers, and the same words in the same order, once consecutive
 * segments by one speaker are joined. The reviewer checked all the files this
 * way, so a failure here is in the reader, not the sample.
 */
const DIR = join(import.meta.dirname, '../../../docs/phase-2/samples/karoo-freight-kickoff');
const meeting = JSON.parse(readFileSync(join(DIR, 'meeting.json'), 'utf8')) as {
  startsAt: string;
  timeZone: string;
  turns: { id: string; speaker: string; startMs: number; endMs: number; text: string }[];
};
const context = { startsAt: meeting.startsAt, timeZone: meeting.timeZone };

/** Consecutive segments by one speaker, joined. */
function turnsOf(segments: ParsedSegment[]): { speaker: string | null; text: string }[] {
  const turns: { speaker: string | null; text: string }[] = [];
  for (const s of segments) {
    const last = turns.at(-1);
    if (last && last.speaker === s.speakerLabel) last.text = tidy(`${last.text} ${s.text}`);
    else turns.push({ speaker: s.speakerLabel, text: tidy(s.text) });
  }
  return turns;
}

/** The meeting as the file should give it: Teams calls Lerato a guest (`comparing` in meeting.json). */
function expected(teams: boolean) {
  return meeting.turns.map((t) => ({
    speaker: teams && t.speaker === 'Lerato Dlamini' ? 'Lerato Dlamini (Guest)' : t.speaker,
    text: tidy(t.text),
  }));
}

const SAMPLES: [file: string, layout: TranscriptLayout, platform: string, teams: boolean][] = [
  ['teams-transcript.vtt', 'teams-vtt', 'teams', true],
  ['teams-graph-transcript.vtt', 'teams-graph-vtt', 'teams', true],
  ['teams-transcript.docx', 'teams-docx', 'teams', true],
  ['teams-transcript-older-layout.docx', 'teams-docx-older', 'teams', true],
  ['zoom-recording-transcript.vtt', 'zoom-vtt', 'zoom', false],
  ['zoom-saved-transcript.txt', 'zoom-txt', 'zoom', false],
  ['google-meet-transcript.docx', 'meet-docx', 'meet', false],
  ['google-meet-transcript.txt', 'meet-txt', 'meet', false],
  ['google-meet-gemini-notes.docx', 'meet-gemini-docx', 'meet', false],
];

async function read(file: string) {
  const result = await readTranscriptFile(file, new Uint8Array(readFileSync(join(DIR, file))), context);
  if (!result.ok) throw new Error(`${file}: ${result.error}`);
  return result.value;
}

describe('every sample layout reads as the meeting it holds', () => {
  it.each(SAMPLES)('%s', async (file, layout, platform, teams) => {
    const result = await read(file);
    expect(result.layout).toBe(layout);
    expect(result.platform).toBe(platform);
    expect(result.format).toBe(file.split('.').pop());
    expect(turnsOf(result.segments)).toEqual(expected(teams));
  });

  it('pasted-transcript.txt, which has one line without a speaker after T20', async () => {
    const text = readFileSync(join(DIR, 'pasted-transcript.txt'), 'utf8');
    const want: { speaker: string | null; text: string }[] = expected(false);
    const t20 = meeting.turns.findIndex((t) => t.id === 'T20');
    want.splice(t20 + 1, 0, { speaker: null, text: '(Lerato joined late; her camera was off.)' });
    const pasted = readPastedTranscript(text, context);
    if (!pasted.ok) throw new Error(pasted.error);
    expect(pasted.value).toMatchObject({ format: null, layout: 'lines', platform: 'other' });
    expect(turnsOf(pasted.value.segments)).toEqual(want);
    // The same text saved as a file reads the same way, as a .txt of no platform.
    const file = await read('pasted-transcript.txt');
    expect(file).toMatchObject({ format: 'txt', layout: 'lines', platform: 'other' });
    expect(turnsOf(file.segments)).toEqual(want);
  });
});

describe('segments follow the source (decision 3)', () => {
  it('joins the parts of a Teams utterance, where its first part was, with another speaker’s cue between', async () => {
    const { segments } = await read('teams-transcript.vtt');
    // Parts 17-0, 17-1 and 17-2 are T1, one segment from the first part's start to the last part's end.
    expect(segments[0]).toEqual({ speakerLabel: 'Sam Naidoo', startMs: 3100, endMs: 19500, text: tidy(meeting.turns[0].text) });
    // Utterance 38 has a part on either side of 39 (another speaker): one segment, placed before 39's.
    const vtt = readFileSync(join(DIR, 'teams-transcript.vtt'), 'utf8');
    const order = [...vtt.matchAll(/\/(\d+)-\d+\n/g)].map((m) => m[1]);
    expect(order.indexOf('39')).toBeLessThan(order.lastIndexOf('38'));
    const ids = [...new Set(order)];
    expect(segments).toHaveLength(ids.length);
    expect(ids.indexOf('38')).toBeLessThan(ids.indexOf('39'));
  });

  it('keeps each Zoom cue as its own segment, and the meeting’s times', async () => {
    const zoom = await read('zoom-recording-transcript.vtt');
    expect(zoom.segments.length).toBeGreaterThan(meeting.turns.length);
    expect(zoom.segments[0]).toEqual({ speakerLabel: 'Sam Naidoo', startMs: 3100, endMs: 4253, text: 'Morning, everyone.' });
  });

  it('reads the older Teams layout’s unpadded milliseconds: 0:0:6.24 is 6 s 24 ms', async () => {
    const older = await read('teams-transcript-older-layout.docx');
    expect(older.segments[0]).toMatchObject({ startMs: 3100, endMs: 6024 });
    expect(older.segments[1]).toMatchObject({ startMs: 6024 });
  });

  it('gives a Teams Word transcript its times from the start', async () => {
    const docx = await read('teams-transcript.docx');
    expect(docx.segments.slice(0, 3).map((s) => s.startMs)).toEqual([3000, 20000, 22000]);
  });

  it('applies a Google Meet time line to the first segment after it only', async () => {
    for (const file of ['google-meet-transcript.txt', 'google-meet-transcript.docx', 'google-meet-gemini-notes.docx']) {
      const meet = await read(file);
      expect(meet.segments[0].startMs).toBe(0);
      expect(meet.segments.slice(1).every((s) => s.startMs === null)).toBe(true);
    }
  });

  it('never imports Gemini’s notes, only the transcript', async () => {
    const gemini = await read('google-meet-gemini-notes.docx');
    const words = gemini.segments.map((s) => s.text).join(' ');
    expect(words).not.toContain('described dispatch on WhatsApp');
    expect(words).not.toContain('will send a summary this afternoon');
  });

  it('reads Zoom’s times of day in the session’s time zone, from its start', async () => {
    const zoom = await read('zoom-saved-transcript.txt');
    // 10:00:03 in Johannesburg is 3 s after the 08:00 UTC start.
    expect(zoom.times).toEqual({ from: 'session-start', firstTime: '10:00:03' });
    expect(zoom.segments.slice(0, 3).map((s) => s.startMs)).toEqual([3000, 20000, 22000]);
  });
});
