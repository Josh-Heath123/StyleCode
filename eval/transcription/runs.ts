/**
 * A recorded transcription run, as `spikes/transcription/run.ts` writes it:
 * words or speaker turns in compact arrays, with times and resources.
 */
import type { EngineWord, SpeakerTurn } from '../../src/workspace/transcription/combine.ts';

export interface RunRecord {
  kind: 'words' | 'speakers';
  run: string;
  meeting: string;
  version: 'clean' | 'hard';
  audioMs: number;
  wallMs: number;
  minutesPerHour: number;
  at: string;
  hardware: Record<string, string>;
  settings: string[];
  stages: { name: string; wallMs: number; resources: unknown }[];
  words?: EngineWord[];
  turns?: SpeakerTurn[];
}

type Compact = Omit<RunRecord, 'words' | 'turns'> & {
  words?: [string, number, number, number | null][];
  turns?: [string, number, number][];
};

export function readRun(json: unknown): RunRecord {
  const r = json as Compact;
  return {
    ...r,
    words: r.words?.map(([text, startMs, endMs, confidence]) => ({ text, startMs, endMs, confidence })),
    turns: r.turns?.map(([label, startMs, endMs]) => ({ label, startMs, endMs })),
  };
}
