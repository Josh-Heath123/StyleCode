import { describe, expect, it } from 'vitest';
import { paragraphsOf } from './docx.ts';
import { readZoomTxt } from './layouts.ts';
import { readPastedTranscript, readTranscriptFile } from './read.ts';
import { clockMs, decodeText, splitSpeaker } from './text.ts';
import { readVtt } from './vtt.ts';
import { readZipEntry, ZipError } from './zip.ts';
import { fromWallClock, wallClock } from './zone.ts';

/** The edge cases `docs/phase-2/samples/README.md` lists, and refusals (Phase 2 brief, WP2). */

const context = { startsAt: '2026-11-05T08:00:00.000Z', timeZone: 'Africa/Johannesburg' };
const utf8 = (text: string) => new TextEncoder().encode(text);

function utf16(text: string, bigEndian = false): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out.set(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = bigEndian ? code >> 8 : code & 0xff;
    out[3 + i * 2] = bigEndian ? code & 0xff : code >> 8;
  }
  return out;
}

/** A zip archive of the given entries, deflated or stored (no checksums: the reader doesn't check them). */
async function zip(entries: Record<string, string>, deflate = true): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const raw = utf8(content);
    const data = deflate
      ? new Uint8Array(
          await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
        )
      : raw;
    const nameBytes = utf8(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const dir = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, deflate ? 8 : 0, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, raw.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    parts.push(local, data);
    central.push(dir);
    offset += local.length + data.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A Word document whose paragraphs are given as inner WordprocessingML. */
const docx = (paragraphs: string[], deflate = true) =>
  zip(
    {
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${paragraphs.map((p) => (p ? `<w:p><w:r>${p}</w:r></w:p>` : '<w:p/>')).join('')}</w:body></w:document>`,
    },
    deflate,
  );
const t = (text: string) => `<w:t xml:space="preserve">${text}</w:t>`;

async function refusal(name: string, bytes: Uint8Array): Promise<string> {
  const result = await readTranscriptFile(name, bytes, context);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error;
}

describe('decoding', () => {
  it('reads UTF-8 with or without a byte-order mark, and UTF-16 with one, with either line ending', () => {
    const text = 'Thandi Mokoena: Ja, ons is reg.\r\nPieter van Wyk: Dankie – “goed”.\n';
    const want = 'Thandi Mokoena: Ja, ons is reg.\nPieter van Wyk: Dankie – “goed”.\n';
    expect(decodeText(utf8(text))).toBe(want);
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]))).toBe(want);
    expect(decodeText(utf16(text))).toBe(want);
    expect(decodeText(utf16(text, true))).toBe(want);
  });

  it('reads clock times, with the older Teams layout’s unpadded milliseconds', () => {
    expect(clockMs('00:00:03.100')).toBe(3100);
    expect(clockMs('0:0:6.24')).toBe(6024);
    expect(clockMs('0:0:38.0')).toBe(38000);
    expect(clockMs('1:02:03')).toBe(3723000);
    expect(clockMs('4:05')).toBe(245000);
    expect(clockMs('0:61')).toBeNull();
    expect(clockMs('soon')).toBeNull();
  });

  it('finds a speaker’s name at the start of a line, but not a sentence', () => {
    expect(splitSpeaker('Thandi Mokoena: Sure.')).toEqual({ speaker: 'Thandi Mokoena', text: 'Sure.' });
    expect(splitSpeaker("Sean O'Brien: Time: 10:00 sharp.")).toEqual({ speaker: "Sean O'Brien", text: 'Time: 10:00 sharp.' });
    expect(splitSpeaker('Well. Then: we go')).toBeNull();
    expect(splitSpeaker('(Lerato joined late; her camera was off.)')).toBeNull();
    expect(splitSpeaker('10:30: the meeting')).toBeNull();
  });
});

describe('WebVTT', () => {
  it('reads voice spans with classes and character references, and removes inline tags', () => {
    const vtt = readVtt(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n<v.loud Sean O&#39;Brien>We <i>never</i> lose <c.yellow>stock</c> &amp; orders.</v>\n',
    );
    expect(vtt).toEqual({
      layout: 'teams-graph',
      segments: [{ speakerLabel: "Sean O'Brien", startMs: 1000, endMs: 2500, text: 'We never lose stock & orders.' }],
    });
  });

  it('joins Teams parts by utterance, in part order, where the first part was', () => {
    const id = '7c1e4b2a-93d5-4f0e-8a61-2b5d9c0e7f14';
    const vtt = readVtt(
      [
        'WEBVTT',
        '',
        `${id}/5-1`,
        '00:00:04.000 --> 00:00:06.000',
        '<v Ana>second part.</v>',
        '',
        `${id}/6-0`,
        '00:00:05.000 --> 00:00:05.500',
        '<v Ben>Mm.</v>',
        '',
        `${id}/5-0`,
        '00:00:02.000 --> 00:00:04.000',
        '<v Ana>First part,</v>',
        '',
      ].join('\r\n'),
    );
    expect(vtt?.layout).toBe('teams');
    expect(vtt?.segments).toEqual([
      { speakerLabel: 'Ana', startMs: 2000, endMs: 6000, text: 'First part, second part.' },
      { speakerLabel: 'Ben', startMs: 5000, endMs: 5500, text: 'Mm.' },
    ]);
  });

  it('keeps utterances from separate runs of the transcription apart, though their numbers repeat (review of Slice A)', () => {
    const run = (uuid: string, start: string, end: string, words: string) => [
      `${uuid}/5-0`,
      `${start} --> ${end}`,
      `<v Thandi>${words}</v>`,
      '',
    ];
    const vtt = readVtt(
      [
        'WEBVTT',
        '',
        ...run('aaaaaaaa-93d5-4f0e-8a61-2b5d9c0e7f14', '00:00:01.000', '00:00:03.000', 'First run words.'),
        ...run('bbbbbbbb-93d5-4f0e-8a61-2b5d9c0e7f14', '00:30:00.000', '00:30:03.000', 'Second run, much later.'),
      ].join('\n'),
    );
    expect(vtt?.segments.map((s) => [s.startMs, s.text])).toEqual([
      [1000, 'First run words.'],
      [1800000, 'Second run, much later.'],
    ]);
  });

  it('reads the Graph layout, where a timing line and its words are separate blocks', () => {
    const vtt = readVtt(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n\n<v Ana>Hello there.</v>\n\n00:00:03.000 --> 00:00:04.000\n\n<v Ben>Hi.</v>\n',
    );
    expect(vtt?.segments.map((s) => [s.speakerLabel, s.startMs, s.text])).toEqual([
      ['Ana', 1000, 'Hello there.'],
      ['Ben', 3000, 'Hi.'],
    ]);
  });

  it('reads Zoom’s numbered cues with "Name:" and leaves NOTE blocks out', () => {
    const vtt = readVtt(
      'WEBVTT\n\nNOTE made up\n\n1\n00:00:01.000 --> 00:00:02.000\nAna: Hello.\n\n2\n00:00:02.000 --> 00:00:03.000\nAna: Again.\n',
    );
    expect(vtt?.layout).toBe('zoom');
    expect(vtt?.segments.map((s) => s.text)).toEqual(['Hello.', 'Again.']);
  });
});

describe('Word documents', () => {
  it('reads paragraphs with tabs, line breaks and character references, and ignores tab stops', () => {
    expect(
      paragraphsOf(
        '<w:document><w:body><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Ana</w:t><w:tab/><w:t>0:03</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>A &amp; B</w:t><w:br/><w:t xml:space="preserve"> C</w:t></w:r></w:p></w:body></w:document>',
      ),
    ).toEqual(['Ana\t0:03', '', 'A & B\n C']);
  });

  it('reads a zip whose entries are stored rather than deflated', async () => {
    const archive = await zip({ 'a.txt': 'stored' }, false);
    expect(new TextDecoder().decode((await readZipEntry(archive, 'a.txt'))!)).toBe('stored');
    expect(await readZipEntry(archive, 'b.txt')).toBeNull();
  });

  it('refuses an entry that unpacks to more than the limit, as a zip bomb would (review of Slice A)', async () => {
    const archive = await zip({ 'a.txt': '0'.repeat(100_000) });
    expect((await readZipEntry(archive, 'a.txt', 100_000))?.length).toBe(100_000);
    await expect(readZipEntry(archive, 'a.txt', 99_999)).rejects.toThrow(ZipError);
  });

  it('reads the current Teams layout with spaces instead of the tab, and times after the first hour', async () => {
    const result = await readTranscriptFile(
      'meeting.docx',
      await docx([
        t('Weekly sync 10:00'),
        t('Ana Silva started transcription'),
        '',
        t('Ana Silva 0:03'),
        t('Shall we start?'),
        '',
        t('Ben Mokoena 1:02:03'),
        t('Call me at 10:30 about it.'),
        '',
      ]),
      context,
    );
    expect(result.ok && result.value.segments).toEqual([
      { speakerLabel: 'Ana Silva', startMs: 3000, endMs: null, text: 'Shall we start?' },
      { speakerLabel: 'Ben Mokoena', startMs: 3723000, endMs: null, text: 'Call me at 10:30 about it.' },
    ]);
  });
});

describe('Zoom’s times of day (the reviewer’s answer to the WP0 check-in)', () => {
  const lines = (times: string[]) => times.flatMap((time, i) => [`[Ana] ${time}`, `Words ${i}.`, '']);

  it('measures from the first time when it isn’t 0 to 24 hours after the start, as from a computer in another zone', () => {
    const read = readZoomTxt(lines(['08:00:03', '08:00:20']), context)!;
    expect(read.timesFrom).toBe('first-time');
    expect(read.segments.map((s) => s.startMs)).toEqual([0, 17000]);
  });

  it('runs on past midnight', () => {
    const late = { startsAt: '2026-11-05T21:50:00.000Z', timeZone: 'Africa/Johannesburg' }; // 23:50 there.
    const read = readZoomTxt(lines(['23:59:50', '00:00:10']), late)!;
    expect(read.timesFrom).toBe('session-start');
    expect(read.segments.map((s) => s.startMs)).toEqual([590000, 610000]);
  });

  it('measures from the start of a session that runs past midnight, the first words after it (review of Slice A)', () => {
    const late = { startsAt: '2026-11-05T21:30:00.000Z', timeZone: 'Africa/Johannesburg' }; // 23:30 there.
    const read = readZoomTxt(lines(['00:10:05', '00:10:30']), late)!;
    expect(read.timesFrom).toBe('session-start');
    expect(read.segments.map((s) => s.startMs)).toEqual([2405000, 2430000]);
  });

  it('reads a time the clock shows twice as the earlier, and one it skips as after the change (review of Slice A)', () => {
    // London's clocks go back at 02:00 BST on 25 October 2026, and forward at 01:00 GMT on 29 March 2026.
    const at = (month: number, day: number, hour: number, minute: number) =>
      fromWallClock({ year: 2026, month, day, hour, minute, second: 0 }, 'Europe/London');
    expect(at(10, 25, 1, 30)).toBe(Date.parse('2026-10-25T00:30:00Z'));
    expect(at(3, 29, 1, 30)).toBe(Date.parse('2026-03-29T01:30:00Z'));
    expect(fromWallClock({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, 'America/New_York')).toBe(
      Date.parse('2026-11-01T05:30:00Z'),
    );
  });

  it('uses the session’s zone, summer time included', () => {
    const london = { startsAt: '2026-07-01T09:00:00.000Z', timeZone: 'Europe/London' }; // 10:00 BST.
    expect(readZoomTxt(lines(['10:01:00']), london)!.segments[0].startMs).toBe(60000);
    expect(wallClock(Date.parse('2026-07-01T09:00:00Z'), 'Europe/London')).toMatchObject({ hour: 10, minute: 0 });
    expect(fromWallClock({ year: 2026, month: 1, day: 1, hour: 10, minute: 0, second: 0 }, 'Europe/London')).toBe(
      Date.parse('2026-01-01T10:00:00Z'),
    );
  });
});

describe('refusals name the problem, and read nothing', () => {
  it('refuses an empty file, an unknown kind of file, and one too large', async () => {
    expect(await refusal('notes.vtt', new Uint8Array())).toBe('The file is empty.');
    expect(await refusal('notes.txt', utf8('  \n '))).toBe('The file is empty.');
    expect(await refusal('slides.pdf', utf8('x'))).toMatch(/isn’t a transcript StyleCode can read.*Teams/);
  });

  it('refuses a .vtt without the WEBVTT line, or without words', async () => {
    expect(await refusal('a.vtt', utf8('1\n00:00:01.000 --> 00:00:02.000\nHi\n'))).toMatch(/doesn’t start with "WEBVTT"/);
    expect(await refusal('a.vtt', utf8('WEBVTT\n\nNOTE nothing here\n'))).toMatch(/no captions with words/);
  });

  it('refuses a Word document that isn’t a transcript, and a file that isn’t a Word document', async () => {
    expect(await refusal('letter.docx', await docx([t('Dear Thandi,'), t('Please find attached the quote.')]))).toMatch(
      /isn’t a meeting transcript/,
    );
    expect(await refusal('fake.docx', utf8('not a zip at all'))).toMatch(/isn’t a Word document/);
    expect(await refusal('empty.docx', await zip({ 'other.xml': '<x/>' }))).toMatch(/isn’t a Word document/);
  });

  it('refuses text with no speakers, and an empty paste', async () => {
    expect(await refusal('list.txt', utf8('Milk\nBread\nEggs\n'))).toMatch(/no line starts with a speaker’s name/);
    expect(readPastedTranscript('   ', context)).toMatchObject({ ok: false, error: 'Paste the transcript first.' });
    expect(readPastedTranscript('Milk\nBread', context)).toMatchObject({
      ok: false,
      error: /Start each line with the speaker’s name/,
    });
  });
});
