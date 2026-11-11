/**
 * A small, valid, role-played workspace for tests. Every person and company
 * in it is invented.
 */
import type { CompanyWorkspace, ConsentRecord, Finding } from './types';

export const T0 = '2026-11-04T09:00:00.000Z';
export const T1 = '2026-11-04T09:05:00.000Z';
export const T2 = '2026-11-04T10:30:00.000Z';
export const T3 = '2026-11-04T11:00:00.000Z';

export function consentRecord(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: 'cr_1',
    sessionId: 'se_1',
    askedParticipantIds: ['pa_client'],
    askedBy: 'Sam Consultant',
    method: { kind: 'verbal-at-start' },
    wordingVersion: 'draft-1',
    told: {
      recorded: true,
      transcribed: true,
      aiExtraction: true,
      processingLocal: true,
      processingExternal: false,
      retention: true,
      canStopOrDelete: true,
      externalProvider: null,
    },
    given: { audioRecording: false, transcription: true, aiLocal: true, aiExternal: false, externalProvider: null },
    retention: { kind: 'until-engagement-ends' },
    outcome: { kind: 'given' },
    confirmed: { by: 'Sam Consultant', at: T0 },
    attachmentFileId: null,
    lockedAt: T2,
    amendments: [],
    createdAt: T0,
    updatedAt: T2,
    ...overrides,
  };
}

const consultantFinding: Finding = {
  id: 'fd_peak',
  engagementId: 'en_1',
  kind: 'scalability',
  statement: 'Orders peak in December, at about five times the usual volume.',
  status: 'confirmed',
  statusSet: { by: { kind: 'consultant', name: 'Sam Consultant' }, at: T3 },
  provenance: { kind: 'said-in-session' },
  evidence: [{ kind: 'segment', segmentId: 'sg_1', quote: 'about five times as many orders in December' }],
  origin: { kind: 'consultant', by: 'Sam Consultant', at: T3 },
  history: [],
  createdAt: T3,
  updatedAt: T3,
};

const acceptedAiFinding: Finding = {
  id: 'fd_stock',
  engagementId: 'en_1',
  kind: 'existing-system',
  statement: 'Stock is tracked in a spreadsheet that two people edit.',
  status: 'assumption',
  statusSet: { by: { kind: 'consultant', name: 'Sam Consultant' }, at: T3 },
  provenance: { kind: 'said-in-session' },
  evidence: [{ kind: 'segment', segmentId: 'sg_2', quote: 'we keep stock in a spreadsheet' }],
  origin: {
    kind: 'ai',
    provider: 'ollama',
    model: 'qwen2.5:7b',
    processing: { kind: 'local' },
    inputSessionIds: ['se_1'],
    at: T2,
    proposed: {
      kind: 'existing-system',
      statement: 'Stock is tracked in a spreadsheet that two people edit.',
      status: 'suggested',
      evidence: [{ kind: 'segment', segmentId: 'sg_2', quote: 'we keep stock in a spreadsheet' }],
    },
    review: { state: 'accepted', by: 'Sam Consultant', at: T3 },
  },
  // The consultant accepted it as an assumption rather than the AI's "suggested".
  history: [{ field: 'status', from: 'suggested', to: 'assumption', by: 'Sam Consultant', at: T3 }],
  createdAt: T2,
  updatedAt: T3,
};

