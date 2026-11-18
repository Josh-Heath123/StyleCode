import { createContext, useContext, type ReactNode } from 'react';

/**
 * The engagement's record beside an engagement's design (Workspace Phase 4,
 * decisions 9 and 11), as the editor sees it. The editor holds only finding
 * ids on its layers; what they mean comes from here, as plain data the
 * workspace supplies. The editor never imports the workspace, and the
 * standalone editor has no record.
 */
export interface LinkedFinding {
  id: string;
  statement: string;
  /** The finding's kind and status, in words ("Functional requirement", "Confirmed"). */
  kind: string;
  status: string;
  /** Its status as a key, for its badge's colour. */
  statusKey: string;
  /** The record page, at this finding. */
  href: string;
}

export interface EngagementRecord {
  /** A finding linked from a layer, or null when it is no longer in the record. */
  describe(findingId: string): LinkedFinding | null;
  /** The Record panel itself. */
  panel: ReactNode;
}

export const RecordContext = createContext<EngagementRecord | null>(null);

/** The engagement's record, while an engagement's design is open; null in the standalone editor. */
export function useEngagementRecord(): EngagementRecord | null {
  return useContext(RecordContext);
}
