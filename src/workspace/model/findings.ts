/**
 * Findings: review of AI proposals, status changes and the engagement's record.
 * Every function is pure and returns a new finding, so the caller can make it
 * an undoable step.
 */
import type { CompanyWorkspace, Finding, FindingStatus, Timestamp } from './types';
import { fail, ok, type Result } from './util';

/** Whether a finding is part of the record: entered by the consultant, or proposed by the AI and accepted. */
export function isInRecord(finding: Finding): boolean {
  return finding.origin.kind === 'consultant' || finding.origin.review.state === 'accepted';
}

/** Whether a finding is an AI proposal still waiting for the consultant. */
export function isPending(finding: Finding): boolean {
  return finding.origin.kind === 'ai' && finding.origin.review.state === 'pending';
}

/**
 * Accepts an AI proposal. The consultant chooses the status as they accept it
 * (MVP story 6.2); that is the only way an AI proposal becomes confirmed.
 */
export function acceptProposal(
  finding: Finding,
  consultant: string,
  at: Timestamp,
  status: FindingStatus = finding.status,
): Result<Finding> {
  if (!isPending(finding) || finding.origin.kind !== 'ai') return fail('Only a pending AI proposal can be accepted.');
  if (!consultant.trim()) return fail('Accepting needs the consultant’s name.');
  return ok({
    ...finding,
    status,
    statusSet: { by: { kind: 'consultant', name: consultant }, at },
    origin: { ...finding.origin, review: { state: 'accepted', by: consultant, at } },
    updatedAt: at,
  });
}

/** Rejects an AI proposal. It is kept, hidden, so it isn't proposed again (MVP Q11). */
export function rejectProposal(finding: Finding, consultant: string, at: Timestamp): Result<Finding> {
  if (!isPending(finding) || finding.origin.kind !== 'ai') return fail('Only a pending AI proposal can be rejected.');
  if (!consultant.trim()) return fail('Rejecting needs the consultant’s name.');
  return ok({ ...finding, origin: { ...finding.origin, review: { state: 'rejected', by: consultant, at } }, updatedAt: at });
}

/** The consultant changes the status of a finding in the record, recording who and when. */
export function setStatus(finding: Finding, status: FindingStatus, consultant: string, at: Timestamp): Result<Finding> {
  if (!isInRecord(finding)) return fail('Review the proposal before changing its status.');
  if (!consultant.trim()) return fail('Changing the status needs the consultant’s name.');
  return ok({ ...finding, status, statusSet: { by: { kind: 'consultant', name: consultant }, at }, updatedAt: at });
}

/** The engagement's record, grouped as in MVP Q12. */
export interface RecordGroups {
  /** Status confirmed (and not an open question). */
  confirmed: Finding[];
  /** Status assumption (and not an open question). */
  assumptions: Finding[];
  /** Status unresolved, or kind open question whatever its status. */
  open: Finding[];
  /** Status suggested (and not an open question). Q12 doesn't place these yet. */
  suggested: Finding[];
}

export function recordGroups(ws: CompanyWorkspace, engagementId: string): RecordGroups {
  const groups: RecordGroups = { confirmed: [], assumptions: [], open: [], suggested: [] };
  const findings = Object.values(ws.findings)
    .filter((f) => f.engagementId === engagementId && isInRecord(f))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const f of findings) {
    if (f.kind === 'open-question' || f.status === 'unresolved') groups.open.push(f);
    else if (f.status === 'confirmed') groups.confirmed.push(f);
    else if (f.status === 'assumption') groups.assumptions.push(f);
    else groups.suggested.push(f);
  }
  return groups;
}
