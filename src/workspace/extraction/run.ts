/**
 * Running an extraction: each part of a session sent in turn, with progress,
 * and the replies read and merged. How a part is sent is the caller's: the
 * app sends it through the local AI server after checking consent for that
 * exact request (rule C5), and the evaluation runner (`eval/run.ts`) sends it
 * straight to a provider. Cancelling stops at once; the caller saves nothing.
 */
import { chunkPassages, extractionMessage, extractionSchema, extractionSystemPrompt, type Passage } from './prompt.ts';
import { readReply, type RawProposal } from './proposals.ts';

/** One request: the instructions, the part's message and the reply's schema. Returns the reply's text. */
export type SendPart = (
  request: { system: string; message: string; schema: Record<string, unknown> },
  signal: AbortSignal,
) => Promise<string>;

export interface ExtractionProgress {
  /** The part being sent, from 1. */
  part: number;
  parts: number;
}

export interface Extraction {
  raw: RawProposal[];
  parts: number;
  /** Parts whose reply wasn't the JSON asked for. */
  unreadable: number;
}

export async function extract(options: {
  title: string;
  passages: readonly Passage[];
  contextSize: number;
  send: SendPart;
  signal: AbortSignal;
  onProgress?: (progress: ExtractionProgress) => void;
}): Promise<Extraction> {
  const { title, passages, contextSize, send, signal, onProgress } = options;
  const chunks = chunkPassages(title, passages, contextSize);
  const system = extractionSystemPrompt();
  const schema = extractionSchema();
  const raw: RawProposal[] = [];
  let unreadable = 0;
  for (const chunk of chunks) {
    signal.throwIfAborted();
    onProgress?.({ part: chunk.index + 1, parts: chunks.length });
    const reply = await send({ system, message: extractionMessage(title, chunk), schema }, signal);
    signal.throwIfAborted();
    const read = readReply(reply, passages);
    if (read) raw.push(...read);
    else unreadable++;
  }
  return { raw, parts: chunks.length, unreadable };
}
