import { describe, expect, it } from 'vitest';
import { consentRecord, sampleWorkspace, T0, T1, T2, T3 } from './fixtures';
import type { CompanyWorkspace } from './types';
import { quoteAppearsIn } from './util';
import { sharedIds, validateWorkspace } from './validate';
import { createWorkspace, isCompanyNameFree, parseWorkspace } from './workspace';

const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);

describe('a valid workspace', () => {
  it('has no problems', () => {
    expect(validateWorkspace(sampleWorkspace())).toEqual([]);
  });

  it('round-trips through JSON', () => {
    const ws = sampleWorkspace();
    const parsed = parseWorkspace(JSON.parse(JSON.stringify(ws)));
    expect(parsed).toEqual({ ok: true, workspace: ws });
  });

  it('starts empty and valid for a new company', () => {
    const ws = createWorkspace({ name: '  Harbour Bakery ' }, T0);
    expect(ws.company.name).toBe('Harbour Bakery');
    expect(ws.company.id).toMatch(/^co_/);
    expect(validateWorkspace(ws)).toEqual([]);
  });
});

describe('loading', () => {
  it('refuses data that is not a workspace, or from a newer version', () => {
    expect(parseWorkspace(null).ok).toBe(false);
    expect(parseWorkspace({ format: 'stylecode', version: 1 }).ok).toBe(false);
    const newer = parseWorkspace({ ...sampleWorkspace(), version: 2 });
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.error).toMatch(/newer version/);
  });

  it('refuses missing maps and entries that are not objects', () => {
    const { notes: _notes, ...withoutNotes } = sampleWorkspace();
    expect(parseWorkspace(withoutNotes).ok).toBe(false);
    expect(parseWorkspace({ ...sampleWorkspace(), notes: { no_1: null } }).ok).toBe(false);
  });

  it('reports problems instead of repairing them', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_peak.evidence[0] = { kind: 'segment', segmentId: 'sg_1', quote: 'ten times as many orders' };
    const parsed = parseWorkspace(ws);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problems.map((p) => p.code)).toEqual(['evidence.invented', 'finding.saidNeedsSegment']);
  });

  it('never resolves ids to inherited properties', () => {
    const ws = sampleWorkspace();
    ws.sessions.se_1.engagementId = 'constructor';
    expect(codes(ws)).toContain('ref.missing');
  });
});

describe('rule: a finding said in a session cites a segment from its engagement', () => {
  it('needs at least one transcript segment', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_peak.evidence = [{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts' }];
    expect(codes(ws)).toEqual(['finding.saidNeedsSegment']);
  });

  it('refuses segments from another engagement', () => {
    const ws = sampleWorkspace();
    ws.engagements.en_2 = { ...ws.engagements.en_1, id: 'en_2', name: 'Delivery' };
    ws.findings.fd_peak.engagementId = 'en_2';
    ws.relations = {};
    expect(codes(ws)).toEqual(expect.arrayContaining(['evidence.engagement', 'finding.saidNeedsSegment']));
  });

  it('refuses segments that do not exist', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_peak.evidence = [{ kind: 'segment', segmentId: 'sg_9', quote: 'December' }];
    expect(codes(ws)).toEqual(expect.arrayContaining(['evidence.missing', 'finding.saidNeedsSegment']));
  });

  it('counts a quote that is not in the segment as invented evidence', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_stock.evidence[0].quote = 'we keep stock in a database';
    expect(codes(ws)).toEqual(expect.arrayContaining(['evidence.invented']));
  });

  it('allows a consultant finding without evidence', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_peak.provenance = { kind: 'consultant' };
    ws.findings.fd_peak.evidence = [];
    expect(codes(ws)).toEqual([]);
  });
});

describe('quotes', () => {
  it('ignore white space, case and the style of quotation marks', () => {
    expect(quoteAppearsIn('We don’t   open on\nSundays.', "we don't open on sundays")).toBe(true);
  });

  it('do not accept paraphrase or empty quotes', () => {
    expect(quoteAppearsIn('We do not open on Sundays.', "we don't open on Sundays")).toBe(false);
    expect(quoteAppearsIn('Anything', '  ')).toBe(false);
  });
});

describe('rule: only the consultant confirms a finding', () => {
  it('refuses a confirmed status set by the AI', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_risk.status = 'confirmed';
    expect(codes(ws)).toEqual(['finding.confirmedByAi']);
  });

  it('refuses an AI proposal accepted without who and when', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_stock.origin = {
      kind: 'ai',
      provider: 'ollama',
      model: 'qwen2.5:7b',
      at: T2,
      review: { state: 'accepted', by: '', at: T3 },
    };
    expect(codes(ws)).toContain('finding.review');
  });

  it('keeps the AI from supplying verified or calculated information', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_risk.provenance = { kind: 'calculated', engine: 'cost', engineVersion: '1' };
    expect(codes(ws)).toEqual(['finding.aiProvenance']);
  });

  it('keeps a pending proposal at the status the AI proposed', () => {
    const ws = sampleWorkspace();
    ws.findings.fd_risk.statusSet = { by: { kind: 'consultant', name: 'Sam Consultant' }, at: T3 };
    expect(codes(ws)).toEqual(['finding.statusSet']);
  });
});

