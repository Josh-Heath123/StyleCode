import {
  ENTITY_MAPS,
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  type Company,
  type CompanyWorkspace,
  type Timestamp,
} from './types.ts';
import { createId, currentTimeZone, fail, isNonEmptyText, ok, type Result } from './util.ts';
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

/** The company profile fields the consultant edits (MVP story 1.1). */
export const PROFILE_FIELDS = ['name', 'industry', 'description', 'existingSystems', 'notes'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/**
 * Changes the company's profile. The name is trimmed and can't be empty;
 * whether another company has it is checked by the caller, against every
 * company on disk (`isCompanyNameFree`). Returns the same workspace when
 * nothing changes, so no empty step is recorded.
 */
export function editCompany(
  ws: CompanyWorkspace,
  changes: Partial<Record<ProfileField, string>>,
  at: Timestamp,
): Result<CompanyWorkspace> {
  const next = { ...ws.company };
  let changed = false;
  for (const field of PROFILE_FIELDS) {
    const value = changes[field];
    if (value === undefined) continue;
    const text = field === 'name' ? value.trim() : value;
    if (field === 'name' && !text) return fail('Give the company a name.');
    if (text === next[field]) continue;
    next[field] = text;
    changed = true;
  }
  if (!changed) return ok(ws);
  return ok({ ...ws, company: { ...next, updatedAt: at } });
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
 * Brings a workspace from an older version up to this one, one version at a
 * time (DOMAIN-MODEL.md, "Versioning"). Entries it can't read are left as
 * they are, for the checks to report.
 *
 * - 1 to 2: each session gets `timeZone`, the computer's zone at migration
 *   (the zone it was most likely created in). The `txt` source format needs
 *   no change.
 */
function migrate(raw: Record<string, unknown>, timeZone: string): Record<string, unknown> {
  let ws = raw;
  if (ws.version === 1) {
    const sessions = ws.sessions;
    ws = {
      ...ws,
      version: 2,
      sessions:
        sessions && typeof sessions === 'object' && !Array.isArray(sessions)
          ? Object.fromEntries(
              Object.entries(sessions as Record<string, unknown>).map(([id, s]) => [
                id,
                s && typeof s === 'object' && !Array.isArray(s) && !('timeZone' in s) ? { ...s, timeZone } : s,
              ]),
            )
          : sessions,
    };
  }
  return ws;
}

/**
 * Reads untrusted workspace data (from disk, or an import), migrating an
 * older version first. Nothing is repaired: a workspace with problems opens
 * read-only, and is never saved as it is.
 *
 * `timeZone` is the zone a version 1 workspace's sessions are given; it
 * defaults to the computer's.
 */
export function parseWorkspace(input: unknown, options: { timeZone?: string } = {}): ParseWorkspaceResult {
  const refuse = (error: string): ParseWorkspaceResult => ({ ok: false, error });
  if (!input || typeof input !== 'object') return refuse('This is not a StyleCode workspace.');
  let raw = input as Record<string, unknown>;
  if (raw.format !== WORKSPACE_FORMAT) return refuse('This is not a StyleCode workspace.');
  if (typeof raw.version !== 'number') return refuse('The workspace has no version.');
  if (raw.version > WORKSPACE_VERSION)
    return refuse(
      `This workspace was saved by a newer version of StyleCode (version ${raw.version}). Update StyleCode to open it.`,
    );
  if (raw.version < 1 || !Number.isInteger(raw.version)) return refuse(`Unsupported workspace version ${raw.version}.`);
  if (!raw.company || typeof raw.company !== 'object' || Array.isArray(raw.company))
    return refuse('The workspace has no company.');

  raw = migrate(raw, options.timeZone ?? currentTimeZone());

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
  return { ok: true, access: 'editable', workspace: raw as unknown as CompanyWorkspace, problems: [] };
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
