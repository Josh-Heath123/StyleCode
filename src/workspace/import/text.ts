/**
 * Text helpers shared by the transcript readers (Phase 2 brief, WP2;
 * `docs/phase-2/samples/README.md`, "What every importer has to allow for").
 * Pure: no DOM, so the readers run the same in the browser and in tests.
 */

/**
 * Decodes a file's bytes by its byte-order mark: UTF-8 with or without one,
 * or UTF-16 (little- or big-endian) with one. Line endings become `\n`.
 */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  else {
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    text = new TextDecoder('utf-8').decode(bom ? bytes.subarray(3) : bytes);
  }
  return normaliseLineEndings(text);
}

export function normaliseLineEndings(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes HTML and XML character references: `&amp;`, `&#39;`, `&#x2019;`. Unknown names stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

/** Spaces as people read them: runs of white space become one space, none at the ends. */
export function tidy(text: string): string {
  return text.replace(/[\s ]+/g, ' ').trim();
}

/**
 * Milliseconds from a clock reading: `h:mm:ss`, `mm:ss` or `m:ss`, with an
 * optional fraction of a second written as milliseconds. Teams' older Word
 * layout doesn't pad the milliseconds, so the fraction's digits are read as a
 * whole number of milliseconds (`6.24` is 6 s 24 ms); the WebVTT layouts
 * always give three digits, which reads the same either way.
 */
export function clockMs(text: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  const [, h, min, s, ms] = m;
  const minutes = Number(min);
  const seconds = Number(s);
  if (seconds > 59 || (h !== undefined && minutes > 59)) return null;
  return ((Number(h ?? 0) * 60 + minutes) * 60 + seconds) * 1000 + Number(ms ?? 0);
}

/**
 * A speaker's name at the start of a line, as "Name: words". The name is
 * short and reads like a name: no sentence punctuation, so "Note: words" or
 * "So what I said was: words" still count, but "Hello. Yes: words" doesn't.
 */
export function splitSpeaker(line: string): { speaker: string; text: string } | null {
  const m = /^([^\s:.,;!?()[\]][^:.,;!?()[\]]{0,59}?)\s*:\s+(.*)$/s.exec(line);
  if (!m) return null;
  const speaker = tidy(m[1]);
  if (!/\p{L}/u.test(speaker) || speaker.split(' ').length > 6) return null;
  return { speaker, text: m[2] };
}
