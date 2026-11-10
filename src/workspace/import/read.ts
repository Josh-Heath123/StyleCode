/**
 * Reading a transcript file or pasted text (MVP 4.1 and 4.2; Phase 2 brief,
 * decisions 2 to 5): the layout is detected from the content, and the result
 * is segments ready for `importTranscript`, or a refusal that says what was
 * expected. Nothing here changes the workspace.
 */
import type { TranscriptFormat, TranscriptPlatform } from '../model/types.ts';
import type { ParsedSegment } from '../model/transcripts.ts';
import { fail, ok, type Result } from '../model/util.ts';
import { docxParagraphs } from './docx.ts';
import { readLines, readMeet, readTeamsDocx, readTeamsOlderDocx, readZoomTxt } from './layouts.ts';
import { decodeText, normaliseLineEndings } from './text.ts';
import { readVtt, type VttLayout } from './vtt.ts';

/** Every layout StyleCode reads (`docs/phase-2/samples/README.md`). */
export type TranscriptLayout =
  | 'teams-vtt'
  | 'teams-graph-vtt'
  | 'teams-docx'
  | 'teams-docx-older'
  | 'zoom-vtt'
  | 'zoom-txt'
  | 'meet-docx'
  | 'meet-gemini-docx'
  | 'meet-txt'
  | 'webvtt'
  | 'lines';

/** How the preview names a layout. */
export const LAYOUT_LABELS: Record<TranscriptLayout, string> = {
  'teams-vtt': 'Microsoft Teams transcript (.vtt)',
  'teams-graph-vtt': 'Microsoft Teams transcript, exported through Microsoft Graph (.vtt)',
  'teams-docx': 'Microsoft Teams transcript (.docx)',
  'teams-docx-older': 'Microsoft Teams transcript, older layout (.docx)',
  'zoom-vtt': 'Zoom recording transcript (.vtt)',
  'zoom-txt': 'Zoom saved transcript (.txt)',
  'meet-docx': 'Google Meet transcript (.docx)',
  'meet-gemini-docx': 'Google Meet "Notes by Gemini" (.docx): the transcript only',
  'meet-txt': 'Google Meet transcript (.txt)',
  webvtt: 'WebVTT captions (.vtt)',
  lines: 'Lines starting with the speaker’s name',
};

export const PLATFORM_LABELS: Record<TranscriptPlatform, string> = {
  teams: 'Microsoft Teams',
  zoom: 'Zoom',
  meet: 'Google Meet',
  other: 'Other',
};

const PLATFORM: Record<TranscriptLayout, TranscriptPlatform> = {
  'teams-vtt': 'teams',
  'teams-graph-vtt': 'teams',
  'teams-docx': 'teams',
  'teams-docx-older': 'teams',
  'zoom-vtt': 'zoom',
  'zoom-txt': 'zoom',
  'meet-docx': 'meet',
  'meet-gemini-docx': 'meet',
  'meet-txt': 'meet',
  webvtt: 'other',
  lines: 'other',
};

/** What a transcript was read as, for the preview, before anything is imported. */
export interface TranscriptRead {
  /** Null for pasted text. */
  format: TranscriptFormat | null;
  layout: TranscriptLayout;
  /** The platform detected; the consultant can correct it before importing. */
  platform: TranscriptPlatform;
  segments: ParsedSegment[];
  /** For Zoom's saved transcript: where its times of day were measured from (`readZoomTxt`). */
  times?: { from: 'session-start' | 'first-time'; firstTime: string };
}

/** The session the transcript is for: Zoom's times of day are read against its start, in its time zone. */
export interface ReadContext {
  startsAt: string;
  timeZone: string;
}

const EXPECTED =
  'StyleCode reads transcripts from Microsoft Teams (.vtt or .docx), Zoom (.vtt or .txt) and Google Meet (.docx or .txt).';

/** The format a file's name says it is in, or null for any other. */
export function formatOf(fileName: string): TranscriptFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  return ext === 'vtt' || ext === 'docx' || ext === 'txt' ? ext : null;
}

