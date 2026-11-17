import { useSyncExternalStore } from 'react';
import { discardStoredFile, finishRecordingFile, sendRecordingPiece, startRecordingFile, WorkspaceApiError } from '../api';
import { asBytes } from '../audio/wav';
import { Resampler, peakLevel, toInt16 } from '../audio/resample';
import { canCapture } from '../model/consent';
import {
  DEFAULT_RECORDING_SETTINGS,
  finishRecording,
  MAX_RECORDING_MS,
  RECORDING_BYTES_PER_SECOND,
  RECORDING_SAMPLE_RATE,
  recordingsOf,
  startRecording,
} from '../model/recordings';
import type { RecordingSettings, Session } from '../model/types';
import { get } from '../model/util';
import type { WorkspaceSession } from '../session';
import { finalStep, now } from '../ui/steps';
import { holdCompany, onCompanyClosed } from '../ui/useCompanySession';
import workletUrl from './capture-worklet.js?url';
import {
  dueToSend,
  followSilence,
  PIECE_BYTES,
  SEND_EVERY_MS,
  SILENT_MESSAGE,
  UNSAVED_AFTER_MS,
  UNSAVED_MESSAGE,
} from './sending';

export { SILENT_MESSAGE, UNSAVED_MESSAGE };

/**
 * Recording in the room (Phase 3 brief, decisions 12 and 13), kept outside
 * any page, as an AI run is: it carries on while the consultant takes notes
 * and moves around StyleCode, holds its client open, shows on every page,
 * and closing the tab asks first.
 *
 * The microphone's sound is downsampled to 16 kHz mono 16-bit in the page and
 * sent to the local server every few seconds, which writes it to the
 * session's file as it arrives. So closing the tab, or a crash, loses at most
 * the last few seconds, and the file is already what the engines read.
 *
 * One recording at a time: there is one microphone.
 */
export interface ActiveRecording {
  companyId: string;
  sessionId: string;
  sessionTitle: string;
  /** The session page. */
  href: string;
  fileId: string;
  state: 'starting' | 'recording' | 'stopping' | 'stopped' | 'failed';
  /** Sound captured so far. */
  elapsedMs: number;
  /** The microphone's level just now, from 0 to 1. */
  level: number;
  /** Under 5 GB free when it started. */
  lowSpace: boolean;
  /**
   * The local server hasn't taken the sound for a while (closed, or the disk
   * full): it waits in the page until it can be sent.
   */
  unsaved: boolean;
  /** The microphone has given silence for a while: muted, or a device that passes nothing. */
  silent: boolean;
  /** Why it stopped by itself, or failed. */
  message: string | null;
}

const MAX_BYTES = (MAX_RECORDING_MS / 1000) * RECORDING_BYTES_PER_SECOND;

let current: ActiveRecording | null = null;
const listeners = new Set<() => void>();

function publish(changes: Partial<ActiveRecording>): void {
  if (!current) return;
  current = { ...current, ...changes };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The recording going, or the last one, since the page loaded. */
export function useRecording(): ActiveRecording | null {
  return useSyncExternalStore(subscribe, () => current);
}

export const isRecordingNow = (r: ActiveRecording | null) =>
  r?.state === 'starting' || r?.state === 'recording' || r?.state === 'stopping';

/** Clears the message of a recording that has ended, once the consultant has seen it. */
export function dismissRecording(): void {
  if (current && !isRecordingNow(current)) {
    current = null;
    listeners.forEach((l) => l());
  }
}

/** What is needed to stop the recording going, kept while it records. */
interface Live {
  stop: (message: string | null) => Promise<void>;
}
let live: Live | null = null;

/** Why the microphone couldn't be used, in words for the consultant. */
export function microphoneError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'StyleCode isn’t allowed to use the microphone. In Windows, open Settings, Privacy and security, Microphone, and turn on microphone access, including “Let desktop apps access your microphone”. In the browser, allow the microphone for this page. Then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'The microphone chosen isn’t there. Plug it in, or choose another, and try again.';
  if (name === 'NotReadableError')
    return 'Another program is using the microphone, or Windows can’t open it. Close the other program and try again.';
  return 'The microphone couldn’t be opened. Check it is plugged in and allowed, and try again.';
}

