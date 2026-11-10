/**
 * Validation of a company's workspace: the shape of every entity, and the
 * rules that keep the record trustworthy (docs/spec/DOMAIN-MODEL.md, "Rules").
 *
 * Unlike the editor's project loader, nothing is repaired. Dropping a piece of
 * evidence or a consent amendment would quietly change what the record says,
 * so a problem is reported and the caller decides.
 */
import {
  amendmentIssues,
  applyAmendment,
  retentionToldIssue,
  canUseAi,
  consentState,
  missingFor,
  missingStatements,
  termsIssues,
  toldIssues,
  toldSoFar,
  type ConsentTerms,
} from './consent.ts';
import { isInRecord } from './findings.ts';
import { wordingFor } from './wording.ts';
import {
  AI_PROVENANCES,
  ENTITY_MAPS,
  FILE_PURPOSES,
  FINDING_KINDS,
  FINDING_STATUSES,
  RELATION_TYPES,
  TRACKED_FIELDS,
  TRANSCRIPT_FORMATS,
  TRANSCRIPT_PLATFORMS,
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  type Actor,
  type CompanyWorkspace,
  type ConsentRecord,
  type EntityMap,
  type Evidence,
  type FactSource,
  type Finding,
  type FindingChange,
  type Provenance,
  type TrackedField,
} from './types.ts';
import {
  get,
  isCalendarDate,
  isId,
  isNonEmptyText,
  isQuoteLongEnough,
  MIN_QUOTE_WORDS,
  isText,
  isTimeZone,
  isTimestamp,
  quoteAppearsIn,
  time,
} from './util.ts';

export interface Problem {
  /** Stable identifier of the rule, for tests and for the interface to look up its own wording. */
  code: string;
  message: string;
  /** Where the problem is: the entity map (or "company"/"workspace") and the entity's id. */
  where: { map: EntityMap | 'company' | 'workspace'; id?: string };
}

type Report = (code: string, message: string, map: Problem['where']['map'], id?: string) => void;

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => list.includes(value as T);

/**
 * Every problem in a workspace. An empty list means the workspace is valid.
 * The input is assumed to have the workspace's top-level shape (see `parseWorkspace`).
 */
export function validateWorkspace(ws: CompanyWorkspace): Problem[] {
  const problems: Problem[] = [];
  const report: Report = (code, message, map, id) => problems.push({ code, message, where: id ? { map, id } : { map } });

  if (ws.format !== WORKSPACE_FORMAT) report('workspace.format', 'Not a StyleCode workspace.', 'workspace');
  if (ws.version !== WORKSPACE_VERSION)
    report('workspace.version', `Unsupported workspace version ${String(ws.version)}.`, 'workspace');

  checkKeys(ws, report);
  checkCompany(ws, report);
  checkKnowledge(ws, report);
  checkEngagements(ws, report);
  checkSessions(ws, report);
  checkConsents(ws, report);
  checkTranscripts(ws, report);
  checkNotes(ws, report);
  checkFiles(ws, report);
  checkFindings(ws, report);
  checkRelations(ws, report);
  return problems;
}

/** Map keys are valid ids and equal the entity's own id. */
function checkKeys(ws: CompanyWorkspace, report: Report) {
  for (const map of ENTITY_MAPS) {
    for (const [key, entity] of Object.entries(ws[map] as Record<string, { id?: unknown }>)) {
      if (!isId(key)) report('id.invalid', `An entry has an invalid id.`, map);
      else if (!entity || typeof entity !== 'object' || entity.id !== key)
        report('id.mismatch', `Entry ${key} doesn't carry its own id.`, map, key);
    }
  }
}

function checkCompany(ws: CompanyWorkspace, report: Report) {
  const c = ws.company;
  if (!c || typeof c !== 'object') return report('company.missing', 'The workspace has no company.', 'company');
  if (!isId(c.id)) report('id.invalid', 'The company has an invalid id.', 'company');
  if (!isNonEmptyText(c.name)) report('company.name', 'The company needs a name.', 'company', c.id);
  for (const field of ['industry', 'description', 'existingSystems', 'notes'] as const) {
    if (!isText(c[field])) report('field.type', `The company's ${field} must be text.`, 'company', c.id);
  }
  checkTimes(c, 'company', report);
}

function checkKnowledge(ws: CompanyWorkspace, report: Report) {
  for (const fact of Object.values(ws.knowledge)) {
    if (!isNonEmptyText(fact.statement)) report('fact.statement', 'A company fact needs a statement.', 'knowledge', fact.id);
    if (!oneOf(FINDING_KINDS, fact.kind)) report('field.value', 'A company fact has an unknown kind.', 'knowledge', fact.id);
    checkProvenance(fact.provenance, 'knowledge', fact.id, report);
    if (fact.source !== null) checkFactSource(ws, fact.id, fact.source, report);
    if (!isNonEmptyText(fact.createdBy)) report('field.value', 'A company fact says who added it.', 'knowledge', fact.id);
    if (!isTimestamp(fact.createdAt)) report('field.time', 'A company fact has an invalid time.', 'knowledge', fact.id);
  }
}

