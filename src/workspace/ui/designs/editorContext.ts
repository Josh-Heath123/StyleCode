import { createContext, useContext } from 'react';
import type { Editor } from '../../../editor/editor';
import type { ProjectSession } from '../../../persistence/session';

/** The one editor and its persistence, for workspace pages that open or copy designs (Phase 4). */
export const DesignEditorContext = createContext<{ editor: Editor; session: ProjectSession } | null>(null);

export function useDesignEditor(): { editor: Editor; session: ProjectSession } {
  const value = useContext(DesignEditorContext);
  if (!value) throw new Error('The design editor isn’t available here.');
  return value;
}