describe("rule: one company's data never references another's", () => {
  it('refuses an engagement of another company', () => {
    const ws = sampleWorkspace();
    ws.engagements.en_1.companyId = 'co_other';
    expect(codes(ws)).toEqual(['ref.company']);
  });

  it('refuses references to anything outside the workspace', () => {
    const ws = sampleWorkspace();
    ws.files.fi_1 = {
      id: 'fi_1',
      owner: { kind: 'engagement', engagementId: 'en_elsewhere' },
      name: 'brief.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 10,
      addedBy: 'Sam',
      addedAt: T0,
    };
    ws.relations.re_2 = { id: 're_2', type: 'refines', fromId: 'fd_peak', toId: 'fd_elsewhere', createdBy: 'Sam', createdAt: T3 };
    expect(codes(ws)).toEqual(['ref.missing', 'ref.missing']);
  });

  it('finds ids shared between two companies', () => {
    const a = sampleWorkspace();
    const b = createWorkspace({ name: 'Other Ltd' }, T0);
    expect(sharedIds([a, b])).toEqual([]);
    b.notes.no_1 = { ...a.notes.no_1 };
    expect(sharedIds([a, b])).toEqual(['no_1']);
  });
});

describe('relations', () => {
  it('stay within one engagement, between findings in the record', () => {
    const ws = sampleWorkspace();
    ws.relations.re_2 = { id: 're_2', type: 'depends-on', fromId: 'fd_peak', toId: 'fd_risk', createdBy: 'Sam', createdAt: T3 };
    ws.relations.re_3 = { ...ws.relations.re_1, id: 're_3' };
    ws.relations.re_4 = { ...ws.relations.re_1, id: 're_4', toId: 'fd_peak' };
    expect(codes(ws)).toEqual(['relation.record', 'relation.duplicate', 'relation.self']);
  });
});

describe('consent in the workspace', () => {
  it('refuses a transcript without a confirmed consent record', () => {
    const ws = sampleWorkspace();
    ws.consents = {};
    expect(codes(ws)).toEqual(['consent.required']);
    ws.consents.cr_1 = consentRecord({ confirmed: null, lockedAt: null });
    expect(codes(ws)).toEqual(['consent.required']);
  });

  it('refuses a transcript the client did not agree to', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.given.transcription = false;
    expect(codes(ws)).toEqual(['consent.required']);
  });

  it('accepts a transcript imported before a later withdrawal', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.amendments = [
      { id: 'am_1', kind: 'withdrawal', by: 'Sam Consultant', at: T3, reason: 'Client asked by email.' },
    ];
    expect(codes(ws)).toEqual([]);
  });

  it('requires the record to be locked once a transcript is imported', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.lockedAt = null;
    expect(codes(ws)).toEqual(['consent.lock']);
  });

  it('allows one consent record and one transcript per session', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_2 = consentRecord({ id: 'cr_2' });
    ws.transcripts.tr_2 = { ...ws.transcripts.tr_1, id: 'tr_2' };
    expect(codes(ws)).toEqual(['consent.duplicate', 'transcript.duplicate']);
  });

  it('checks the form: who was asked, the provider, the limits, a declined outcome', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1 = consentRecord({
      askedParticipantIds: ['pa_me'],
      given: { audioRecording: false, transcription: true, aiLocal: true, aiExternal: true, externalProvider: null },
    });
    expect(codes(ws)).toEqual(['consent.asked', 'consent.provider']);
    ws.consents.cr_1 = consentRecord({ outcome: { kind: 'limited', limits: ' ' } });
    expect(codes(ws)).toEqual(['consent.limits']);
    ws.transcripts = {};
    ws.segments = {};
    ws.findings = {};
    ws.relations = {};
    ws.consents.cr_1 = consentRecord({ outcome: { kind: 'declined' }, lockedAt: null });
    expect(codes(ws)).toEqual(['consent.declined']);
  });

  it('keeps amendments in date order, after the lock, with nothing after a withdrawal', () => {
    const ws = sampleWorkspace();
    ws.consents.cr_1.amendments = [
      { id: 'am_1', kind: 'withdrawal', by: 'Sam', at: T3, reason: 'Asked to stop.' },
      { id: 'am_2', kind: 'change', by: 'Sam', at: T1, reason: 'Typo.', given: { aiLocal: false } },
    ];
    expect(codes(ws)).toEqual(['consent.amendment', 'consent.amendment']);
  });
});

describe('transcripts', () => {
  it('keeps segment positions without gaps and times in order', () => {
    const ws = sampleWorkspace();
    ws.segments.sg_3.index = 5;
    ws.segments.sg_2.endMs = 1000;
    ws.segments.sg_1.confidence = 2;
    expect(codes(ws)).toEqual(['field.value', 'segment.time', 'segment.order']);
  });

  it('gives each speaker label to at most one participant', () => {
    const ws = sampleWorkspace();
    ws.participants.pa_me.speakerLabels = ['Sam', 'Alex Owner'];
    expect(codes(ws)).toEqual(['participant.label']);
  });
});

describe('company names', () => {
  it('must differ from other companies, ignoring case and spaces', () => {
    expect(isCompanyNameFree('harbour bakery ', ['Harbour Bakery'])).toBe(false);
    expect(isCompanyNameFree('Harbour Bakeries', ['Harbour Bakery'])).toBe(true);
    expect(isCompanyNameFree('   ', [])).toBe(false);
  });
});