function checkFactSource(ws: CompanyWorkspace, id: string, source: FactSource, report: Report) {
  const s = source as unknown as Record<string, unknown> | undefined;
  if (!s || typeof s !== 'object') return report('field.value', 'A company fact has an invalid source.', 'knowledge', id);
  const quotesOk =
    Array.isArray(s.quotes) &&
    s.quotes.every(
      (q: { text?: unknown; sessionId?: unknown; sessionTitle?: unknown; speakerLabel?: unknown } | null) =>
        !!q &&
        isNonEmptyText(q.text) &&
        isId(q.sessionId) &&
        isText(q.sessionTitle) &&
        (q.speakerLabel === null || isNonEmptyText(q.speakerLabel)),
    );
  if (!isNonEmptyText(s.statement) || !isText(s.engagementName) || !quotesOk)
    report('fact.source', "A company fact keeps a copy of its source's statement and quotes.", 'knowledge', id);
  if (s.findingId === null) {
    if (!isTimestamp(s.deletedAt)) report('fact.source', 'A deleted source says when it was deleted.', 'knowledge', id);
    return;
  }
  if (s.deletedAt !== null) report('fact.source', 'A source that still exists has no deletion time.', 'knowledge', id);
  const finding = get(ws.findings, s.findingId);
  if (!finding)
    report('ref.missing', 'A company fact was promoted from a finding that is not in this workspace.', 'knowledge', id);
  else if (!isInRecord(finding))
    report('fact.source', 'Only findings in the record can become company knowledge.', 'knowledge', id);
}

function checkEngagements(ws: CompanyWorkspace, report: Report) {
  for (const e of Object.values(ws.engagements)) {
    if (e.companyId !== ws.company?.id)
      report('ref.company', 'An engagement belongs to a different company.', 'engagements', e.id);
    if (!isNonEmptyText(e.name)) report('engagement.name', 'An engagement needs a name.', 'engagements', e.id);
    if (!isText(e.goal)) report('field.type', "An engagement's goal must be text.", 'engagements', e.id);
    const status = e.status as { state?: unknown; endedOn?: unknown } | undefined;
    if (!status || (status.state !== 'active' && !(status.state === 'ended' && isCalendarDate(status.endedOn)))) {
      report('field.value', 'An engagement has an invalid status.', 'engagements', e.id);
    }
    checkTimes(e, 'engagements', report);
  }
  for (const d of Object.values(ws.designs)) {
    if (!get(ws.engagements, d.engagementId))
      report('ref.missing', 'A design belongs to an engagement that is not in this workspace.', 'designs', d.id);
    if (!isNonEmptyText(d.name)) report('design.name', 'A design needs a name.', 'designs', d.id);
    if (!isId(d.documentId)) report('id.invalid', 'A design has an invalid document id.', 'designs', d.id);
    if (!isTimestamp(d.createdAt)) report('field.time', 'A design has an invalid time.', 'designs', d.id);
  }
}

function checkSessions(ws: CompanyWorkspace, report: Report) {
  for (const s of Object.values(ws.sessions)) {
    if (!get(ws.engagements, s.engagementId))
      report('ref.missing', 'A session belongs to an engagement that is not in this workspace.', 'sessions', s.id);
    if (!isNonEmptyText(s.title)) report('session.title', 'A session needs a title.', 'sessions', s.id);
    if (!isTimestamp(s.startsAt)) report('field.time', 'A session has an invalid start time.', 'sessions', s.id);
    if (!isTimeZone(s.timeZone)) report('field.value', 'A session has an unknown time zone.', 'sessions', s.id);
    if (!Array.isArray(s.audioFileIds)) report('field.type', "A session's audio must be a list.", 'sessions', s.id);
    else {
      for (const fileId of s.audioFileIds) {
        const file = get(ws.files, fileId);
        if (!file || file.owner?.kind !== 'session' || file.owner.sessionId !== s.id || file.purpose !== 'audio') {
          report('ref.missing', 'A session lists audio that is not one of its audio files.', 'sessions', s.id);
        }
      }
    }
    checkTimes(s, 'sessions', report);
  }

  const labelOwner = new Map<string, string>();
  for (const p of Object.values(ws.participants)) {
    if (!get(ws.sessions, p.sessionId))
      report('ref.missing', 'A participant belongs to a session that is not in this workspace.', 'participants', p.id);
    if (!isNonEmptyText(p.name)) report('participant.name', 'A participant needs a name.', 'participants', p.id);
    if (!isText(p.role) || !isText(p.organisation))
      report('field.type', "A participant's role and organisation must be text.", 'participants', p.id);
    if (p.side !== 'client' && p.side !== 'consultant')
      report('field.value', 'A participant must be on the client or consultant side.', 'participants', p.id);
    if (!Array.isArray(p.speakerLabels) || !p.speakerLabels.every(isNonEmptyText)) {
      report('field.type', "A participant's speaker labels must be a list of text.", 'participants', p.id);
      continue;
    }
    for (const label of p.speakerLabels) {
      const key = `${p.sessionId}\u0000${label}`;
      const other = labelOwner.get(key);
      if (other && other !== p.id)
        report('participant.label', `The speaker label "${label}" belongs to two participants.`, 'participants', p.id);
      labelOwner.set(key, p.id);
    }
  }
}

