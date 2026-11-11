/**
 * Which parts of a session a run that didn't finish read (Phase 2, WP7):
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

function read(): Record<string, Coverage> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Coverage>) : {};
  } catch {
    return {};
  }
}

function write(all: Record<string, Coverage>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Without storage, the coverage shows only until the page is reloaded.
  }
}

/** What the session's last unfinished run read, if it is still kept. */
export function coverageOf(companyId: string, sessionId: string): Coverage | null {
  const c = read()[keyOf(companyId, sessionId)];
  return c && typeof c.at === 'string' && c.partsDone > 0 && c.parts > c.partsDone ? c : null;
}

/** Keeps what an unfinished run read, or with null (a run finished, or another started) lets it go. */
export function setCoverage(companyId: string, sessionId: string, coverage: Coverage | null): void {
  const all = read();
  const key = keyOf(companyId, sessionId);
  if (coverage) all[key] = coverage;
  else if (key in all) delete all[key];
  else return;
  write(all);
}
