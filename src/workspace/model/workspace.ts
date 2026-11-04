import {
  ENTITY_MAPS,
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  type Company,
  type CompanyWorkspace,
  type Timestamp,
} from './types.ts';
import { createId, isNonEmptyText } from './util.ts';
import { validateWorkspace, type Problem } from './validate.ts';

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

/**
 * The result of reading a workspace.
 * - `editable`: valid, and can be changed and saved.
 * - `read-only`: it has problems. It opens so the consultant can still see the
 *   client's data, with the problems listed, but it can't be saved until they
 *   are fixed. Entries that aren't readable at all are left out of the view
 *   and listed as problems; the file itself is untouched.
 * - refused (`ok: false`): not a workspace, from a newer version, or missing
 *   its company or a whole section, so there is nothing safe to show.
 */
export type ParseWorkspaceResult =
  | { ok: true; access: 'editable'; workspace: CompanyWorkspace; problems: [] }
  | { ok: true; access: 'read-only'; workspace: CompanyWorkspace; problems: Problem[] }
  | { ok: false; error: string };

/**
 * Reads untrusted workspace data (from disk, or an import). Nothing is
 * repaired: a workspace with problems opens read-only, and is never saved as
 * it is. Version 1 is the first, so there are no migrations yet.
 */
export function parseWorkspace(input: unknown): ParseWorkspaceResult {
  const refuse = (error: string): ParseWorkspaceResult => ({ ok: false, error });
  if (!input || typeof input !== 'object') return refuse('This is not a StyleCode workspace.');
  const raw = input as Record<string, unknown>;
  if (raw.format !== WORKSPACE_FORMAT) return refuse('This is not a StyleCode workspace.');
  if (typeof raw.version !== 'number') return refuse('The workspace has no version.');
  if (raw.version > WORKSPACE_VERSION)
    return refuse(
      `This workspace was saved by a newer version of StyleCode (version ${raw.version}). Update StyleCode to open it.`,
    );
  if (raw.version < 1) return refuse(`Unsupported workspace version ${raw.version}.`);
  if (!raw.company || typeof raw.company !== 'object' || Array.isArray(raw.company))
    return refuse('The workspace has no company.');

  const unreadable: Problem[] = [];
  const view: Record<string, unknown> = { ...raw };
  for (const map of ENTITY_MAPS) {
    const value = raw[map];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return refuse(`The workspace's ${map} are missing.`);
    const readable: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) readable[key] = entry;
      else
        unreadable.push({
          code: 'entry.unreadable',
          message: `An entry can't be read, so it isn't shown.`,
          where: { map, id: key },
        });
    }
    view[map] = readable;
  }

  const workspace = view as unknown as CompanyWorkspace;
  let problems: Problem[];
  try {
    problems = [...unreadable, ...validateWorkspace(workspace)];
  } catch {
    // The validator is written for any object shape; this is a last line of defence.
    return refuse('The workspace could not be read.');
  }
  if (problems.length) return { ok: true, access: 'read-only', workspace, problems };
  return { ok: true, access: 'editable', workspace: input as CompanyWorkspace, problems: [] };
}

/**
 * Checks a workspace before it is saved. A workspace with any problem is never
 * written, so a problem can't be saved over the last good copy.
 */
export function checkBeforeSave(ws: CompanyWorkspace): { ok: true } | { ok: false; error: string; problems: Problem[] } {
  const problems = validateWorkspace(ws);
  if (!problems.length) return { ok: true };
  return {
    ok: false,
    error: `The workspace can't be saved: it has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}.`,
    problems,
  };
}