function checkConsents(ws: CompanyWorkspace, report: Report) {
  const perSession = new Set<string>();
  for (const c of Object.values(ws.consents)) {
    const session = get(ws.sessions, c.sessionId);
    if (!session) report('ref.missing', 'A consent record belongs to a session that is not in this workspace.', 'consents', c.id);
    if (perSession.has(c.sessionId)) report('consent.duplicate', 'A session has more than one consent record.', 'consents', c.id);
    perSession.add(c.sessionId);

    if (!Array.isArray(c.askedParticipantIds)) report('field.type', 'The people asked must be a list.', 'consents', c.id);
    else {
      for (const pid of c.askedParticipantIds) {
        const p = get(ws.participants, pid);
        if (!p || p.sessionId !== c.sessionId)
          report('ref.missing', 'The consent record names someone who is not in the session.', 'consents', c.id);
        else if (p.side !== 'client') report('consent.asked', 'Consent is asked of client participants only.', 'consents', c.id);
      }
      if (new Set(c.askedParticipantIds).size !== c.askedParticipantIds.length)
        report('consent.asked', 'The consent record names someone twice.', 'consents', c.id);
      if (c.confirmed && c.askedParticipantIds.length === 0)
        report('consent.asked', 'A confirmed consent record names who was asked.', 'consents', c.id);
    }
    if (!isText(c.askedBy) || (c.confirmed && !isNonEmptyText(c.askedBy)))
      report('consent.askedBy', 'A confirmed consent record names who asked.', 'consents', c.id);
    const method = c.method as { kind?: unknown; description?: unknown } | undefined;
    if (!method || !['verbal-at-start', 'written-before', 'other'].includes(method.kind as string)) {
      report('field.value', 'The consent record has an unknown method.', 'consents', c.id);
    } else if (method.kind === 'other' && !isNonEmptyText(method.description)) {
      report('consent.method', 'Describe how consent was asked.', 'consents', c.id);
    }
    // CONSENT.md rule C2: the client was told about everything they agreed to.
    const toldProblems = toldIssues(c.told);
    for (const issue of toldProblems) report(issue.code, issue.message, 'consents', c.id);
    if (c.confirmed && !toldProblems.length) {
      const missing = missingStatements(c);
      if (missing.length)
        report(
          'consent.told',
          `The client agreed to something they weren't told about (${missing.join(', ')}).`,
          'consents',
          c.id,
        );
    }
    if (!isNonEmptyText(c.wordingVersion))
      report('consent.wording', 'The consent record names the wording shown.', 'consents', c.id);
    // The record must be able to say exactly what the client heard (rule C9).
    else if (!wordingFor(c.wordingVersion))
      report(
        'consent.wording',
        `The consent record names a wording this StyleCode doesn't know (${c.wordingVersion}).`,
        'consents',
        c.id,
      );
    // Consent given, or given with limits, to nothing at all contradicts itself.
    const given = c.given as Partial<ConsentRecord['given']> | null;
    if (c.confirmed && given && typeof given === 'object' && c.outcome?.kind !== 'declined') {
      if (!['audioRecording', 'transcription', 'aiLocal', 'aiExternal'].some((k) => given[k as keyof typeof given] === true))
        report('consent.nothing', 'A confirmed consent record that isn’t declined agrees to something.', 'consents', c.id);
    }
    const terms: ConsentTerms = { given: c.given, retention: c.retention, outcome: c.outcome };
    for (const issue of termsIssues(terms)) report(issue.code, issue.message, 'consents', c.id);
    if (c.confirmed !== null && (!c.confirmed || !isNonEmptyText(c.confirmed.by) || !isTimestamp(c.confirmed.at))) {
      report('consent.confirmed', "The consultant's confirmation needs a name and a time.", 'consents', c.id);
    }
    if (c.attachmentFileId !== null) {
      const file = get(ws.files, c.attachmentFileId);
      const ownedHere =
        file &&
        file.purpose === 'consent-attachment' &&
        ((file.owner?.kind === 'session' && file.owner.sessionId === c.sessionId) ||
          (file.owner?.kind === 'engagement' && file.owner.engagementId === session?.engagementId));
      if (!ownedHere)
        report('ref.missing', "The consent record's attachment is not a file of its session or engagement.", 'consents', c.id);
    }
    checkLockAndAmendments(c, terms, report);
    checkTimes(c, 'consents', report);
  }
}

