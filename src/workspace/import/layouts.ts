/**
 * The transcript layouts that aren't WebVTT (`docs/phase-2/samples/README.md`):
 * Teams Word documents, current and older; Google Meet transcripts, as Word or
 * plain text, including "Notes by Gemini"; Zoom's saved transcript; and text
 * typed or pasted as `Name: words` lines. Each takes the text already split
 * into paragraphs or lines, and returns segments, or null when the text isn't
 * in its layout.
 */
import type { ParsedSegment } from '../model/transcripts.ts';
import { clockMs, splitSpeaker, tidy } from './text.ts';
import { fromWallClock, wallClock } from './zone.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Teams `.docx`, current layout: a `Name<tab>0:03` line (a space instead of
 * the tab is seen too), the words, then a blank paragraph. Lines before the
 * first speaker (title, date, length, "Name started transcription") are left out.
 */
export function readTeamsDocx(paragraphs: readonly string[]): ParsedSegment[] | null {
  const header = /^(\S.*?)(?:\t+| +)(\d{1,2}:\d{2}(?::\d{2})?)$/;
  const segments: ParsedSegment[] = [];
  let current: ParsedSegment | null = null;
  let tabs = 0;
  // Where the layout says transcription started, the turns follow; the title above it may end in a time too.
  const startedAt = paragraphs.findIndex((p) => / started transcription$/.test(p.trim()));
  for (const [i, raw] of paragraphs.entries()) {
    if (i <= startedAt) continue;
    const line = raw.replace(/\n/g, ' ');
    const previousBlank = i === 0 || paragraphs[i - 1].trim() === '';
    const m = previousBlank ? header.exec(line.trim()) : null;
    if (m && /\p{L}/u.test(m[1])) {
      if (line.includes('\t')) tabs++;
      current = { speakerLabel: tidy(m[1]), startMs: clockMs(m[2]), endMs: null, text: '' };
      segments.push(current);
      continue;
    }
    if (!line.trim()) {
      current = null;
      continue;
    }
    if (current) current.text = tidy(`${current.text} ${line}`);
  }
  const spoken = segments.filter((s) => s.text);
  // Without a tab, the layout needs a title line saying transcription started, so a document that only looks like it isn't taken.
  if (!spoken.length || (!tabs && !paragraphs.some((p) => / (started|stopped) transcription$/.test(p.trim())))) return null;
  return spoken;
}

/**
 * Teams `.docx`, older layout: one paragraph per cue, its lines being the
 * timing `0:0:3.100 --> 0:0:6.24`, the name, and the words. The milliseconds
 * aren't padded (`clockMs`).
 */
export function readTeamsOlderDocx(paragraphs: readonly string[]): ParsedSegment[] | null {
  const timing = /^(\d+:\d+:\d+(?:\.\d+)?)\s*-->\s*(\d+:\d+:\d+(?:\.\d+)?)$/;
  const segments: ParsedSegment[] = [];
  for (const p of paragraphs) {
    const lines = p.split('\n').map((l) => l.trim());
    const m = timing.exec(lines[0] ?? '');
    if (!m) continue;
    const startMs = clockMs(m[1]);
    const endMs = clockMs(m[2]);
    const rest = lines.slice(1).filter(Boolean);
    const named = rest.length >= 2;
    const text = tidy((named ? rest.slice(1) : rest).join(' '));
    if (!text || startMs === null) continue;
    segments.push({
      speakerLabel: named ? tidy(rest[0]) : null,
      startMs,
      endMs: endMs === null ? null : Math.max(endMs, startMs),
      text,
    });
  }
  return segments.length ? segments : null;
}

/** A Google Meet section heading for the transcript: "Transcript", or Gemini's "📖 Transcript". */
const MEET_HEADING = /^(?:\p{Extended_Pictographic}️?\s*)?Transcript$/u;
const MEET_TIME = /^\d{2}:\d{2}:\d{2}$/;

export interface MeetRead {
  segments: ParsedSegment[];
  /** Whether the document had Gemini's AI-written notes, which are never imported. */
  geminiNotes: boolean;
}

/**
 * Google Meet, from a Word document or plain text: after the "Transcript"
 * heading, `Name: words` paragraphs with a time line about every five
 * minutes, up to "Meeting ended after …" ("Transcription ended after …" in Gemini's). A time line applies only to the
 * first segment after it (decision 3). In "Notes by Gemini", only the
 * transcript tab is read: Gemini's notes are the AI's words, not anyone's.
 */
