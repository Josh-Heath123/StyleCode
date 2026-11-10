import { describe, expect, it } from 'vitest';
import { exportEngagementMarkdown, exportFileName, md } from './exportMarkdown';
import { sampleWorkspace, T3 } from './model/fixtures';
import type { CompanyWorkspace } from './model/types';

/**
 * The sample record, with what the export has to cover: a finding the
 * consultant added from a note, a withdrawn session's consent, an
 * amendment that told the client about external AI, and a second
 * engagement whose content must not appear.
 */
function record(): CompanyWorkspace {
  const ws = sampleWorkspace();
  delete ws.findings.fd_risk; // A pending proposal isn't in the record.
  ws.findings.fd_note = {
    id: 'fd_note',
    engagementId: 'en_1',
    kind: 'open-question',
    statement: 'Do month-end conflicts lose stock changes?',
    status: 'unresolved',
    statusSet: { by: { kind: 'consultant', name: 'Sam Consultant' }, at: T3 },
    provenance: { kind: 'consultant' },
    evidence: [{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' }],
    origin: { kind: 'consultant', by: 'Sam Consultant', at: T3 },
    history: [],
    createdAt: T3,
    updatedAt: T3,
  };
  ws.consents.cr_1.amendments = [
    {
      id: 'am_1',
      kind: 'change',
      by: 'Sam Consultant',
      at: '2026-11-05T08:00:00.000Z',
      reason: 'The client agreed by email to Anthropic.',
      told: { processingExternal: true, externalProvider: 'Anthropic (api.anthropic.com)' },
      wordingVersion: 'draft-1',
      given: { aiExternal: true, externalProvider: 'Anthropic (api.anthropic.com)' },
    },
  ];
  ws.engagements.en_other = { ...ws.engagements.en_1, id: 'en_other', name: 'Secret other engagement' };
  ws.sessions.se_other = { ...ws.sessions.se_1, id: 'se_other', engagementId: 'en_other', title: 'Secret meeting' };
  return ws;
}

describe('the Markdown export (MVP 8)', () => {
  it('matches the expected file for a role-played record', async () => {
    await expect(exportEngagementMarkdown(record(), 'en_1')).toMatchFileSnapshot(
      './__snapshots__/harbour-bakery-online-ordering.md',
    );
  });

  it('is the same every time, whatever order the record was stored in', () => {
    const ws = record();
    const first = exportEngagementMarkdown(ws, 'en_1');
    const reversed = Object.fromEntries(
      Object.entries(ws).map(([k, v]) => [
        k,
        v && typeof v === 'object' && !Array.isArray(v) && k !== 'company' ? Object.fromEntries(Object.entries(v).reverse()) : v,
      ]),
    ) as unknown as CompanyWorkspace;
    expect(exportEngagementMarkdown(reversed, 'en_1')).toBe(first);
    expect(exportEngagementMarkdown(ws, 'en_1')).toBe(first);
  });

  it('contains the findings, links and consent records, and nothing from another engagement', () => {
    const out = exportEngagementMarkdown(record(), 'en_1');
    expect(out).toContain('#### F1. Orders peak in December');
    expect(out).toContain('**influences**');
    expect(out).toContain('What the client was told (wording draft-1; [x] = told):');
    expect(out).toContain('- [x] “The AI runs on my computer only; nothing is sent elsewhere.”');
    expect(out).toContain('Newly told (wording draft-1):');
    expect(out).toContain('may be sent to Anthropic (api.anthropic.com)');
    expect(out).not.toContain('Secret');
  });

  it('keeps text from the record from turning into Markdown', () => {
    expect(md('# Not a heading\n- not a list *or emphasis* [or a link](x)')).toBe(
      '\\# Not a heading  \n\\- not a list \\*or emphasis\\* \\[or a link\\](x)',
    );
    expect(exportFileName('Harbour Bakery', 'Online ordering')).toBe('harbour-bakery-online-ordering.md');
    expect(exportFileName('Café Ünïcode', '?!')).toBe('cafe-unicode.md');
  });
});

describe('the export, from the Phase 1 review', () => {
  it('keeps a heading on one line, and can’t be turned into a heading by an underline', () => {
    const ws = record();
    ws.findings.fd_peak.statement = 'Peak\n===';
    const out = exportEngagementMarkdown(ws, 'en_1');
    expect(out).toContain('#### F1. Peak ===');
    expect(md('Foo\n===')).toBe('Foo  \n\\===');
  });

  it('writes a placeholder, not "undefined", for values a damaged file can’t give', () => {
    const ws = record();
    (ws.engagements.en_1 as unknown as { status: unknown }).status = { state: 'ended' };
    (ws.sessions.se_1 as unknown as { title: unknown }).title = 42;
    const out = exportEngagementMarkdown(ws, 'en_1');
    expect(out).toContain('- **Status:** ended on (unreadable)');
    expect(out).toContain('### (unreadable)');
    expect(out).not.toContain('undefined');
  });

  it('gives how long audio is kept only when audio recording was agreed, as the form does', () => {
    const ws = record();
    expect(exportEngagementMarkdown(ws, 'en_1')).not.toContain('**Retention:**');
    ws.consents.cr_1.amendments.push({
      id: 'am_2',
      kind: 'change',
      by: 'Sam Consultant',
      at: '2026-11-06T08:00:00.000Z',
      reason: 'The client agreed to recording.',
      given: { audioRecording: true },
    });
    expect(exportEngagementMarkdown(ws, 'en_1')).toContain('- **Retention:** audio kept until the engagement ends');
    const given = record();
    given.consents.cr_1.given.audioRecording = true;
    expect(exportEngagementMarkdown(given, 'en_1')).toContain('- **Retention:**');
  });
});