/** The largest transcript file read: a long meeting's transcript is well under 5 MB. */
export const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024;

/** Reads a transcript file. The file's name says its format; its content says its layout. */
export async function readTranscriptFile(
  fileName: string,
  bytes: Uint8Array,
  context: ReadContext,
): Promise<Result<TranscriptRead>> {
  const format = formatOf(fileName);
  if (!format) return fail(`This file isn’t a transcript StyleCode can read. ${EXPECTED}`);
  if (!bytes.length) return fail('The file is empty.');
  if (bytes.length > MAX_TRANSCRIPT_BYTES) return fail('The file is too large to be a meeting transcript.');
  const read = (layout: TranscriptLayout, segments: ParsedSegment[], extra: Partial<TranscriptRead> = {}) =>
    ok<TranscriptRead>({ format, layout, platform: PLATFORM[layout], segments, ...extra });

  if (format === 'docx') {
    const paragraphs = await docxParagraphs(bytes);
    if (!paragraphs) return fail('This isn’t a Word document StyleCode can read. Download the transcript again as .docx.');
    const meet = readMeet(paragraphs);
    if (meet) return read(meet.geminiNotes ? 'meet-gemini-docx' : 'meet-docx', meet.segments);
    const older = readTeamsOlderDocx(paragraphs);
    if (older) return read('teams-docx-older', older);
    const teams = readTeamsDocx(paragraphs);
    if (teams) return read('teams-docx', teams);
    return fail(
      'This Word document isn’t a meeting transcript. Expected a transcript downloaded from Microsoft Teams or Google Meet.',
    );
  }

  const text = decodeText(bytes);
  if (!text.trim()) return fail('The file is empty.');
  if (format === 'vtt') {
    const vtt = readVtt(text);
    if (!vtt) return fail('This .vtt file doesn’t start with "WEBVTT", so it isn’t a WebVTT transcript.');
    if (!vtt.segments.length)
      return fail('This .vtt file has no captions with words in them. Expected a transcript from Microsoft Teams or Zoom.');
    const layouts: Record<VttLayout, TranscriptLayout> = {
      teams: 'teams-vtt',
      'teams-graph': 'teams-graph-vtt',
      zoom: 'zoom-vtt',
      other: 'webvtt',
    };
    return read(layouts[vtt.layout], vtt.segments);
  }

  const lines = text.split('\n');
  const meet = readMeet(lines);
  if (meet) return read('meet-txt', meet.segments);
  const zoom = readZoomTxt(lines, context);
  if (zoom) return read('zoom-txt', zoom.segments, { times: { from: zoom.timesFrom, firstTime: zoom.firstTime } });
  const plain = readLines(lines);
  if (plain) return read('lines', plain);
  return fail(`This text file isn’t a meeting transcript: no line starts with a speaker’s name. ${EXPECTED}`);
}

/**
 * Reads text the consultant pasted (MVP 4.2): one turn per line, `Name:
 * words`. A Google Meet or Zoom transcript copied as text is read in its own
 * layout.
 */
export function readPastedTranscript(text: string, context: ReadContext): Result<TranscriptRead> {
  const lines = normaliseLineEndings(text).split('\n');
  if (!lines.some((l) => l.trim())) return fail('Paste the transcript first.');
  const meet = readMeet(lines);
  if (meet) return ok({ format: null, layout: 'meet-txt', platform: 'meet', segments: meet.segments });
  const zoom = readZoomTxt(lines, context);
  if (zoom)
    return ok({
      format: null,
      layout: 'zoom-txt',
      platform: 'zoom',
      segments: zoom.segments,
      times: { from: zoom.timesFrom, firstTime: zoom.firstTime },
    });
  const segments = readLines(lines);
  if (!segments) return fail('Start each line with the speaker’s name, as in "Thandi Mokoena: We run forty trucks."');
  return ok({ format: null, layout: 'lines', platform: 'other', segments });
}
