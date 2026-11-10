/**
 * WebVTT transcripts: Teams (from the meeting, and through Microsoft Graph)
 * and Zoom cloud recordings (`docs/phase-2/samples/README.md`).
 *
 * - Teams writes the speaker as a voice span, `<v Name>words</v>`, which may
 *   carry classes (`<v.loud Name>`) and character references.
 * - Zoom writes `Name: words`.
 * - Teams from the meeting gives each cue an id `<uuid>/<utterance>-<part>`;
 *   parts of one utterance are joined into one segment, placed where its
 *   first part was, even when another speaker's cue sits between them
 *   (Phase 2 brief, decision 3). Any other cue is one segment.
 * - Teams through Graph puts a cue's timing line and its text in separate
 *   blocks; the text belongs to the timing before it.
 */
import type { ParsedSegment } from '../model/transcripts.ts';
import { clockMs, decodeEntities, splitSpeaker, tidy } from './text.ts';

export type VttLayout = 'teams' | 'teams-graph' | 'zoom' | 'other';

export interface VttRead {
  layout: VttLayout;
  segments: ParsedSegment[];
}

interface Cue {
  id: string | null;
  startMs: number;
  endMs: number;
  lines: string[];
}

const TIMING = /^(\S+)\s+-->\s+(\S+)/;
const TEAMS_ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d+)-(\d+)$/i;

/** The cues of a WebVTT file, or null if it isn't one. Text is `\n`-separated (see `decodeText`). */
export function vttCues(text: string): Cue[] | null {
  const lines = text.split('\n');
  if (!/^WEBVTT(\s|$)/.test(lines[0] ?? '')) return null;
  const cues: Cue[] = [];
  let i = 1;
  let open: Cue | null = null; // A cue whose text may still follow in a later block (the Graph layout).
  while (i < lines.length) {
    // One block: lines up to a blank line.
    const block: string[] = [];
    while (i < lines.length && lines[i].trim() === '') i++;
    while (i < lines.length && lines[i].trim() !== '') block.push(lines[i++]);
    if (!block.length) break;
    const head = block[0].trim();
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(head)) continue;
    const timingAt = block.findIndex((l) => TIMING.test(l));
    if (timingAt < 0 || timingAt > 1) {
      // Text without a timing line: the text of the cue just before, as Graph writes it.
      if (open && !open.lines.length) open.lines.push(...block);
      continue;
    }
    const [, from, to] = TIMING.exec(block[timingAt])!;
    const startMs = clockMs(from);
    const endMs = clockMs(to);
    if (startMs === null || endMs === null) continue;
    open = { id: timingAt === 1 ? head : null, startMs, endMs: Math.max(endMs, startMs), lines: block.slice(timingAt + 1) };
    cues.push(open);
  }
  return cues;
}

/** A cue's speaker and words: from a voice span, else a `Name:` prefix. Other tags are removed. */
function cueText(lines: string[]): { speaker: string | null; text: string; voice: boolean } {
  const raw = lines.join('\n');
  const voice = /<v(?:\.[^\s>]*)?\s+([^>]+)>/.exec(raw);
  const words = tidy(decodeEntities(raw.replace(/<[^>]*>/g, ' ')));
  if (voice) return { speaker: tidy(decodeEntities(voice[1])), text: words, voice: true };
  const named = splitSpeaker(words);
  return named ? { speaker: named.speaker, text: tidy(named.text), voice: false } : { speaker: null, text: words, voice: false };
}

/** Reads a WebVTT transcript; null if the text isn't WebVTT. */
export function readVtt(text: string): VttRead | null {
  const cues = vttCues(text);
  if (!cues) return null;
  const read = cues.map((c) => ({ cue: c, ...cueText(c.lines) })).filter((c) => c.text);
  const teamsIds = read.length > 0 && read.every((c) => c.cue.id !== null && TEAMS_ID.test(c.cue.id));
  const voices = read.some((c) => c.voice);
  const layout: VttLayout = teamsIds
    ? 'teams'
    : voices
      ? 'teams-graph'
      : read.length > 0 && read.every((c) => c.speaker !== null)
        ? 'zoom'
        : 'other';

  const segments: ParsedSegment[] = [];
  // Parts of one Teams utterance, joined in part order once all are read.
  const utterances = new Map<string, { segment: ParsedSegment; parts: { n: number; text: string }[] }>();
  for (const c of read) {
    const id = teamsIds ? TEAMS_ID.exec(c.cue.id!)! : null;
    const key = id ? `${id[1].toLowerCase()}\u0000${c.speaker ?? ''}` : null;
    const joined = key !== null ? utterances.get(key) : undefined;
    if (joined) {
      joined.parts.push({ n: Number(id![2]), text: c.text });
      joined.segment.startMs = Math.min(joined.segment.startMs ?? c.cue.startMs, c.cue.startMs);
      joined.segment.endMs = Math.max(joined.segment.endMs ?? 0, c.cue.endMs);
      continue;
    }
    const segment: ParsedSegment = { speakerLabel: c.speaker, startMs: c.cue.startMs, endMs: c.cue.endMs, text: c.text };
    segments.push(segment);
    if (key !== null) utterances.set(key, { segment, parts: [{ n: Number(id![2]), text: c.text }] });
  }
  for (const { segment, parts } of utterances.values())
    segment.text = parts
      .sort((a, b) => a.n - b.n)
      .map((p) => p.text)
      .join(' ');
  return { layout, segments };
}