function checkLockAndAmendments(c: ConsentRecord, original: ConsentTerms, report: Report) {
  if (c.lockedAt !== null) {
    if (!isTimestamp(c.lockedAt)) return report('field.time', 'The consent record has an invalid lock time.', 'consents', c.id);
    if (!c.confirmed) report('consent.lock', 'Only a confirmed consent record can be locked.', 'consents', c.id);
    else if (isTimestamp(c.confirmed.at) && time(c.lockedAt) < time(c.confirmed.at)) {
      report('consent.lock', 'The consent record was locked before it was confirmed.', 'consents', c.id);
    }
  }
  if (!Array.isArray(c.amendments)) return report('field.type', 'Amendments must be a list.', 'consents', c.id);
  if (c.amendments.length && c.lockedAt === null)
    report('consent.amendment', 'Only a locked consent record has amendments.', 'consents', c.id);
  let previous = c.lockedAt && isTimestamp(c.lockedAt) ? time(c.lockedAt) : -Infinity;
  let withdrawn = false;
  let terms = original;
  const ids = new Set<string>();
  for (const [index, a] of c.amendments.entries()) {
    if (!a || typeof a !== 'object') {
      report('field.value', 'An amendment is not readable.', 'consents', c.id);
      continue;
    }
    if (!isId(a.id) || ids.has(a.id)) report('id.invalid', 'An amendment has a missing or repeated id.', 'consents', c.id);
    ids.add(a.id);
    if (!isTimestamp(a.at)) {
      report('field.time', 'An amendment has an invalid time.', 'consents', c.id);
      continue;
    }
    if (time(a.at) < previous)
      report('consent.amendment', 'Amendments are in date order, after the record was locked.', 'consents', c.id);
    previous = time(a.at);
    if (!isNonEmptyText(a.by) || !isNonEmptyText(a.reason))
      report('consent.amendment', 'An amendment says who made it and why.', 'consents', c.id);
    if (withdrawn) report('consent.amendment', 'Nothing can follow a withdrawal of consent.', 'consents', c.id);
    if (a.kind === 'withdrawal') withdrawn = true;
    else if (a.kind === 'change') {
      // Each amendment is checked like the record itself, and so are the terms it leaves behind.
      const own = amendmentIssues(a);
      for (const issue of own) report(issue.code, issue.message, 'consents', c.id);
      if (own.length) continue;
      // Report only what the amendment introduced, so a problem in the record isn't repeated for each amendment.
      const known = new Set(termsIssues(terms).map((i) => i.message));
      const missingBefore = missingFor(toldSoFar(c, index), terms.given);
      const retentionIssue = retentionToldIssue(terms, a);
      if (retentionIssue) report(retentionIssue.code, retentionIssue.message, 'consents', c.id);
      terms = applyAmendment(terms, a);
      // Rule C2 holds for amendments too, against everything the client had been told by then (decision 3).
      const untold = missingFor(toldSoFar(c, index + 1), terms.given).filter((s) => !missingBefore.includes(s));
      if (untold.length)
        report(
          'consent.told',
          `An amendment agrees to something the client wasn't told about (${untold.join(', ')}).`,
          'consents',
          c.id,
        );
      for (const issue of termsIssues(terms).filter((i) => !known.has(i.message)))
        report(issue.code, `After an amendment: ${lowerFirst(issue.message)}`, 'consents', c.id);
    } else report('field.value', 'An amendment has an unknown kind.', 'consents', c.id);
  }
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

function checkTranscripts(ws: CompanyWorkspace, report: Report) {
  const perSession = new Set<string>();
  for (const t of Object.values(ws.transcripts)) {
    if (!get(ws.sessions, t.sessionId))
      report('ref.missing', 'A transcript belongs to a session that is not in this workspace.', 'transcripts', t.id);
    if (perSession.has(t.sessionId))
      report('transcript.duplicate', 'A session has more than one transcript.', 'transcripts', t.id);
    perSession.add(t.sessionId);
    const src = t.source as { kind?: unknown; fileName?: unknown; format?: unknown; platform?: unknown } | undefined;
    const sourceOk =
      src?.kind === 'pasted' ||
      (src?.kind === 'file' &&
        isNonEmptyText(src.fileName) &&
        oneOf(TRANSCRIPT_FORMATS, src.format) &&
        oneOf(TRANSCRIPT_PLATFORMS, src.platform));
    if (!sourceOk) report('field.value', 'A transcript has an invalid source.', 'transcripts', t.id);
    if (!Array.isArray(t.unaskedSpeakers) || !t.unaskedSpeakers.every(isNonEmptyText) || typeof t.unnamedSpeakers !== 'boolean')
      report('field.type', 'A transcript keeps its speaker warning as a list of names and a yes or no.', 'transcripts', t.id);
    if (!isNonEmptyText(t.importedBy) || !isTimestamp(t.importedAt)) {
      report('field.value', 'A transcript says who imported it and when.', 'transcripts', t.id);
      continue;
    }
    // No transcript without consent (ADR-0003): a confirmed record that allowed transcription when it was imported, locked by then.
    const consent = Object.values(ws.consents).find((c) => c.sessionId === t.sessionId);
    if (!consent || !consent.confirmed) {
      report('consent.required', 'A transcript was imported without a confirmed consent record.', 'transcripts', t.id);
    } else {
      const state = consentState(consent, t.importedAt);
      if (!state.given.transcription)
        report('consent.required', 'A transcript was imported without consent to transcription.', 'transcripts', t.id);
      if (consent.lockedAt === null || (isTimestamp(consent.lockedAt) && time(consent.lockedAt) > time(t.importedAt))) {
        report('consent.lock', 'Importing a transcript locks the consent record.', 'transcripts', t.id);
      }
    }
  }

  const indexes = new Map<string, number[]>();
  for (const s of Object.values(ws.segments)) {
    if (!get(ws.transcripts, s.transcriptId))
      report('ref.missing', 'A segment belongs to a transcript that is not in this workspace.', 'segments', s.id);
    if (!Number.isInteger(s.index) || s.index < 0) report('field.value', 'A segment has an invalid position.', 'segments', s.id);
    else {
      const list = indexes.get(s.transcriptId);
      if (list) list.push(s.index);
      else indexes.set(s.transcriptId, [s.index]);
    }
    if (s.speakerLabel !== null && !isNonEmptyText(s.speakerLabel))
      report('field.type', "A segment's speaker label must be text.", 'segments', s.id);
    if (!isText(s.text)) report('field.type', "A segment's text must be text.", 'segments', s.id);
    const timeOk = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
    if (!timeOk(s.startMs) || !timeOk(s.endMs)) report('field.value', 'A segment has an invalid time.', 'segments', s.id);
    else if (s.endMs !== null && (s.startMs === null || s.endMs < s.startMs))
      report('segment.time', 'A segment ends before it starts.', 'segments', s.id);
    if (s.confidence !== null && !(typeof s.confidence === 'number' && s.confidence >= 0 && s.confidence <= 1)) {
      report('field.value', "A segment's confidence must be between 0 and 1.", 'segments', s.id);
    }
  }
  for (const [transcriptId, list] of indexes) {
    const sorted = [...list].sort((a, b) => a - b);
    if (sorted.some((v, i) => v !== i))
      report('segment.order', 'A transcript has missing or repeated segment positions.', 'transcripts', transcriptId);
  }
}

function checkNotes(ws: CompanyWorkspace, report: Report) {
  for (const n of Object.values(ws.notes)) {
    if (!get(ws.sessions, n.sessionId))
      report('ref.missing', 'A note belongs to a session that is not in this workspace.', 'notes', n.id);
    if (!isText(n.text)) report('field.type', "A note's text must be text.", 'notes', n.id);
    if (!isTimestamp(n.writtenAt) || !isTimestamp(n.updatedAt))
      report('field.time', 'A note has an invalid time.', 'notes', n.id);
  }
}

function checkFiles(ws: CompanyWorkspace, report: Report) {
  for (const f of Object.values(ws.files)) {
    const owner = f.owner as { kind?: unknown; engagementId?: unknown; sessionId?: unknown } | undefined;
    const ownerOk =
      owner?.kind === 'company' ||
      (owner?.kind === 'engagement' && !!get(ws.engagements, owner.engagementId)) ||
      (owner?.kind === 'session' && !!get(ws.sessions, owner.sessionId));
    if (!ownerOk) report('ref.missing', 'A file is attached to something that is not in this workspace.', 'files', f.id);
    if (!oneOf(FILE_PURPOSES, f.purpose)) report('field.value', 'A file has an unknown purpose.', 'files', f.id);
    else if (f.purpose === 'consent-attachment') {
      // One file per consent record (Phase 2 brief, decision 12): an attachment no record names is left behind.
      const records = Object.values(ws.consents).filter((c) => c.attachmentFileId === f.id).length;
      if (records !== 1)
        report('consent.attachment', 'A consent attachment belongs to exactly one consent record.', 'files', f.id);
    } else if (f.purpose === 'audio') {
      // Rule C1: audio needs consent to recording, given when the audio was added (Phase 3).
      const sessionId = owner?.kind === 'session' ? (owner.sessionId as string) : null;
      const consent = sessionId ? Object.values(ws.consents).find((c) => c.sessionId === sessionId) : undefined;
      if (!sessionId) report('field.value', 'Audio belongs to a session.', 'files', f.id);
      else if (
        !consent ||
        !consent.confirmed ||
        !isTimestamp(f.addedAt) ||
        !consentState(consent, f.addedAt).given.audioRecording
      )
        report('consent.required', 'Audio was added without consent to recording.', 'files', f.id);
    }
    if (!isNonEmptyText(f.name) || !isNonEmptyText(f.mediaType))
      report('field.value', 'A file needs a name and a media type.', 'files', f.id);
    if (!Number.isInteger(f.sizeBytes) || f.sizeBytes < 0) report('field.value', 'A file has an invalid size.', 'files', f.id);
    if (!isNonEmptyText(f.addedBy) || !isTimestamp(f.addedAt))
      report('field.value', 'A file says who added it and when.', 'files', f.id);
  }
}

function checkProvenance(p: Provenance | undefined, map: EntityMap, id: string, report: Report) {
  const kind = (p as { kind?: unknown } | undefined)?.kind;
  if (kind === 'verified') {
    const v = p as Extract<Provenance, { kind: 'verified' }>;
    if (!isNonEmptyText(v.source) || !isCalendarDate(v.checkedOn) || (v.url !== null && !isNonEmptyText(v.url))) {
      report('provenance.verified', 'Verified information names its source and the date it was checked.', map, id);
    }
  } else if (kind === 'calculated') {
    const c = p as Extract<Provenance, { kind: 'calculated' }>;
    if (!isNonEmptyText(c.engine) || !isNonEmptyText(c.engineVersion))
      report('provenance.calculated', 'A calculated result names its engine and version.', map, id);
  } else if (kind !== 'said-in-session' && kind !== 'consultant' && kind !== 'ai-suggested') {
    report('field.value', 'Unknown provenance.', map, id);
  }
}

function isActor(a: Actor | undefined): boolean {
  if (!a) return false;
  if (a.kind === 'consultant') return isNonEmptyText(a.name);
  return a.kind === 'ai' && isNonEmptyText(a.provider) && isNonEmptyText(a.model);
}

function checkFindings(ws: CompanyWorkspace, report: Report) {
  for (const f of Object.values(ws.findings)) {
    const engagement = get(ws.engagements, f.engagementId);
    if (!engagement) report('ref.missing', 'A finding belongs to an engagement that is not in this workspace.', 'findings', f.id);
    if (!oneOf(FINDING_KINDS, f.kind)) report('field.value', 'A finding has an unknown kind.', 'findings', f.id);
    if (!oneOf(FINDING_STATUSES, f.status)) report('field.value', 'A finding has an unknown status.', 'findings', f.id);
    if (!isNonEmptyText(f.statement)) report('finding.statement', 'A finding needs a statement.', 'findings', f.id);
    checkProvenance(f.provenance, 'findings', f.id, report);
    checkTimes(f, 'findings', report);

    // Origin and review.
    const origin = f.origin as Finding['origin'] | undefined;
    if (origin?.kind === 'consultant') {
      if (!isNonEmptyText(origin.by) || !isTimestamp(origin.at))
        report('finding.origin', 'A finding says who entered it and when.', 'findings', f.id);
      if (f.provenance?.kind === 'ai-suggested')
        report('finding.provenance', 'A finding the consultant entered is not AI-suggested.', 'findings', f.id);
    } else if (origin?.kind === 'ai') {
      if (!isNonEmptyText(origin.provider) || !isNonEmptyText(origin.model) || !isTimestamp(origin.at)) {
        report('finding.origin', 'An AI proposal names its provider and model, and when it was made.', 'findings', f.id);
      }
      const review = origin.review as { state?: unknown; by?: unknown; at?: unknown } | undefined;
      if (!review || !['pending', 'accepted', 'rejected'].includes(review.state as string)) {
        report('field.value', 'An AI proposal has an invalid review.', 'findings', f.id);
      } else if (review.state !== 'pending' && (!isNonEmptyText(review.by) || !isTimestamp(review.at))) {
        report('finding.review', 'Accepting or rejecting a proposal records who and when.', 'findings', f.id);
      }
      if (!AI_PROVENANCES.includes(f.provenance?.kind)) {
        report('finding.aiProvenance', 'The AI cannot supply verified or calculated information.', 'findings', f.id);
      }
      checkProposed(ws, f, origin, report);
    } else report('field.value', 'A finding has an unknown origin.', 'findings', f.id);

    // Status: only the consultant confirms (vision §7; ADR-0004).
    if (!f.statusSet || !isActor(f.statusSet.by) || !isTimestamp(f.statusSet.at)) {
      report('finding.statusSet', 'A finding records who set its status and when.', 'findings', f.id);
    } else {
      if (f.status === 'confirmed' && f.statusSet.by.kind !== 'consultant') {
        report('finding.confirmedByAi', 'Only the consultant can confirm a finding.', 'findings', f.id);
      }
      if (origin?.kind === 'ai' && origin.review?.state !== 'accepted' && f.statusSet.by.kind !== 'ai') {
        report('finding.statusSet', 'A proposal still under review keeps the status the AI proposed.', 'findings', f.id);
      }
      if (origin?.kind === 'consultant' && f.statusSet.by.kind !== 'consultant') {
        report('finding.statusSet', "The AI cannot set the status of the consultant's finding.", 'findings', f.id);
      }
    }

    checkHistory(f, report);

    // Evidence.
    if (!Array.isArray(f.evidence)) {
      report('field.type', "A finding's evidence must be a list.", 'findings', f.id);
      continue;
    }
    let citesSegment = false;
    for (const e of f.evidence) {
      const result = checkEvidence(ws, f.engagementId, e);
      if (!result.ok) report(result.code, result.message, 'findings', f.id);
      else if (result.kind === 'segment') citesSegment = true;
    }
    if (f.provenance?.kind === 'said-in-session' && !citesSegment) {
      report(
        'finding.saidNeedsSegment',
        'A finding said in a session cites at least one transcript segment from its engagement.',
        'findings',
        f.id,
      );
    }
    // Provenance follows the evidence (Phase 2 brief, decision 9): quoting what was said makes a finding "said in a session".
    if (citesSegment && (f.provenance?.kind === 'consultant' || f.provenance?.kind === 'ai-suggested')) {
      report('finding.provenance', 'A finding that quotes a transcript is said in a session.', 'findings', f.id);
    }
  }
}

/**
 * An AI proposal keeps what the AI proposed. Its evidence is checked like any
 * other. Every session the AI was given, which includes every session it
 * cites, must have allowed that processing, local or by the named external
 * provider, when the proposal was made (CONSENT.md, rules C5 and C6).
 */
function checkProposed(ws: CompanyWorkspace, f: Finding, origin: Extract<Finding['origin'], { kind: 'ai' }>, report: Report) {
  const p = origin.proposed as unknown as Partial<Record<string, unknown>> | undefined;
  if (
    !p ||
    typeof p !== 'object' ||
    !oneOf(FINDING_KINDS, p.kind) ||
    !oneOf(FINDING_STATUSES, p.status) ||
    !isNonEmptyText(p.statement) ||
    !Array.isArray(p.evidence)
  ) {
    return report(
      'finding.proposed',
      'An AI proposal keeps the kind, statement, status and evidence the AI proposed.',
      'findings',
      f.id,
    );
  }
  if (p.status === 'confirmed') report('finding.confirmedByAi', 'Only the consultant can confirm a finding.', 'findings', f.id);
  const sessions = new Set<string>();
  for (const e of p.evidence as Evidence[]) {
    const result = checkEvidence(ws, f.engagementId, e);
    if (!result.ok) report(result.code, `In the AI's proposal: ${lowerFirst(result.message)}`, 'findings', f.id);
    else if (result.kind !== 'deleted') sessions.add(result.sessionId);
  }
  const processing = origin.processing as Record<string, unknown> | undefined;
  if (!processing || !(processing.kind === 'local' || (processing.kind === 'external' && isNonEmptyText(processing.provider)))) {
    return report(
      'finding.origin',
      'An AI proposal says whether it ran on this computer or which provider ran it.',
      'findings',
      f.id,
    );
  }
  const inputs = origin.inputSessionIds as unknown;
  if (!Array.isArray(inputs) || !inputs.every(isId)) {
    return report('finding.origin', 'An AI proposal lists the sessions the AI was given.', 'findings', f.id);
  }
  if ([...sessions].some((id) => !inputs.includes(id)))
    report('finding.origin', 'An AI proposal cites a session the AI was not given.', 'findings', f.id);
  if (!isTimestamp(origin.at)) return;
  // Sessions deleted since are skipped: their consent record went with them.
  const given = new Set<string>([...sessions, ...inputs.filter((id: string) => get(ws.sessions, id))]);
  for (const sessionId of given) {
    const allowed = canUseAi(ws, sessionId, origin.processing, origin.at);
    if (!allowed.ok) {
      report(
        'finding.aiConsent',
        `The AI proposed this when consent didn't allow it: ${lowerFirst(allowed.error)}`,
        'findings',
        f.id,
      );
      break;
    }
  }
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Who changed a finding, and when (MVP 6.2 and 7.1). Replaying the history
 * from the AI's proposal (or, for the consultant's own findings, from the first
 * recorded value) must give the current kind, statement, status and evidence.
 */
function checkHistory(f: Finding, report: Report) {
  if (!Array.isArray(f.history)) return report('field.type', "A finding's history must be a list.", 'findings', f.id);
  const bad = (message: string) => report('finding.history', message, 'findings', f.id);
  const origin = f.origin as Finding['origin'] | undefined;
  const proposed =
    origin?.kind === 'ai' ? (origin.proposed as unknown as Partial<Record<string, unknown>> | undefined) : undefined;

  if (origin?.kind === 'ai' && origin.review?.state !== 'accepted') {
    if (f.history.length) bad('A proposal that is under review or rejected has no changes.');
    if (proposed && TRACKED_FIELDS.some((field) => !sameValue(f[field], proposed[field])))
      bad('A proposal that is under review or rejected still reads as the AI proposed it.');
    return;
  }

  const current: Partial<Record<TrackedField, unknown>> = {};
  if (proposed) for (const field of TRACKED_FIELDS) current[field] = proposed[field];
  let previous = -Infinity;
  for (const change of f.history as FindingChange[]) {
    if (!change || !oneOf(TRACKED_FIELDS, change.field) || !isNonEmptyText(change.by) || !isTimestamp(change.at)) {
      bad('Each change to a finding says what changed, who changed it and when.');
      continue;
    }
    if (time(change.at) < previous) bad('Changes to a finding are in date order.');
    previous = time(change.at);
    if (sameValue(change.from, change.to)) bad('A recorded change changes something.');
    if (change.field in current && !sameValue(current[change.field], change.from))
      bad(`The history of the finding's ${change.field} doesn't follow on from its previous value.`);
    current[change.field] = change.to;
  }
  for (const field of TRACKED_FIELDS) {
    if (field in current && !sameValue(current[field], f[field])) bad(`The finding's ${field} doesn't match its history.`);
  }

  const lastStatus = (f.history as FindingChange[]).filter((c) => c?.field === 'status').at(-1);
  const set = f.statusSet as Finding['statusSet'] | undefined;
  if (lastStatus && set && (set.by?.kind !== 'consultant' || set.by.name !== lastStatus.by || set.at !== lastStatus.at)) {
    bad('Who set the status, and when, matches the last change to it.');
  }
}

type EvidenceCheck = { ok: true; kind: Evidence['kind']; sessionId: string } | { ok: false; code: string; message: string };

/** Checks one piece of evidence against the engagement it must belong to. */
function checkEvidence(ws: CompanyWorkspace, engagementId: string, e: Evidence): EvidenceCheck {
  const problem = (code: string, message: string): EvidenceCheck => ({ ok: false, code, message });
  if (e && e.kind === 'deleted') {
    // Words removed after a withdrawal (CONSENT.md, rule C8); the session may be gone too.
    if (!isId(e.sessionId) || !isTimestamp(e.deletedAt))
      return problem('field.value', 'Deleted evidence names its session and when it was deleted.');
    return { ok: true, kind: 'deleted', sessionId: e.sessionId };
  }
  if (!e || !isNonEmptyText(e.quote)) return problem('evidence.quote', 'Evidence quotes the words it rests on.');
  let text: string;
  let sessionId: string;
  if (e.kind === 'segment') {
    const segment = get(ws.segments, e.segmentId);
    const transcript = segment && get(ws.transcripts, segment.transcriptId);
    const session = transcript && get(ws.sessions, transcript.sessionId);
    if (!segment || !session) return problem('evidence.missing', 'Evidence cites a transcript segment that does not exist.');
    if (session.engagementId !== engagementId)
      return problem('evidence.engagement', 'Evidence cites a segment from another engagement.');
    ({ text } = segment);
    sessionId = session.id;
  } else if (e.kind === 'note') {
    const note = get(ws.notes, e.noteId);
    const session = note && get(ws.sessions, note.sessionId);
    if (!note || !session) return problem('evidence.missing', 'Evidence cites a note that does not exist.');
    if (session.engagementId !== engagementId)
      return problem('evidence.engagement', 'Evidence cites a note from another engagement.');
    ({ text } = note);
    sessionId = session.id;
  } else return problem('field.value', 'Evidence of an unknown kind.');
  if (!isText(text) || !quoteAppearsIn(text, e.quote))
    return problem('evidence.invented', `The quoted words do not appear in the cited ${e.kind}.`);
  if (!isQuoteLongEnough(text, e.quote))
    return problem('evidence.short', `A quote is at least ${MIN_QUOTE_WORDS} words, unless it is the whole ${e.kind}.`);
  return { ok: true, kind: e.kind, sessionId };
}

function checkRelations(ws: CompanyWorkspace, report: Report) {
  const seen = new Set<string>();
  for (const r of Object.values(ws.relations)) {
    if (!oneOf(RELATION_TYPES, r.type)) report('field.value', 'A link has an unknown type.', 'relations', r.id);
    const from = get(ws.findings, r.fromId);
    const to = get(ws.findings, r.toId);
    if (!from || !to) {
      report('ref.missing', 'A link points at a finding that is not in this workspace.', 'relations', r.id);
      continue;
    }
    if (r.fromId === r.toId) report('relation.self', 'A finding cannot be linked to itself.', 'relations', r.id);
    if (from.engagementId !== to.engagementId)
      report('relation.engagement', 'Links stay within one engagement.', 'relations', r.id);
    if (!isInRecord(from) || !isInRecord(to))
      report('relation.record', 'Only findings in the record can be linked.', 'relations', r.id);
    // "Conflicts with" goes both ways, so the reverse link counts as the same one.
    const [a, b] = r.type === 'conflicts-with' && r.toId < r.fromId ? [r.toId, r.fromId] : [r.fromId, r.toId];
    const key = `${r.type}\u0000${a}\u0000${b}`;
    if (seen.has(key)) report('relation.duplicate', 'The same link exists twice.', 'relations', r.id);
    seen.add(key);
    if (!isNonEmptyText(r.createdBy) || !isTimestamp(r.createdAt))
      report('field.value', 'A link says who made it and when.', 'relations', r.id);
  }
}

function checkTimes(
  entity: { id: string; createdAt?: unknown; updatedAt?: unknown },
  map: Problem['where']['map'],
  report: Report,
) {
  if (!isTimestamp(entity.createdAt) || !isTimestamp(entity.updatedAt))
    report('field.time', 'An entry has an invalid time.', map, entity.id);
}

/**
 * Ids that appear in more than one company's workspace, including the
 * StyleCode documents that designs link to. Ids are random, so a shared id
 * means data was copied between companies, or one design is linked from two
 * (CLAUDE.md: companies' data never mix).
 */
export function sharedIds(workspaces: CompanyWorkspace[]): string[] {
  const owner = new Map<string, string>();
  const shared = new Set<string>();
  for (const ws of workspaces) {
    // Ids kept after their entity is deleted (copied quotes, deleted evidence, AI inputs) count too.
    const kept = [
      ...Object.values(ws.knowledge).flatMap((k) => k.source?.quotes.map((q) => q.sessionId) ?? []),
      ...Object.values(ws.findings).flatMap((f) => [
        ...f.evidence.flatMap((e) => (e.kind === 'deleted' ? [e.sessionId] : [])),
        ...(f.origin.kind === 'ai' ? f.origin.inputSessionIds : []),
      ]),
    ];
    const ids = new Set([
      ws.company.id,
      ...ENTITY_MAPS.flatMap((m) => Object.keys(ws[m])),
      ...Object.values(ws.designs).map((d) => d.documentId),
      ...kept,
    ]);
    for (const id of ids) {
      const seenIn = owner.get(id);
      if (seenIn !== undefined && seenIn !== ws.company.id) shared.add(id);
      owner.set(id, ws.company.id);
    }
  }
  return [...shared].sort();
}
