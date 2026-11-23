/**
 * The consent form's wording, by version (docs/spec/CONSENT.md, "Wording shown
 * to the client"). Each record keeps the version it was shown with, so the
 * record, and the export (rule C9), say exactly what the client heard.
 *
 * Draft wording: it must be reviewed by someone qualified in POPIA before
 * real use. Never change a version's text; add a new version instead.
 *
 * - draft-1: the first wording (Workspace Phase 1).
 * - draft-2: draft-1's statements, unchanged, and `aiDesign` (Workspace Phase 4, decision 13).
 */
import { CONSENT_STATEMENTS, type ConsentStatement, type Retention } from './types.ts';

export const CURRENT_WORDING = 'draft-2';

export interface Wording {
  /** The statements this version has, in the form's order. */
  statements: readonly ConsentStatement[];
  /**
   * The statement as said or sent to the client, with the provider and retention the record names, or null for a
   * statement this version doesn't have.
   */
  statement(statement: ConsentStatement, context: { provider: string | null; retention: Retention }): string | null;
}

function retentionText(retention: Retention): string {
  switch (retention.kind) {
    case 'days':
      return `for ${retention.days} ${retention.days === 1 ? 'day' : 'days'}`;
    case 'until-engagement-ends':
      return 'until the project ends';
    case 'delete-after-transcription':
      return "only until it's transcribed";
  }
}

/** Draft-1's text for each of its statements. */
function draft1(statement: Exclude<ConsentStatement, 'aiDesign'>, provider: string | null, retention: Retention): string {
  switch (statement) {
    case 'recorded':
      return "I'd like to record the audio of this meeting.";
    case 'transcribed':
      return 'What we say will be turned into a written transcript, by the meeting software or on my computer.';
    case 'aiExtraction':
      return "I'll use AI to help pick out requirements, questions and risks from the transcript and my notes. I check everything it suggests.";
    case 'processingLocal':
      return 'The AI runs on my computer only; nothing is sent elsewhere.';
    case 'processingExternal':
      return `The transcript and my notes may be sent to ${provider ?? '[provider]'}, which processes them under its own terms, possibly outside South Africa.`;
    case 'retention':
      return `The recording is kept ${retentionText(retention)}. The transcript and my notes are kept with the project's records.`;
    case 'canStopOrDelete':
      return 'You can ask me to stop recording at any time, and ask me to delete the recording and the transcript.';
  }
}

const DRAFT_1: Wording = {
  statements: CONSENT_STATEMENTS.filter((s) => s !== 'aiDesign'),
  statement: (statement, { provider, retention }) => (statement === 'aiDesign' ? null : draft1(statement, provider, retention)),
};

const DRAFT_2: Wording = {
  statements: CONSENT_STATEMENTS,
  statement: (statement, { provider, retention }) =>
    statement === 'aiDesign'
      ? 'I may also use AI to help sketch the screens from what we agree. It sees my summary of what you said, not the recording or the transcript.'
      : draft1(statement, provider, retention),
};

const WORDINGS: Record<string, Wording> = { 'draft-1': DRAFT_1, 'draft-2': DRAFT_2 };

/** A version's wording, or null for a version this StyleCode doesn't know. */
export function wordingFor(version: string): Wording | null {
  return Object.prototype.hasOwnProperty.call(WORDINGS, version) ? WORDINGS[version] : null;
}
