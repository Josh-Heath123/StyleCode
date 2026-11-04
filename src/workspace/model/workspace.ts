import { ENTITY_MAPS, WORKSPACE_FORMAT, WORKSPACE_VERSION, type Company, type CompanyWorkspace, type Timestamp } from './types';
import { createId, isNonEmptyText } from './util';
import { validateWorkspace, type Problem } from './validate';

/** Prefixes for new ids, so an id says what it is when it turns up in a log or a test. */
export const ID_PREFIX = {
  company: 'co',
  knowledge: 'kf',
  engagements: 'en',
  designs: 'de',
  sessions: 'se',
  participants: 'pa',
  consents: 'cr',
  amendment: 'am',
  transcripts: 'tr',
  segments: 'sg',
  notes: 'no',
  files: 'fi',
  findings: 'fd',
  relations: 're',
} as const;

/** A new, empty workspace for a company. */
export function createWorkspace(
  profile: Pick<Company, 'name'> & Partial<Omit<Company, 'id' | 'createdAt' | 'updatedAt'>>,
  at: Timestamp,
): CompanyWorkspace {
  const company: Company = {
    id: createId(ID_PREFIX.company),
    name: profile.name.trim(),
    industry: profile.industry ?? '',
    description: profile.description ?? '',
    existingSystems: profile.existingSystems ?? '',
    notes: profile.notes ?? '',
    createdAt: at,
    updatedAt: at,
  };
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    company,
    knowledge: {},
    engagements: {},
    designs: {},
    sessions: {},
    participants: {},
    consents: {},
    transcripts: {},
    segments: {},
    notes: {},
    files: {},
    findings: {},
    relations: {},
  };
}

/**
 * Whether a new company name is free: names must differ from every other
 * company's, ignoring case and surrounding spaces (MVP Q4).
 */
export function isCompanyNameFree(name: string, existing: readonly string[]): boolean {
  if (!isNonEmptyText(name)) return false;
  const key = name.trim().toLocaleLowerCase();
  return !existing.some((other) => other.trim().toLocaleLowerCase() === key);
}

export type ParseWorkspaceResult = { ok: true; workspace: CompanyWorkspace } | { ok: false; error: string; problems: Problem[] };

/**
 * Reads untrusted workspace data (from disk, or an import). Rejects data from a
 * newer version, and data with any problem; nothing is silently repaired.
 * Version 1 is the first, so there are no migrations yet.
 */
export function parseWorkspace(input: unknown): ParseWorkspaceResult {
  const fail = (error: string, problems: Problem[] = []): ParseWorkspaceResult => ({ ok: false, error, problems });
  if (!input || typeof input !== 'object') return fail('This is not a StyleCode workspace.');
  const raw = input as Record<string, unknown>;
  if (raw.format !== WORKSPACE_FORMAT) return fail('This is not a StyleCode workspace.');
  if (typeof raw.version !== 'number') return fail('The workspace has no version.');
  if (raw.version > WORKSPACE_VERSION)
    return fail(
      `This workspace was saved by a newer version of StyleCode (version ${raw.version}). Update StyleCode to open it.`,
    );
  if (raw.version < 1) return fail(`Unsupported workspace version ${raw.version}.`);
  if (!raw.company || typeof raw.company !== 'object') return fail('The workspace has no company.');
  for (const map of ENTITY_MAPS) {
    const value = raw[map];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`The workspace's ${map} are missing.`);
    if (Object.values(value).some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
      return fail(`The workspace's ${map} are invalid.`);
    }
  }
  const workspace = input as CompanyWorkspace;
  const problems = validateWorkspace(workspace);
  if (problems.length)
    return fail(`The workspace has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}.`, problems);
  return { ok: true, workspace };
}
