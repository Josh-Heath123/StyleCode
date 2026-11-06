import { describe, expect, it } from 'vitest';
import { sampleWorkspace, T1, T3 } from './fixtures';
import { addNote, editNote, findingsQuotingNote, notesOf, removeNote } from './notes';
import type { CompanyWorkspace, Finding } from './types';
import { validateWorkspace } from './validate';

const AT = '2026-11-04T12:00:00.000Z';
const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);
function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** The sample, with its pending AI proposal reviewed away, and a finding of the consultant's that quotes note no_1. */
function quoted(): CompanyWorkspace {
  const ws = sampleWorkspace();
  delete ws.findings.fd_risk;
  const finding: Finding = {
    id: 'fd_month',
    engagementId: 'en_1',
    kind: 'risk',
    statement: 'Month-end stock counts clash with the spreadsheet.',
    status: 'assumption',
    statusSet: { by: { kind: 'consultant', name: 'Sam Consultant' }, at: T3 },
    provenance: { kind: 'consultant' },
    evidence: [{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' }],
    origin: { kind: 'consultant', by: 'Sam Consultant', at: T3 },
    history: [],
    createdAt: T3,
    updatedAt: T3,
  };
  ws.findings.fd_month = finding;
  return ws;
}

describe('notes (MVP 5.1)', () => {
  it('adds a note at the time it was started, listed in time order, valid', () => {
    const { workspace, id } = value(
      addNote(sampleWorkspace(), 'se_1', '  Deliveries leave at six.  ', '2026-11-04T08:55:00.000Z'),
    );
    expect(workspace.notes[id]).toMatchObject({ text: 'Deliveries leave at six.', writtenAt: '2026-11-04T08:55:00.000Z' });
    expect(notesOf(workspace, 'se_1').map((n) => n.id)).toEqual([id, 'no_1']);
    expect(codes(workspace)).toEqual([]);
    expect(addNote(sampleWorkspace(), 'se_1', ' ', AT).ok).toBe(false);
  });

  it('works when consent was declined (C7)', () => {
    const ws = quoted();
    ws.transcripts = {};
    ws.segments = {};
    ws.findings = {};
    ws.relations = {};
    ws.consents.cr_1 = {
      ...ws.consents.cr_1,
      lockedAt: null,
      outcome: { kind: 'declined' },
      given: { ...ws.consents.cr_1.given, transcription: false, aiLocal: false },
    };
    const { workspace } = value(addNote(ws, 'se_1', 'Client prefers no recording.', AT));
    expect(codes(workspace)).toEqual([]);
  });

  it('keeps the time a note was written when it is edited, and records when it changed', () => {
    const ws = value(
      editNote(quoted(), 'no_1', 'Ask about spreadsheet conflicts at month end, and on public holidays.', 'Sam', AT),
    );
    expect(ws.notes.no_1).toMatchObject({ writtenAt: T1, updatedAt: AT });
    // The quote is still in the text, so the finding keeps it.
    expect(ws.findings.fd_month.evidence).toHaveLength(1);
    expect(codes(ws)).toEqual([]);
  });

  it('lists, then takes out, the quotes an edit or deletion would leave behind (decision 6), in the finding’s history', () => {
    const ws = quoted();
    expect(findingsQuotingNote(ws, 'no_1', 'Ask about the spreadsheet.').map((f) => f.id)).toEqual(['fd_month']);
    expect(findingsQuotingNote(ws, 'no_1', 'Ask about spreadsheet conflicts at month end today.')).toEqual([]);

    const edited = value(editNote(ws, 'no_1', 'Ask about the spreadsheet.', 'Sam', AT));
    expect(edited.findings.fd_month.evidence).toEqual([]);
    expect(edited.findings.fd_month.history).toMatchObject([{ field: 'evidence', by: 'Sam', at: AT, to: [] }]);
    expect(codes(edited)).toEqual([]);

    const removed = value(removeNote(ws, 'no_1', 'Sam', AT));
    expect(removed.notes.no_1).toBeUndefined();
    expect(removed.findings.fd_month.evidence).toEqual([]);
    expect(codes(removed)).toEqual([]);
  });

  it('turns an accepted AI finding’s quote of the note into deleted evidence everywhere, so its history still replays', () => {
    const ws = quoted();
    const accepted = ws.findings.fd_stock;
    if (accepted.origin.kind !== 'ai') throw new Error('expected an AI finding');
    const quote = { kind: 'note' as const, noteId: 'no_1', quote: 'spreadsheet conflicts at month end' };
    accepted.origin.proposed.evidence = [...accepted.origin.proposed.evidence, quote];
    accepted.evidence = [...accepted.evidence, quote];
    expect(codes(ws)).toEqual([]);
    const removed = value(removeNote(ws, 'no_1', 'Sam', AT));
    const deleted = { kind: 'deleted', sessionId: 'se_1', deletedAt: AT };
    const after = removed.findings.fd_stock;
    expect(after.evidence.at(-1)).toEqual(deleted);
    expect(after.origin.kind === 'ai' && after.origin.proposed.evidence.at(-1)).toEqual(deleted);
    expect(JSON.stringify(after)).not.toContain('month end');
    expect(codes(removed)).toEqual([]);
  });

  it('won’t change a note an AI proposal under review quotes: it is reviewed first', () => {
    const ws = sampleWorkspace();
    expect(removeNote(ws, 'no_1', 'Sam', AT)).toMatchObject({ ok: false, error: expect.stringContaining('Review it first') });
    expect(editNote(ws, 'no_1', 'Something else.', 'Sam', AT).ok).toBe(false);
  });

  it('refuses an empty edit, and records nothing when the text is the same', () => {
    const ws = quoted();
    expect(editNote(ws, 'no_1', '  ', 'Sam', AT).ok).toBe(false);
    expect(editNote(ws, 'no_1', 'Ask about spreadsheet conflicts at month end.', 'Sam', AT)).toEqual({ ok: true, value: ws });
  });
});
