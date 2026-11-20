import type { AiConfig } from '../../../ai/client';
import type { RecordSource } from '../../../ai/record';
import { getTranscriptionStatus } from '../../api';
import { classifyProvider } from '../../model/consent';
import { findingsForDesign, leftOutMessage } from '../../model/designContext';
import type { AiProcessing } from '../../model/types';
import { routeHref } from '../../routes';
import type { WorkspaceSession } from '../../session';
import { COOLING_UNTIL, coolDown, coolingText } from '../../transcription/cooling';
import { takeTurn } from '../extraction/heavySlot';

/**
 * Where the AI set up in `config` runs, for the consent rules (C6). Null when it is off. Judged by provider, address
 * and model together, as extraction judges it (an Ollama cloud model is external).
 */
export function processingOf(config: AiConfig): AiProcessing | null {
  if (config.provider === 'off') return null;
  const settings = config.providers[config.provider];
  return classifyProvider({ provider: config.provider, baseUrl: settings.baseUrl, model: settings.model });
}

/**
 * The engagement's record for the canvas AI (Workspace Phase 4, decisions 14 to 17), while one of its designs is
 * open. Everything is read from the client as it is at the moment of asking.
 */
export function canvasRecord(client: WorkspaceSession, companyId: string, engagementId: string): RecordSource {
  return {
    findings(config) {
      const processing = processingOf(config);
      if (!processing) return { findings: [], leftOut: null };
      const ws = client.getState().workspace;
      const result = findingsForDesign(ws, engagementId, processing, new Date().toISOString());
      return {
        // Each finding's statement and kind, and nothing else of it (decision 14).
        findings: result.findings.map((f) => ({ id: f.id, statement: f.statement, kind: f.kind, createdAt: f.createdAt })),
        leftOut: leftOutMessage(result.leftOut, processing),
      };
    },
    href: (findingId) => routeHref({ page: 'record', companyId, engagementId, findingId }),
    async takeTurn(config, { signal, onWait, skipCooling }) {
      // Only a model on this computer takes the heavy slot; requests to an external provider don't (decision 17).
      if (processingOf(config)?.kind !== 'local') return () => undefined;
      const release = await takeTurn(signal, (waitingFor) =>
        onWait(
          waitingFor
            ? {
                message: `Waiting: ${waitingFor === 'transcription' ? 'a transcription' : 'an AI run'} is going on this computer, and one heavy job runs at a time. The AI starts when that finishes.`,
                cooling: false,
              }
            : null,
        ),
      );
      try {
        await coolDown({
          read: async () => (await getTranscriptionStatus()).temperatureC,
          skip: skipCooling,
          signal,
          onCooling: (temperatureC) =>
            onWait(temperatureC === null ? null : { message: `${coolingText(temperatureC)}. ${COOLING_UNTIL}`, cooling: true }),
        });
      } catch (error) {
        release();
        throw error;
      }
      return release;
    },
  };
}
