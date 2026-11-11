/**
 * The evaluation set's files (`eval/README.md`). Plain data, so the scorer
 * and the recorded runs can be read without the app.
 */
import type { FindingKind, FindingStatus } from '../src/workspace/model/types.ts';

/** `consultation.json`: where a consultation's transcript comes from and when the meeting was. */
export interface Consultation {
  title: string;
  startsAt: string;
  timeZone: string;
  /** The platform export, relative to the consultation's folder. */
  source: string;
  /** Who is who, so the AI is told each speaker's side, as the app tells it. */
  participants: { name: string; side: 'client' | 'consultant' }[];
}

export interface EvalSegment {
  id: string;
  /** The turn it is part of: consecutive segments by one speaker, numbered T1, T2… */
  turn: string;
  speakerLabel: string | null;
  startMs: number | null;
  endMs: number | null;
  text: string;
}

/** `transcript.json`, made from the export by the WP2 importer (`npm run eval:build`). */
export interface EvalTranscript {
  consultation: string;
  title: string;
  startsAt: string;
  timeZone: string;
  source: { fileName: string; layout: string };
  segments: EvalSegment[];
}

export interface KeyFinding {
  id: string;
  kind: FindingKind;
  status: FindingStatus;
  statement: string;
  /** The turns that support it, as written. */
  turns: string[];
  /** The same as segment ids, filled in from `turns` by `npm run eval:build`. */
  segments: string[];
  /** Other kinds a careful consultant could reasonably choose; a match on any of them counts. */
  alsoAccept?: FindingKind[];
  note?: string;
}

/** `answer-key.json`: the findings a careful consultant would record. */
export interface AnswerKey {
  meeting: string;
  status: string;
  notes?: string[];
  findings: KeyFinding[];
  notFindings?: { turns: string[]; segments?: string[]; why: string }[];
}

/** A proposal as the model wrote it, after merging chunks and before StyleCode's checks. */
export interface RunProposal {
  kind: string;
  status: string;
  statement: string;
  evidence: { segmentId: string; quote: string }[];
}

/** `eval/runs/<model>/<consultation>.json`: one extraction run, recorded. */
export interface RecordedRun {
  consultation: string;
  provider: string;
  model: string;
  /** The prompt's version (`EXTRACTION_PROMPT_VERSION`), so runs with different prompts aren't compared as one. */
  promptVersion: string;
  contextSize: number;
  chunks: number;
  startedAt: string;
  durationMs: number;
  /** Replies that weren't valid JSON, by chunk. */
  unreadableReplies: number;
  hardware?: string;
  /** Ollama's `think` as sent: false (what the app sends), true, or left out ("default"). */
  think?: boolean | 'default';
  /** True when the run kept the model off the GPU (`--cpu`). */
  cpuOnly?: boolean;
  /** The reply limit per part, when it isn't the app's 3000 tokens. */
  maxTokens?: number;
  /** For a run on an engine's transcript (Phase 3): the transcript and translated key it was scored against, relative to `eval/`. */
  transcriptFile?: string;
  keyFile?: string;
  proposals: RunProposal[];
}