const pendingAiFinding: Finding = {
  id: 'fd_risk',
  engagementId: 'en_1',
  kind: 'risk',
  statement: 'Two people editing one spreadsheet may lose stock changes.',
  status: 'suggested',
  statusSet: { by: { kind: 'ai', provider: 'ollama', model: 'qwen2.5:7b' }, at: T2 },
  provenance: { kind: 'ai-suggested' },
  evidence: [{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' }],
  origin: {
    kind: 'ai',
    provider: 'ollama',
    model: 'qwen2.5:7b',
    processing: { kind: 'local' },
    inputSessionIds: ['se_1'],
    at: T2,
    proposed: {
      kind: 'risk',
      statement: 'Two people editing one spreadsheet may lose stock changes.',
      status: 'suggested',
      evidence: [{ kind: 'note', noteId: 'no_1', quote: 'spreadsheet conflicts at month end' }],
    },
    review: { state: 'pending' },
  },
  history: [],
  createdAt: T2,
  updatedAt: T2,
};

/** A fresh copy each time, so tests can change it freely. */
export function sampleWorkspace(): CompanyWorkspace {
  return structuredClone({
    format: 'stylecode-workspace',
    version: 3,
    company: {
      id: 'co_bakery',
      name: 'Harbour Bakery',
      industry: 'Food retail',
      description: 'Three bakeries and an online shop for cakes to order.',
      existingSystems: 'Spreadsheet for stock; card terminals.',
      notes: '',
      createdAt: T0,
      updatedAt: T0,
    },
    knowledge: {},
    engagements: {
      en_1: {
        id: 'en_1',
        companyId: 'co_bakery',
        name: 'Online ordering',
        goal: 'Take cake orders online.',
        status: { state: 'active' },
        createdAt: T0,
        updatedAt: T0,
      },
    },
    designs: {
      de_1: { id: 'de_1', engagementId: 'en_1', name: 'Order page', documentId: 'doc_abc123', createdAt: T3 },
    },
    sessions: {
      se_1: {
        id: 'se_1',
        engagementId: 'en_1',
        title: 'Kick-off',
        startsAt: T0,
        timeZone: 'Africa/Johannesburg',
        audioFileIds: [],
        createdAt: T0,
        updatedAt: T0,
      },
    },
    participants: {
      pa_client: {
        id: 'pa_client',
        sessionId: 'se_1',
        name: 'Alex Owner',
        role: 'Owner',
        organisation: 'Harbour Bakery',
        side: 'client',
        speakerLabels: ['Alex Owner'],
      },
      pa_me: {
        id: 'pa_me',
        sessionId: 'se_1',
        name: 'Sam Consultant',
        role: 'Consultant',
        organisation: 'Sam Consulting',
        side: 'consultant',
        speakerLabels: ['Sam'],
      },
    },
    consents: { cr_1: consentRecord() },
    transcripts: {
      tr_1: {
        id: 'tr_1',
        sessionId: 'se_1',
        source: { kind: 'file', fileName: 'kickoff.vtt', format: 'vtt', platform: 'teams' },
        importedBy: 'Sam Consultant',
        importedAt: T2,
        unaskedSpeakers: [],
        unnamedSpeakers: false,
      },
    },
    segments: {
      sg_1: {
        id: 'sg_1',
        transcriptId: 'tr_1',
        index: 0,
        speakerLabel: 'Alex Owner',
        startMs: 0,
        endMs: 6000,
        text: 'We get about five times as many orders in December.',
        confidence: null,
      },
      sg_2: {
        id: 'sg_2',
        transcriptId: 'tr_1',
        index: 1,
        speakerLabel: 'Alex Owner',
        startMs: 6000,
        endMs: 9500,
        text: 'Right now we keep stock in a spreadsheet.',
        confidence: null,
      },
      sg_3: {
        id: 'sg_3',
        transcriptId: 'tr_1',
        index: 2,
        speakerLabel: 'Sam',
        startMs: 9500,
        endMs: null,
        text: 'Who edits it?',
        confidence: null,
      },
    },
    notes: {
      no_1: {
        id: 'no_1',
        sessionId: 'se_1',
        text: 'Ask about spreadsheet conflicts at month end.',
        writtenAt: T1,
        updatedAt: T1,
      },
    },
    files: {},
    findings: { fd_peak: consultantFinding, fd_stock: acceptedAiFinding, fd_risk: pendingAiFinding },
    relations: {
      re_1: { id: 're_1', type: 'influences', fromId: 'fd_peak', toId: 'fd_stock', createdBy: 'Sam Consultant', createdAt: T3 },
    },
  } satisfies CompanyWorkspace);
}