/**
 * Starts recording a session (decision 13): consent to recording is checked
 * (C1), the microphone opened with echo cancellation and noise suppression
 * off and automatic gain on (decision 12), the server makes the file, and
 * the recording is listed, which locks the consent record (C4). Returns why
 * it couldn't start, or null.
 */
export async function startRecordingSession(
  session: WorkspaceSession,
  meeting: Session,
  href: string,
  by: string,
  deviceId: string | null,
): Promise<string | null> {
  if (isRecordingNow(current)) return 'StyleCode is already recording. Stop that recording first.';
  const allowed = canCapture(session.getState().workspace, meeting.id, 'recording', now());
  if (!allowed.ok) return allowed.error;
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser can’t record. Use Chrome or Edge.';

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: DEFAULT_RECORDING_SETTINGS.echoCancellation,
        noiseSuppression: DEFAULT_RECORDING_SETTINGS.noiseSuppression,
        autoGainControl: DEFAULT_RECORDING_SETTINGS.autoGainControl,
        channelCount: 1,
      },
    });
  } catch (error) {
    return microphoneError(error);
  }
  const track = stream.getAudioTracks()[0];
  const applied = track?.getSettings() ?? {};
  // The settings the browser actually used are recorded with the file (decision 12).
  const flag = (value: unknown, otherwise: boolean) => (typeof value === 'boolean' ? value : otherwise);
  const settings: RecordingSettings = {
    echoCancellation: flag(applied.echoCancellation, DEFAULT_RECORDING_SETTINGS.echoCancellation),
    noiseSuppression: flag(applied.noiseSuppression, DEFAULT_RECORDING_SETTINGS.noiseSuppression),
    autoGainControl: flag(applied.autoGainControl, DEFAULT_RECORDING_SETTINGS.autoGainControl),
  };
  const closeStream = () => stream.getTracks().forEach((t) => t.stop());

  let fileId: string;
  let lowSpace: boolean;
  try {
    ({ id: fileId, lowSpace } = await startRecordingFile(session.companyId));
  } catch (error) {
    closeStream();
    return (error as Error).message;
  }
  const problem = await finalStep(session, 'Start recording', (ws) => {
    const started = startRecording(ws, meeting.id, { id: fileId, settings }, by, now());
    return started.ok ? { ok: true, value: started.value.workspace } : started;
  });
  if (problem) {
    closeStream();
    await discardStoredFile(session.companyId, fileId).catch(() => undefined);
    return problem;
  }

  current = {
    companyId: session.companyId,
    sessionId: meeting.id,
    sessionTitle: meeting.title,
    href,
    fileId,
    state: 'starting',
    elapsedMs: 0,
    level: 0,
    lowSpace,
    unsaved: false,
    silent: false,
    message: null,
  };
  listeners.forEach((l) => l());
  void capture(session, meeting, stream, fileId);
  return null;
}

