/**
 * Plain-English names for kinds, statuses, provenance and links, shared by
 * the interface and the Markdown export, so both say the same thing.
 */
import type { FindingKind, FindingStatus, Provenance, RelationType } from './types.ts';

export const KIND_LABEL: Record<FindingKind, string> = {
  'business-requirement': 'Business requirement',
  'functional-requirement': 'Functional requirement',
  'non-functional-requirement': 'Non-functional requirement',
  expectation: 'Expectation',
  objective: 'Objective',
  'operational-challenge': 'Operational challenge',
  'existing-system': 'Existing system',
  budget: 'Budget',
  performance: 'Performance',
  scalability: 'Scalability',
  security: 'Security',
  'design-preference': 'Design preference',
  constraint: 'Constraint',
  'open-question': 'Open question',
  risk: 'Risk',
  decision: 'Decision',
  'future-consideration': 'Future consideration',
};

/** Status labels. "Suggested" says it isn't agreed yet (Phase 1 brief, decision 8). */
export const STATUS_LABEL: Record<FindingStatus, string> = {
  confirmed: 'Confirmed',
  suggested: 'Suggested (not agreed yet)',
  assumption: 'Assumption',
  unresolved: 'Unresolved',
};

/** Where a finding's content comes from, kept apart from its status (vision §7). */
export function provenanceLabel(p: Provenance): string {
  switch (p.kind) {
    case 'consultant':
      return 'Entered by the consultant';
    case 'said-in-session':
      return 'Said in a session';
    case 'ai-suggested':
      return 'Suggested by the AI';
    case 'verified':
      return `Verified: ${p.source}, checked ${p.checkedOn}`;
    case 'calculated':
      return `Calculated by ${p.engine} ${p.engineVersion}`;
  }
}

/** A link, read from either end: "influences" from the source, "is influenced by" from the target. */
export const RELATION_LABEL: Record<RelationType, { from: string; to: string }> = {
  influences: { from: 'Influences', to: 'Influenced by' },
  'depends-on': { from: 'Depends on', to: 'Needed by' },
  'conflicts-with': { from: 'Conflicts with', to: 'Conflicts with' },
  refines: { from: 'Refines', to: 'Refined by' },
};

/** The record's groups, in order, with what each holds (MVP Q12; decision 8). */
export const GROUPS = [
  { key: 'confirmed', title: 'Confirmed', about: 'agreed with the client' },
  { key: 'assumptions', title: 'Assumptions', about: 'taken as true for now, to be checked' },
  { key: 'open', title: 'Open', about: 'unresolved, and every open question' },
  { key: 'suggested', title: 'Suggested', about: 'ideas, yours or the client’s, not agreed yet' },
] as const;
