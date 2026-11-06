import { useEffect, useState } from 'react';
import { getAiConfig } from '../../../ai/client';
import { getSettings, saveSettings } from '../../api';
import { classifyProvider } from '../../model/consent';

export interface ConsentContext {
  /** The consultant's name from settings, or null until they give it. */
  consultant: string | null;
  /**
   * The external AI provider set up in AI settings, named as the form offers
   * it (rule C6), or null when AI is off or runs on this computer.
   */
  externalProvider: string | null;
  /** Saves the consultant's name in settings, the first time the form needs it. */
  saveConsultant: (name: string) => Promise<string>;
}

/** What the consent form needs from outside the client: who is asking, and which external provider there is. */
export function useConsentContext(): ConsentContext | null {
  const [context, setContext] = useState<Omit<ConsentContext, 'saveConsultant'> | null>(null);
  useEffect(() => {
    let current = true;
    void Promise.all([
      getSettings().catch(() => ({ consultantName: null })),
      // AI is optional: without its server or settings, there is simply no external provider.
      getAiConfig().catch(() => null),
    ]).then(([settings, ai]) => {
      if (!current) return;
      let externalProvider: string | null = null;
      if (ai && ai.provider !== 'off') {
        const processing = classifyProvider({ provider: ai.provider, baseUrl: ai.providers[ai.provider].baseUrl });
        if (processing.kind === 'external') externalProvider = processing.provider;
      }
      setContext({ consultant: settings.consultantName, externalProvider });
    });
    return () => {
      current = false;
    };
  }, []);
  if (!context) return null;
  return {
    ...context,
    saveConsultant: async (name) => {
      const saved = await saveSettings({ consultantName: name.trim() });
      setContext((c) => (c ? { ...c, consultant: saved.consultantName } : c));
      return saved.consultantName ?? '';
    },
  };
}
