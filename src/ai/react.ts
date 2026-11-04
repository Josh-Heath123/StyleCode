import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Assistant, AssistantState } from './assistant';

export const AssistantContext = createContext<Assistant | null>(null);

export function useAssistant(): Assistant {
  const assistant = useContext(AssistantContext);
  if (!assistant) throw new Error('useAssistant must be used inside <AssistantContext.Provider>');
  return assistant;
}

/** The assistant's state; components re-render when it changes. */
export function useAssistantState(): AssistantState {
  const assistant = useAssistant();
  return useSyncExternalStore(assistant.subscribe, assistant.getState, assistant.getState);
}
