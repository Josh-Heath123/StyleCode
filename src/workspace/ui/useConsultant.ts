import { useEffect, useState } from 'react';
import { getSettings, saveSettings } from '../api';

export interface Consultant {
  /** The consultant's name from settings: null until they give it, undefined while it loads. */
  name: string | null | undefined;
  /** Saves the name in settings, the first time something needs it (Phase 1 brief, WP5). */
  save: (name: string) => Promise<string>;
}

/** The consultant's name, recorded with what they do: who added a finding, a link, a file. */
export function useConsultant(): Consultant {
  const [name, setName] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    getSettings().then(
      (s) => current && setName(s.consultantName),
      () => current && setName(null),
    );
    return () => {
      current = false;
    };
  }, []);
  return {
    name,
    save: async (value) => {
      const saved = await saveSettings({ consultantName: value.trim() });
      setName(saved.consultantName);
      return saved.consultantName ?? '';
    },
  };
}
