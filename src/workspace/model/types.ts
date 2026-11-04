/**
 * The consulting workspace's domain model (docs/spec/DOMAIN-MODEL.md).
 *
 * Plain data only: no React, no DOM, no storage. Like the design document in
 * `src/model`, entities live in flat maps keyed by id, and untrusted data is
 * validated before use (`validate.ts`).
 *
 * The unit is one company's workspace: the company and everything that belongs
 * to it. Every reference inside a workspace must resolve inside the same
 * workspace, which is how "companies' data never mix" is checked.
 */

/** An ISO 8601 date and time in UTC, such as "2026-11-04T09:30:00.000Z". */
export type Timestamp = string;
/** A calendar date, such as "2026-11-04". */
export type CalendarDate = string;

/** Who did something. The AI is named by provider and model, so its work is never mistaken for the consultant's. */
export type Actor = { kind: 'consultant'; name: string } | { kind: 'ai'; provider: string; model: string };

/** Who did something, and when. */
export interface Stamp {
  by: Actor;
  at: Timestamp;
}

// ---------------------------------------------------------------------------
// Findings: kinds, status and provenance
// ---------------------------------------------------------------------------

/** What a finding is about (vision §2). */
export const FINDING_KINDS = [
  'business-requirement',
  'functional-requirement',
  'non-functional-requirement',
  'expectation',
  'objective',
  'operational-challenge',
  'existing-system',
  'budget',
  'performance',
  'scalability',
  'security',
  'design-preference',
  'constraint',
  'open-question',
  'risk',
  'decision',
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/**
 * How settled a finding is (vision §2). Separate from provenance: a client can
 * say something that is still only an assumption, and the consultant can
 * confirm something the AI suggested.
 */
export const FINDING_STATUSES = ['confirmed', 'suggested', 'assumption', 'unresolved'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/**
 * Where a finding's content comes from (vision §7).
 * - said-in-session: someone said it in a session; its evidence cites at least one transcript segment
 * - consultant: entered by the consultant, from their own knowledge or notes
 * - verified: verified technical information, from a named source checked on a date (technology catalogue, later)
 * - calculated: computed by a deterministic engine (cost engine, later)
 * - ai-suggested: inferred by the AI; nobody said it
 *
 * Whether the AI *proposed* a finding is recorded separately, in `origin`.
 */
export type Provenance =
  | { kind: 'said-in-session' }
  | { kind: 'consultant' }
  | { kind: 'verified'; source: string; url: string | null; checkedOn: CalendarDate }
  | { kind: 'calculated'; engine: string; engineVersion: string }
  | { kind: 'ai-suggested' };
export type ProvenanceKind = Provenance['kind'];
export const PROVENANCE_KINDS: readonly ProvenanceKind[] = [
  'said-in-session',
  'consultant',
  'verified',
  'calculated',
  'ai-suggested',
];

/** Provenances the AI may give a finding it proposes. It never supplies verified or calculated information. */
export const AI_PROVENANCES: readonly ProvenanceKind[] = ['said-in-session', 'ai-suggested'];

/**
 * A passage a finding rests on: words quoted from a transcript segment or a
 * note. A passage deleted after the client withdrew consent (CONSENT.md, rule
 * C8) becomes `deleted`: its words are gone, and only the fact that the
 * finding rested on something from that session is kept.
 */
export type Evidence =
  | { kind: 'segment'; segmentId: string; quote: string }
  | { kind: 'note'; noteId: string; quote: string }
  | { kind: 'deleted'; sessionId: string; deletedAt: Timestamp };

/** The consultant's decision on an AI proposal. Only accepted proposals are part of the record. */
export type Review =
  { state: 'pending' } | { state: 'accepted'; by: string; at: Timestamp } | { state: 'rejected'; by: string; at: Timestamp };

/** What the AI proposed, kept unchanged so it stays visible what the consultant edited (Phase 2 evaluation). */
export interface ProposedFinding {
  kind: FindingKind;
  statement: string;
  status: FindingStatus;
  evidence: Evidence[];
}

/**
 * Where the AI processing ran (docs/spec/CONSENT.md, rule C6). Local means a
 * model on this computer; anything else is external, named as on the consent
 * form, for example "Anthropic (api.anthropic.com)".
 */
export type AiProcessing = { kind: 'local' } | { kind: 'external'; provider: string };

/** How a finding entered the workspace. */
export type FindingOrigin =
  | { kind: 'consultant'; by: string; at: Timestamp }
  | {
      kind: 'ai';
      provider: string;
      model: string;
      processing: AiProcessing;
      /** Every session whose transcript or notes the AI was given, cited or not (CONSENT.md, rule C5). */
      inputSessionIds: string[];
      at: Timestamp;
      proposed: ProposedFinding;
      review: Review;
    };

/** The fields of a finding whose changes are recorded (MVP 6.2 and 7.1). */
export const TRACKED_FIELDS = ['kind', 'statement', 'status', 'evidence'] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

/**
 * One change to a finding, by the consultant (the AI never changes a finding
 * after proposing it). Replaying the history from the AI's proposal, or from
 * the first value for the consultant's own findings, gives the current values.
 */
export type FindingChange = {
  [F in TrackedField]: { field: F; from: Finding[F]; to: Finding[F]; by: string; at: Timestamp };
}[TrackedField];

export interface Finding {
  id: string;
  engagementId: string;
  kind: FindingKind;
  statement: string;
  status: FindingStatus;
  /** Who set the current status, and when. A confirmed status is always set by the consultant. */
  statusSet: Stamp;
  provenance: Provenance;
  evidence: Evidence[];
  origin: FindingOrigin;
  /** Every change to kind, statement, status or evidence, oldest first. Empty while a proposal is under review. */
  history: FindingChange[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const RELATION_TYPES = ['influences', 'depends-on', 'conflicts-with', 'refines'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/** A directed link between two findings of the same engagement: "from influences to". */
export interface FindingRelation {
  id: string;
  type: RelationType;
  fromId: string;
  toId: string;
  createdBy: string;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Company, engagements, sessions
// ---------------------------------------------------------------------------

export interface Company {
  id: string;
  name: string;
  industry: string;
  /** What the company does. */
  description: string;
  existingSystems: string;
  notes: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Something known about the company that carries across engagements (vision §3).
 * Modelled now; the interface for it comes after extraction (MVP Q3).
 */
export interface CompanyFact {
  id: string;
  statement: string;
  kind: FindingKind;
  provenance: Provenance;
  /** Where it was promoted from, or null if the consultant entered it directly. */
  source: FactSource | null;
  createdBy: string;
  createdAt: Timestamp;
}

/**
 * A copy of the finding a fact was promoted from, so the fact outlives it:
 * deleting the finding, its session or its engagement only turns the link
 * into "source deleted".
 */
export interface FactSource {
  /** The finding, or null once it has been deleted. */
  findingId: string | null;
  /** When the finding was deleted; set exactly when `findingId` is null. */
  deletedAt: Timestamp | null;
  engagementName: string;
  /** The finding's statement when it was promoted. */
  statement: string;
  /** Its evidence when it was promoted. */
  quotes: FactQuote[];
}

export interface FactQuote {
  text: string;
  /** The session it was said or written in, so it can be removed if that session's transcript is deleted. */
  sessionId: string;
  sessionTitle: string;
  /** The speaker label of a transcript segment; null for a note. */
  speakerLabel: string | null;
}

export type EngagementStatus = { state: 'active' } | { state: 'ended'; endedOn: CalendarDate };

export interface Engagement {
  id: string;
  companyId: string;
  name: string;
  goal: string;
  status: EngagementStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A StyleCode design attached to an engagement, stored in its company's folder (ADR-0007). */
export interface DesignLink {
  id: string;
  engagementId: string;
  name: string;
  /** The StyleCode document's id. */
  documentId: string;
  createdAt: Timestamp;
}

export interface Session {
  id: string;
  engagementId: string;
  title: string;
  startsAt: Timestamp;
  /** Audio recordings of the session (Phase 3): FileRefs owned by this session. */
  audioFileIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type Side = 'client' | 'consultant';

export interface Participant {
  id: string;
  sessionId: string;
  name: string;
  role: string;
  organisation: string;
  side: Side;
  /** The transcript's speaker labels that are this person. A label belongs to at most one participant. */
  speakerLabels: string[];
}

// ---------------------------------------------------------------------------
// Transcripts and notes
// ---------------------------------------------------------------------------

export const TRANSCRIPT_PLATFORMS = ['teams', 'zoom', 'meet', 'other'] as const;
export type TranscriptPlatform = (typeof TRANSCRIPT_PLATFORMS)[number];

/** Where a transcript came from. Recording (Phase 3) will add `{ kind: 'recording'; audioFileId }`. */
export type TranscriptSource =
  { kind: 'file'; fileName: string; format: 'vtt' | 'docx'; platform: TranscriptPlatform } | { kind: 'pasted' };

/** A session's transcript (one per session, MVP Q10). Its segments are kept exactly as imported (MVP Q9). */
export interface Transcript {
  id: string;
  sessionId: string;
  source: TranscriptSource;
  importedBy: string;
  importedAt: Timestamp;
  /**
   * Speaker labels that, when the transcript was imported, matched neither a
   * client participant who was asked for consent nor someone on the
   * consultant's side (CONSENT.md, rule C11). Kept as a warning.
   */
  unaskedSpeakers: string[];
  /** Whether some segments had no speaker label, so they couldn't be checked. */
  unnamedSpeakers: boolean;
}

export interface TranscriptSegment {
  id: string;
  transcriptId: string;
  /** Position in the transcript, from 0, without gaps. */
  index: number;
  /** The label the source gives the speaker, or null if it gives none. */
  speakerLabel: string | null;
  /** Milliseconds from the start of the meeting, where the source provides them. */
  startMs: number | null;
  endMs: number | null;
  text: string;
  /** 0 to 1, where the source provides it (local transcription, later). */
  confidence: number | null;
}

export interface Note {
  id: string;
  sessionId: string;
  text: string;
  /** When it was written. Shown as a time of day and as the time since the session started. */
  writtenAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** What a file is attached to. */
export type FileOwner =
  { kind: 'company' } | { kind: 'engagement'; engagementId: string } | { kind: 'session'; sessionId: string };

/**
 * What a file is for: a document the consultant added, a session's audio
 * recording (Phase 3), or a signed form or email attached to a consent record.
 */
export const FILE_PURPOSES = ['document', 'audio', 'consent-attachment'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/** A file kept in the workspace, stored in its company's folder by id (ADR-0006). */
export interface FileRef {
  id: string;
  owner: FileOwner;
  purpose: FilePurpose;
  name: string;
  mediaType: string;
  sizeBytes: number;
  addedBy: string;
  addedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Consent (ADR-0003; fields from the Phase 0 brief, WP5 refines them)
// ---------------------------------------------------------------------------

export type ConsentMethod = { kind: 'verbal-at-start' } | { kind: 'written-before' } | { kind: 'other'; description: string };

/** What the client was told, one flag per statement shown on the form. */
export interface ConsentTold {
  recorded: boolean;
  transcribed: boolean;
  aiExtraction: boolean;
  processingLocation: boolean;
  retention: boolean;
  canStopOrDelete: boolean;
}

/** What the client agreed to. */
export interface ConsentGiven {
  audioRecording: boolean;
  transcription: boolean;
  aiLocal: boolean;
  aiExternal: boolean;
  /** The external AI provider named to the client. Required when `aiExternal` is true. */
  externalProvider: string | null;
}

export type Retention =
  { kind: 'days'; days: number } | { kind: 'until-engagement-ends' } | { kind: 'delete-after-transcription' };

export type ConsentOutcome = { kind: 'given' } | { kind: 'limited'; limits: string } | { kind: 'declined' };

/** A dated change to a locked consent record. Amendments are added, never edited or removed. */
export type ConsentAmendment =
  | {
      id: string;
      kind: 'change';
      by: string;
      at: Timestamp;
      reason: string;
      given?: Partial<ConsentGiven>;
      retention?: Retention;
      outcome?: ConsentOutcome;
    }
  | { id: string; kind: 'withdrawal'; by: string; at: Timestamp; reason: string };

export interface ConsentRecord {
  id: string;
  sessionId: string;
  /** Client participants of the session who were asked. */
  askedParticipantIds: string[];
  askedBy: string;
  method: ConsentMethod;
  /** The version of the wording shown on the form, so the record says exactly what the client was told. */
  wordingVersion: string;
  told: ConsentTold;
  given: ConsentGiven;
  retention: Retention;
  outcome: ConsentOutcome;
  /** "I asked for consent as recorded above". Until confirmed, the record is a draft and allows nothing. */
  confirmed: { by: string; at: Timestamp } | null;
  attachmentFileId: string | null;
  /** Set when recording starts or a transcript is imported. After that, changes are amendments. */
  lockedAt: Timestamp | null;
  amendments: ConsentAmendment[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// The workspace
// ---------------------------------------------------------------------------

export const WORKSPACE_FORMAT = 'stylecode-workspace';
/** 1: the first version of the domain model (Phase 0). */
export const WORKSPACE_VERSION = 1;

/** One company and everything that belongs to it. */
export interface CompanyWorkspace {
  format: typeof WORKSPACE_FORMAT;
  version: number;
  company: Company;
  knowledge: Record<string, CompanyFact>;
  engagements: Record<string, Engagement>;
  designs: Record<string, DesignLink>;
  sessions: Record<string, Session>;
  participants: Record<string, Participant>;
  consents: Record<string, ConsentRecord>;
  transcripts: Record<string, Transcript>;
  segments: Record<string, TranscriptSegment>;
  notes: Record<string, Note>;
  files: Record<string, FileRef>;
  findings: Record<string, Finding>;
  relations: Record<string, FindingRelation>;
}

/** The entity maps of a workspace, by name. */
export const ENTITY_MAPS = [
  'knowledge',
  'engagements',
  'designs',
  'sessions',
  'participants',
  'consents',
  'transcripts',
  'segments',
  'notes',
  'files',
  'findings',
  'relations',
] as const;
export type EntityMap = (typeof ENTITY_MAPS)[number];
