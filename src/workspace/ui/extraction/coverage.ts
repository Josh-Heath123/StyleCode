/**
 * Which parts of a session the runs that didn't finish read (Phase 2, WP7):
 * kept in this browser, like the time estimates, so "parts 1 to 4 of 7"
 * still shows after a reload, until that run's proposals are all reviewed or
 * discarded. Only ids, the run's time and part counts are kept, never
 * anything from the session.
 */
const KEY = 'stylecode.extraction-coverage';

export interface Coverage {
  companyId: string;
  sessionId: string;
  /** When the run's proposals were added (their `origin.at`): which proposals came from it. */
  at: string;
  partsDone: number;
  parts: number;
}

const keyOf = (companyId: string, sessionId: string) => `${companyId}/${sessionId}`;

const isCoverage = (c: unknown): c is Coverage => {
  const v = c as Partial<Coverage> | null;
  return (
    !!v &&
    typeof v.at === 'string' &&
    typeof v.partsDone === 'number' &&
    typeof v.parts === 'number' &&
    v.partsDone > 0 &&
    v.parts > v.partsDone
  );
};

function read(): Record<string, Coverage[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.filter(isCoverage) : []]),
    );
  } catch {
    return {};
  }
}

function write(all: Record<string, Coverage[]>): void {
  try {
    for (const k of Object.keys(all)) if (!all[k].length) delete all[k];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Without storage, the coverage shows only until the page is reloaded.
  }
}

/** What the session's unfinished runs read, oldest first. */
export function coveragesOf(companyId: string, sessionId: string): Coverage[] {
  return read()[keyOf(companyId, sessionId)] ?? [];
}

/** Keeps what an unfinished run read. */
export function addCoverage(coverage: Coverage): void {
  const all = read();
  const key = keyOf(coverage.companyId, coverage.sessionId);
  all[key] = [...(all[key] ?? []).filter((c) => c.at !== coverage.at), coverage];
  write(all);
}

/** Lets go of one run's coverage (its proposals were all reviewed or discarded), or with no time, all of the session's. */
export function clearCoverage(companyId: string, sessionId: string, at?: string): void {
  const all = read();
  const key = keyOf(companyId, sessionId);
  if (!all[key]) return;
  all[key] = at === undefined ? [] : all[key].filter((c) => c.at !== at);
  write(all);
}

/** Lets go of everything kept for a client: after it is deleted. */
export function clearCompanyCoverage(companyId: string): void {
  const all = read();
  for (const k of Object.keys(all)) if (k.startsWith(`${companyId}/`)) all[k] = [];
  write(all);
}