export function readMeet(lines: readonly string[]): MeetRead | null {
  const trimmed = lines.map((l) => tidy(l.replace(/\n/g, ' ')));
  const heading = trimmed.findIndex((l) => MEET_HEADING.test(l));
  if (heading < 0) return null;
  const meetLike =
    trimmed.some((l) => /\s-\sTranscript$/.test(l)) ||
    trimmed.includes('Attendees') ||
    trimmed.some((l) => /^(Meeting|Transcription) ended after \d/.test(l));
  if (!meetLike) return null;
  const geminiNotes = trimmed.slice(0, heading).some((l) => /^(?:\p{Extended_Pictographic}️?\s*)?Notes$/u.test(l));

  const segments: ParsedSegment[] = [];
  let time: number | null = null;
  let started = false;
  for (const line of trimmed.slice(heading + 1)) {
    if (!line) continue;
    if (/^(Meeting|Transcription) ended after \d/.test(line)) break;
    if (MEET_TIME.test(line)) {
      time = clockMs(line);
      started = true;
      continue;
    }
    const named = splitSpeaker(line);
    if (!named && !started) continue; // The date and title lines before the first words.
    started = true;
    segments.push({ speakerLabel: named?.speaker ?? null, startMs: time, endMs: null, text: tidy(named?.text ?? line) });
    time = null;
  }
  const spoken = segments.filter((s) => s.text);
  return spoken.length ? { segments: spoken, geminiNotes } : null;
}

export interface ZoomTxtRead {
  segments: ParsedSegment[];
  /**
   * What the times of day were taken from (the reviewer's answer to the WP0
   * check-in): the session's start when the first one is 0 to 24 hours after
   * it, read in the session's time zone; otherwise the file's first time.
   */
  timesFrom: 'session-start' | 'first-time';
  /** The first time of day in the file, as written ("10:00:03"). */
  firstTime: string;
}

/**
 * Zoom's saved transcript: `[Name] 10:00:03`, the words, a blank line. The
 * times are times of day on the clock of the computer that saved it, read as
 * the session's time zone (decision 18).
 */
export function readZoomTxt(lines: readonly string[], session: { startsAt: string; timeZone: string }): ZoomTxtRead | null {
  const header = /^\[(.+?)\]\s+(\d{1,2}:\d{2}:\d{2})$/;
  const turns: { speaker: string; time: string; text: string }[] = [];
  let current: (typeof turns)[number] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = header.exec(line);
    if (m) {
      current = { speaker: tidy(m[1]), time: m[2], text: '' };
      turns.push(current);
    } else if (!line) current = null;
    else if (current) current.text = tidy(`${current.text} ${line}`);
  }
  const spoken = turns.filter((t) => t.text);
  if (!spoken.length) return null;

  // Seconds since midnight; times run on past midnight when one is earlier than the one before.
  const seconds = (t: string) => clockMs(t)! / 1000;
  const start = Date.parse(session.startsAt);
  const day = wallClock(start, session.timeZone);
  const [h, m, s] = spoken[0].time.split(':').map(Number);
  const at = (later: number) => {
    const date = new Date(Date.UTC(day.year, day.month - 1, day.day + later));
    const on = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    return fromWallClock({ ...on, hour: h, minute: m, second: s }, session.timeZone) - start;
  };
  // On the session's start date; a time more than 12 hours before the start is just after midnight, the next day
  // (a session starting at 23:30 whose first words are at 00:10). An earlier time otherwise isn't the session's clock.
  let firstAt: number | undefined = at(0);
  if (firstAt < -DAY_MS / 2) firstAt = at(1);
  if (firstAt < 0 || firstAt >= DAY_MS) firstAt = undefined;
  const fromSession = firstAt !== undefined;
  let offset = firstAt ?? 0;
  let previous = seconds(spoken[0].time);
  const segments = spoken.map((t, i) => {
    if (i > 0) {
      let step = seconds(t.time) - previous;
      if (step < 0) step += 24 * 60 * 60;
      offset += step * 1000;
      previous = seconds(t.time);
    }
    return { speakerLabel: t.speaker, startMs: offset, endMs: null, text: t.text };
  });
  return { segments, timesFrom: fromSession ? 'session-start' : 'first-time', firstTime: spoken[0].time };
}

/**
 * Text typed or pasted (MVP 4.2), or a plain-text file in no known layout:
 * one turn per line, `Name: words`, optionally after a time `[mm:ss]` or
 * `[h:mm:ss]`. A line without a name is kept, without a speaker. At least one
 * line must name its speaker, or the text isn't a transcript.
 */
export function readLines(lines: readonly string[]): ParsedSegment[] | null {
  const segments: ParsedSegment[] = [];
  for (const raw of lines) {
    let line = raw.trim();
    if (!line) continue;
    let startMs: number | null = null;
    const time = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*/.exec(line);
    if (time) {
      startMs = clockMs(time[1]);
      line = line.slice(time[0].length);
    }
    const named = splitSpeaker(line);
    const text = tidy(named?.text ?? line);
    if (text) segments.push({ speakerLabel: named?.speaker ?? null, startMs, endMs: null, text });
  }
  return segments.some((s) => s.speakerLabel !== null) ? segments : null;
}