async function capture(session: WorkspaceSession, meeting: Session, stream: MediaStream, fileId: string): Promise<void> {
  const letGo = holdCompany(session);
  const companyId = session.companyId;
  const context = new AudioContext();
  let resampler: Resampler | null = null;
  /** Converted sound not yet sent. */
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  /** Bytes the server has. */
  let sent = 0;
  /** Bytes captured, sent or not. */
  let captured = 0;
  let sending: Promise<'sent' | 'waiting' | 'refused'> | null = null;
  let stopping = false;
  let lastLevel = 0;
  /** How much sound had been captured when the silence began, or null while there is sound. */
  let silentFromMs: number | null = null;

  const take = (samples: Float32Array) => {
    if (!samples.length || captured >= MAX_BYTES) return;
    let bytes = asBytes(toInt16(samples));
    if (captured + bytes.length > MAX_BYTES) bytes = bytes.subarray(0, MAX_BYTES - captured);
    pending.push(bytes);
    pendingBytes += bytes.length;
    captured += bytes.length;
  };

  /** When the last try to send began, and when pieces began failing (null while they go through). */
  let lastTry = 0;
  let failingSince: number | null = null;
  /** Why the server refused the recording's sound, once it has. */
  let refusal: string | null = null;

  /**
   * Sends what's waiting, in pieces at their offsets, each under the server's
   * limit. A failed piece stays and goes with the next try. A refusal (a 4xx:
   * consent changed, the recording was deleted) is final; anything else (the
   * server closed, the disk full) is tried again.
   */
  const send = async (): Promise<'sent' | 'waiting' | 'refused'> => {
    lastTry = Date.now();
    while (pendingBytes > 0) {
      const size = Math.min(pendingBytes, PIECE_BYTES);
      const piece = new Uint8Array(size);
      let at = 0;
      for (const p of pending) {
        if (at === size) break;
        const part = p.subarray(0, size - at);
        piece.set(part, at);
        at += part.length;
      }
      let answer: { bytes: number; full: boolean };
      try {
        answer = await sendRecordingPiece(companyId, fileId, meeting.id, sent, piece);
      } catch (error) {
        if (error instanceof WorkspaceApiError && error.status >= 400 && error.status < 500) {
          refusal = error.message;
          return 'refused';
        }
        failingSince ??= Date.now();
        // Once stopped, the sound is only waiting, so it says so straight away.
        if (stopping || Date.now() - failingSince >= UNSAVED_AFTER_MS) publish({ unsaved: true });
        return 'waiting';
      }
      failingSince = null;
      if (current?.unsaved) publish({ unsaved: false });
      // Only what the server now has is dropped from the queue.
      let drop = answer.bytes - sent;
      sent = answer.bytes;
      while (drop > 0 && pending.length) {
        const first = pending[0];
        if (first.length <= drop) {
          drop -= first.length;
          pendingBytes -= first.length;
          pending.shift();
        } else {
          pending[0] = first.subarray(drop);
          pendingBytes -= drop;
          drop = 0;
        }
      }
      if (answer.full) {
        void stop('The recording reached its 4-hour limit and stopped.');
        break;
      }
    }
    return 'sent';
  };

  const sendNow = (): Promise<'sent' | 'waiting' | 'refused'> => {
    if (refusal) return Promise.resolve('refused');
    sending ??= send()
      .then((result) => {
        if (result === 'refused' && !stopping) void stop(`${refusal} The recording stopped.`);
        return result;
      })
      .finally(() => {
        sending = null;
      });
    return sending;
  };

  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let mute: GainNode | null = null;
  // A backup: the sound's callback sends too (dueToSend), as hidden tabs' timers can slow to once a minute.
  const timer = setInterval(() => void sendNow(), SEND_EVERY_MS);

  const stop = async (message: string | null): Promise<void> => {
    if (stopping) return;
    stopping = true;
    publish({ state: 'stopping', message, silent: false });
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    source?.disconnect();
    node?.disconnect();
    mute?.disconnect();
    if (node) node.port.onmessage = null;
    if (resampler) take(resampler.flush());
    await context.close().catch(() => undefined);
    // Send what's left. While the server doesn't answer, the sound waits in
    // the page and is tried again for as long as the page is open: the
    // recording stays "stopping", so closing the tab still asks first.
    for (let tries = 0; pendingBytes > 0; tries++) {
      if (sending) await sending;
      if ((await sendNow()) === 'refused') break;
      if (pendingBytes > 0) await new Promise((r) => setTimeout(r, Math.min(5000, 500 * (tries + 1))));
    }
    try {
      const done = await finishRecordingFile(companyId, fileId);
      const problem = session.closed
        ? null
        : await finalStep(session, 'Stop recording', (ws) =>
            get(ws.files, fileId)
              ? finishRecording(ws, fileId, { durationMs: done.durationMs, sizeBytes: done.sizeBytes, recovered: false })
              : { ok: true, value: ws },
          );
      publish({
        state: problem ? 'failed' : 'stopped',
        elapsedMs: done.durationMs,
        level: 0,
        unsaved: false,
        silent: false,
        message: problem ? `The recording is on disk, but its entry couldn’t be saved: ${problem}` : message,
      });
    } catch {
      publish({
        state: 'failed',
        level: 0,
        unsaved: false,
        silent: false,
        message:
          'StyleCode’s local server couldn’t finish the recording. What reached it is kept, and is finished when the client is next opened.',
      });
    } finally {
      watch();
      stopOnClose();
      letGo();
      live = null;
    }
  };
  live = { stop };

  // A withdrawal, a deleted session or a closed client stops the recording (C8).
  const watch = session.subscribe(() => {
    if (stopping) return;
    const ws = session.getState().workspace;
    if (!get(ws.sessions, meeting.id) || !get(ws.files, fileId))
      return void stop('The session or the recording was deleted, so the recording stopped.');
    const allowed = canCapture(ws, meeting.id, 'recording', now());
    if (!allowed.ok) void stop(`${allowed.error} The recording stopped.`);
  });
  const stopOnClose = onCompanyClosed((closed) => {
    if (closed === session) void stop('The client was closed, so the recording stopped.');
  });

  try {
    await context.audioWorklet.addModule(workletUrl);
    if (stopping) return;
    resampler = new Resampler(context.sampleRate, RECORDING_SAMPLE_RATE);
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'stylecode-capture', { numberOfInputs: 1, numberOfOutputs: 1 });
    // The node must reach the speakers to keep running; silenced, so the room doesn't hear itself.
    mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(context.destination);
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (stopping || !resampler) return;
      const block = event.data;
      take(resampler.push(block));
      const peak = peakLevel(block);
      lastLevel = Math.max(peak, lastLevel * 0.85);
      const elapsedMs = Math.floor((captured / RECORDING_BYTES_PER_SECOND) * 1000);
      // A microphone giving nothing at all for a few seconds is muted, or isn't a real one: say so, until sound comes.
      const silence = followSilence(silentFromMs, peak, elapsedMs);
      silentFromMs = silence.silentFromMs;
      publish({ state: 'recording', elapsedMs, level: lastLevel, silent: silence.silent });
      if (captured >= MAX_BYTES) void stop('The recording reached its 4-hour limit and stopped.');
      else if (!sending && dueToSend(pendingBytes, Date.now() - lastTry)) void sendNow();
    };
    if (context.state === 'suspended') await context.resume();
  } catch {
    await stop('The microphone’s sound couldn’t be read, so the recording stopped. Try again.');
  }
}

/**
 * Stops the recording going (Stop, its key, or before a withdrawal, a
 * deletion or the client closing). Resolves once its last piece is on disk
 * and the recording is listed as finished. `sessionId` limits it to that
 * session's recording.
 */
export async function stopRecording(
  where?: { companyId: string; sessionId?: string },
  message: string | null = null,
): Promise<void> {
  if (!live || !current) return;
  if (where && (current.companyId !== where.companyId || (where.sessionId && current.sessionId !== where.sessionId))) return;
  await live.stop(message);
}

/** The key that stops a recording from anywhere in StyleCode, even while typing a note: Alt+S (Option+S on a Mac). */
export const isStopKey = (e: KeyboardEvent) => e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyS';

if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      // As the Stop button does, it also stops a recording that is still starting.
      if (!isStopKey(e) || !live || (current?.state !== 'recording' && current?.state !== 'starting')) return;
      e.preventDefault();
      e.stopPropagation();
      void stopRecording();
    },
    { capture: true },
  );
  window.addEventListener('beforeunload', (e) => {
    if (!isRecordingNow(current)) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

const tried = new Set<string>();

/**
 * Finishes the recordings a crash or a closed tab left unfinished, when
 * their client opens: the server writes the header with what arrived, and
 * the session marks each recovered. One that another window is still
 * recording is left alone.
 */
export async function recoverRecordings(session: WorkspaceSession): Promise<void> {
  if (session.readOnly) return;
  const ws = session.getState().workspace;
  for (const s of Object.values(ws.sessions)) {
    for (const r of recordingsOf(ws, s.id)) {
      const key = `${session.companyId}/${r.id}`;
      if (r.audio.state !== 'recording' || tried.has(key) || (current?.fileId === r.id && isRecordingNow(current))) continue;
      tried.add(key);
      try {
        const done = await finishRecordingFile(session.companyId, r.id, true);
        await finalStep(session, 'Recover a recording', (w) =>
          finishRecording(w, r.id, { durationMs: done.durationMs, sizeBytes: done.sizeBytes, recovered: true }),
        );
      } catch {
        // Still being recorded in another window, or the server can't say: tried again when the page reloads.
      }
    }
  }
}

/** The recording going, or the last one, outside React. */
export const getRecording = (): ActiveRecording | null => current;
