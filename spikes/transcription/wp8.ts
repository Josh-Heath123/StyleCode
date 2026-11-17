/**
 * WP8 (Phase 3 brief): end to end on the laptop, through StyleCode itself.
 * Started by `start-wp8.cmd`, never from a tool call: it runs for well over
 * an hour. Starting it again carries on where it stopped: each step writes
 * `eval/transcription/wp8/<step>.json` and is skipped once that exists.
 *
 * It starts StyleCode (`scripts/start.ts`, port 4173) with a data folder and
 * AI settings of its own in `~/.stylecode/wp8/`, outside the repository and
 * apart from the consultant's real data, and drives Microsoft Edge (or
 * Playwright's Chromium) with the real microphone and speakers. Every company
 * and person in it is role-played; the speech is WP1's synthetic voices.
 *
 * 1. **room:** Karoo Freight's clean audio plays through the laptop's
 *    speakers from one page while StyleCode records it with the microphone
 *    on the session page (echo cancellation off, decision 12). StyleCode
 *    transcribes it. For numbers that compare with WP3's clean-file runs,
 *    the same recording, lined up with the clean timeline, is run through
 *    WP2's harness with the app's settings (whisper-turbo-gpu, `--no-context`;
 *    ERes2Net at 0.7) as version `room`.
 * 2. **hour:** Bosveld Citrus's clean WAV is added to a session whose consent
 *    says "deleted after transcription"; Transcribe with both of decision 18's
 *    options; timed from Transcribe to the AI's proposals; the recording must
 *    be gone and the session's line say when.
 * 3. **export:** the hour's transcript and proposals, as the Phase 2 scorer
 *    reads them (`npm run eval:score -- p3-wp8-hour`), with Bosveld Citrus's
 *    key translated to the app's segments by time.
 *
 * The progress log (`eval/transcription/progress.log`) has times and counts
 * only, never what was said. Each step waits for the GPU to cool first.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { translateKey, type TimelineTurn } from '../../eval/transcription/downstream.ts';
import type { AnswerKey, EvalTranscript } from '../../eval/types.ts';
import { beginDriver, coolGpu, gpuLog, HARDWARE, log, MODEL, pause, ROOT, step, unloadModel } from './steps.ts';

const BASE = 'http://localhost:4173';
/**
 * WP8_SMOKE=1 checks this driver without the laptop playing anything: the fake
 * engine, a throwaway folder, no step 1, and nothing written to eval/.
 */
const SMOKE = process.env.WP8_SMOKE === '1';
const HOME = SMOKE ? join(tmpdir(), 'stylecode-wp8-smoke') : join(homedir(), '.stylecode', 'wp8');
const EVAL = SMOKE ? join(HOME, 'eval') : join(ROOT, 'eval');
const SPEEDS = SMOKE ? join(HOME, 'transcription.json') : join(homedir(), '.stylecode', 'transcription.json');
const DATA = join(HOME, 'data');
const AI_SETTINGS = join(HOME, 'ai.json');
const OUT = join(EVAL, 'transcription', 'wp8');
const AUDIO = join(ROOT, 'eval', 'audio', 'out');
const KAROO = 'karoo-freight-kickoff';
const BOSVELD = 'bosveld-citrus-intake';
const WS = { 'x-stylecode-workspace': '1', 'content-type': 'application/json' };
const BY = 'Ayesha Patel (WP8 role-play)';
const RATE = 16_000;
// src/workspace/audio/wav.ts has a class Node's type stripping can't run, so the header is written here.
const WAV_HEADER_BYTES = 44;
/** A 16 kHz mono 16-bit WAV header for `dataBytes` of sound. */
function wavHeader(dataBytes: number, sampleRate: number): Buffer {
  const h = Buffer.alloc(WAV_HEADER_BYTES);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

mkdirSync(OUT, { recursive: true });
mkdirSync(DATA, { recursive: true });

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/workspace${path}`, { ...init, headers: WS });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

interface Stored {
  sessions: Record<
    string,
    { audioFileIds: string[]; deletedRecordings: { reason: string; deletedAt: string; recordedAt: string }[] }
  >;
  files: Record<
    string,
    { name: string; sizeBytes: number; audio?: { state: string; durationMs: number; transcribedAt: string | null } }
  >;
  transcripts: Record<string, { id: string; sessionId: string; importedAt: string; source: Record<string, unknown> }>;
  segments: Record<
    string,
    {
      id: string;
      transcriptId: string;
      index: number;
      speakerLabel: string | null;
      startMs: number | null;
      endMs: number | null;
      text: string;
    }
  >;
  findings: Record<
    string,
    {
      createdAt: string;
      origin: {
        kind: string;
        at?: string;
        proposed?: {
          kind: string;
          status: string;
          statement: string;
          evidence: { kind: string; segmentId?: string; quote: string }[];
        };
      };
    }
  >;
}
const workspace = async (id: string) => (await api<{ workspace: Stored }>(`/companies/${id}`)).workspace;

/** StyleCode for client work, with WP8's own data folder and AI settings. */
async function startStyleCode(): Promise<ChildProcess> {
  if (
    await fetch(BASE).then(
      () => true,
      () => false,
    )
  )
    throw new Error('Port 4173 is in use: close StyleCode (npm start) first, then start WP8 again.');
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', join(ROOT, 'scripts', 'start.ts')],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        STYLECODE_WORKSPACE: DATA,
        STYLECODE_AI_CONFIG: AI_SETTINGS,
        ...(SMOKE ? { STYLECODE_TRANSCRIPTION_FAKE: '1', STYLECODE_TRANSCRIPTION_SETTINGS: SPEEDS } : {}),
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  for (let i = 0; i < 600; i++) {
    if (
      await fetch(`${BASE}/api/workspace/info`, { headers: WS }).then(
        (r) => r.ok,
        () => false,
      )
    )
      return child;
    await pause(1000);
  }
  child.kill();
  throw new Error('StyleCode didn’t start within 10 minutes.');
}

/** A role-played client, engagement and session, with a confirmed consent record (as e2e/karoo.ts makes one). */
async function seed(meeting: string, retention: Record<string, unknown>, notAsked: string[]): Promise<string> {
  const c = JSON.parse(readFileSync(join(ROOT, 'eval', 'consultations', meeting, 'consultation.json'), 'utf8')) as {
    title: string;
    startsAt: string;
    timeZone: string;
    participants: { name: string; side: 'client' | 'consultant' }[];
  };
  const created = await api<{ workspace: Record<string, unknown> & { company: { id: string } }; revision: string }>(
    '/companies',
    {
      method: 'POST',
      body: JSON.stringify({
        profile: { name: `${c.title.split(' ').slice(0, 2).join(' ')} (WP8 ${new Date().toISOString().slice(0, 16)})` },
      }),
    },
  );
  const ws = created.workspace;
  const id = ws.company.id;
  const at = new Date().toISOString();
  ws.engagements = {
    en_1: { id: 'en_1', companyId: id, name: c.title, goal: '', status: { state: 'active' }, createdAt: at, updatedAt: at },
  };
  ws.sessions = {
    se_1: {
      id: 'se_1',
      engagementId: 'en_1',
      title: c.title,
      startsAt: c.startsAt,
      timeZone: c.timeZone,
      audioFileIds: [],
      deletedRecordings: [],
      createdAt: at,
      updatedAt: at,
    },
  };
  const participants: Record<string, unknown> = {};
  const asked: string[] = [];
  c.participants.forEach((p, i) => {
    const pid = `pa_${i + 1}`;
    participants[pid] = { id: pid, sessionId: 'se_1', name: p.name, role: '', organisation: '', side: p.side, speakerLabels: [] };
    if (p.side === 'client' && !notAsked.includes(p.name)) asked.push(pid);
  });
  ws.participants = participants;
  const consultant = c.participants.find((p) => p.side === 'consultant')!.name;
  ws.consents = {
    cr_1: {
      id: 'cr_1',
      sessionId: 'se_1',
      askedParticipantIds: asked,
      askedBy: consultant,
      method: { kind: 'verbal-at-start' },
      wordingVersion: 'draft-1',
      told: {
        recorded: true,
        transcribed: true,
        aiExtraction: true,
        processingLocal: true,
        processingExternal: false,
        retention: true,
        canStopOrDelete: true,
        externalProvider: null,
      },
      given: { audioRecording: true, transcription: true, aiLocal: true, aiExternal: false, externalProvider: null },
      retention,
      outcome: { kind: 'given' },
      confirmed: { by: consultant, at },
      attachmentFileId: null,
      lockedAt: null,
      amendments: [],
      createdAt: at,
      updatedAt: at,
    },
  };
  await api(`/companies/${id}`, { method: 'PUT', body: JSON.stringify({ workspace: ws, baseRevision: created.revision }) });
  await api('/settings', { method: 'PUT', body: JSON.stringify({ consultantName: BY }) });
  return id;
}

async function openBrowser(): Promise<Browser> {
  const args = ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  try {
    return await chromium.launch({ channel: 'msedge', headless: false, args });
  } catch {
    log('wp8: Edge couldn’t be started by Playwright; using its Chromium');
    return chromium.launch({ headless: false, args });
  }
}

const sessionPage = async (context: BrowserContext, id: string): Promise<Page> => {
  const page = await context.newPage();
  await page.goto(`${BASE}/#/c/${id}/e/en_1/s/se_1`);
  await page.getByRole('heading', { name: 'Transcript', exact: true }).waitFor({ timeout: 60_000 });
  return page;
};

/** Waits until `check` gives a value, asking every `everyMs`, for at most `forMs`. */
async function until<T>(
  what: string,
  check: () => Promise<T | null | undefined | false>,
  forMs: number,
  everyMs = 2000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value as T;
    if (Date.now() - started > forMs) throw new Error(`Waited ${Math.round(forMs / 60_000)} min for ${what}.`);
    await pause(everyMs);
  }
}

/** The sound's loudness (RMS, 0 to 1) in 16-bit samples: a near-silent recording means the microphone or speakers weren't working. */
function rms(bytes: Buffer): number {
  let sum = 0;
  const n = Math.floor(bytes.length / 2);
  for (let i = 0; i < n; i++) {
    const s = bytes.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

// ---------------------------------------------------------------------------
// 1. The recorded role-play meeting
// ---------------------------------------------------------------------------

async function room(browser: Browser): Promise<void> {
  const done = join(OUT, 'room.json');
  if (existsSync(done)) return log('skip wp8 room: done before');
  const clean = join(AUDIO, `${KAROO}.clean.wav`);
  const cleanMs = Math.round(((statSync(clean).size - WAV_HEADER_BYTES) / 2 / RATE) * 1000);
  await coolGpu('wp8 room');
  log(`start wp8 room: the laptop plays ${KAROO} aloud for ${(cleanMs / 60_000).toFixed(1)} min`);
  const id = await seed(KAROO, { kind: 'days', days: 30 }, ['Lerato Dlamini']);

  // The player: a page of its own, served from here, so the sound comes out of the speakers.
  const server = createServer((req, res) => {
    if (req.url === '/audio.wav') {
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(statSync(clean).size) });
      createReadStream(clean).pipe(res);
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        '<!doctype html><title>WP8: playing the role-play</title><p>Playing the role-played meeting for StyleCode to record.</p><audio id="a" src="/audio.wav" preload="auto" controls></audio>',
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 860 } });
  const app = await sessionPage(context, id);
  // The microphone, chosen in StyleCode's own list as the consultant would (decision 12). Windows' default on this
  // laptop is a virtual device (SteelSeries Sonar) that gave silence on the first try, so the built-in one is chosen.
  // The browser lists microphones once one has been opened in the page, so one is opened, and StyleCode's list
  // (which reads them again on "devicechange") is told to look again.
  await app.evaluate(async () => {
    (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  const wanted = process.env.WP8_MICROPHONE ?? 'Microphone Array';
  const list = app.getByLabel('Microphone', { exact: true });
  await until('the microphones to be listed', async () => (await list.locator('option').count()) > 1, 15_000, 500).catch(
    () => undefined,
  );
  const options = await list.locator('option').allInnerTexts();
  const microphone = options.find((o) => o.includes(wanted));
  if (!microphone)
    throw new Error(
      `No microphone named like “${wanted}”. Set WP8_MICROPHONE to part of one of these names: ${options.join('; ')}`,
    );
  await app.getByLabel('Microphone', { exact: true }).selectOption({ label: microphone });
  log(`wp8 room: microphone ${microphone}`);
  await app.getByRole('button', { name: 'Record', exact: true }).click();
  await app.getByRole('dialog', { name: 'Start recording' }).getByRole('button', { name: 'Start recording' }).click();
  await app.locator('.ws-live-state', { hasText: 'Recording' }).waitFor({ timeout: 60_000 });
  // Before anything plays: the room's own sound must move the meter, or this microphone hears nothing.
  let heard = 0;
  for (let i = 0; i < 20; i++) {
    heard = Math.max(heard, Number((await app.locator('.ws-live').getByRole('meter').getAttribute('aria-valuenow')) ?? 0));
    await pause(200);
  }
  if (heard < 1) {
    await app.locator('.ws-live').getByRole('button', { name: /Stop/ }).click();
    throw new Error(
      `The microphone chosen (${microphone}) gives no sound, so nothing was played. Check it isn’t muted, or set WP8_MICROPHONE to part of another one’s name.`,
    );
  }
  log(`wp8 room: the microphone hears the room (meter up to ${heard}%)`);

  const player = await context.newPage();
  await player.goto(`http://localhost:${port}/`);
  // Out of the laptop's own speaker, named, rather than wherever Windows sends sound now.
  const speaker = await player.evaluate(async (wantedSpeaker) => {
    (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
    const pick = outputs.find((d) => d.deviceId !== 'default' && d.label.includes(wantedSpeaker));
    if (!pick) return `the default (${outputs.find((d) => d.deviceId === 'default')?.label ?? 'unknown'})`;
    await (document.getElementById('a') as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(pick.deviceId);
    return pick.label;
  }, process.env.WP8_SPEAKER ?? 'Speaker (Realtek');
  log(`wp8 room: speaker ${speaker}`);
  const playedAt = await player.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const a = document.getElementById('a') as HTMLAudioElement;
        a.muted = false;
        a.volume = 1;
        a.addEventListener('playing', () => resolve(Date.now()), { once: true });
        a.play().catch(reject);
      }),
  );
  log('wp8 room: playing');
  await player.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const a = document.getElementById('a') as HTMLAudioElement;
        if (a.ended) resolve();
        else a.addEventListener('ended', () => resolve(), { once: true });
      }),
  );
  await pause(2000);
  await app.bringToFront();
  const stoppedAt = Date.now();
  await app.locator('.ws-live').getByRole('button', { name: /Stop/ }).click();
  server.close();
  await player.close();

  const fileId = await until(
    'the recording to finish',
    async () => {
      const ws = await workspace(id);
      const fid = ws.sessions.se_1.audioFileIds[0];
      return fid && ws.files[fid]?.audio?.state === 'finished' ? fid : null;
    },
    120_000,
  );
  const recordedMs = (await workspace(id)).files[fileId].audio!.durationMs;
  // The recording started before the sound: line it up with the clean audio, and so with its timeline.
  const offsetMs = Math.max(0, recordedMs - (stoppedAt - playedAt));
  const recorded = readFileSync(join(DATA, 'companies', id, 'files', fileId));
  const from = WAV_HEADER_BYTES + Math.round((offsetMs * RATE) / 1000) * 2;
  const sound = recorded.subarray(from, Math.min(recorded.length, from + Math.round((cleanMs * RATE) / 1000) * 2));
  const roomWav = join(AUDIO, `${KAROO}.room.wav`);
  writeFileSync(roomWav, Buffer.concat([Buffer.from(wavHeader(sound.length, RATE)), sound]));
  const loudness = rms(sound);
  const cleanLoudness = rms(readFileSync(clean).subarray(WAV_HEADER_BYTES));
  log(
    `wp8 room: recorded ${(recordedMs / 1000).toFixed(1)} s, sound from ${offsetMs} ms, RMS ${loudness.toFixed(4)} (clean file ${cleanLoudness.toFixed(4)})`,
  );
  if (loudness < 0.002)
    throw new Error(
      'The recording is nearly silent: check the microphone, the volume and that the browser wasn’t muted, then start WP8 again.',
    );

  // Transcribed by StyleCode, as the consultant would, added when ready.
  await app.getByRole('button', { name: 'Transcribe…' }).click();
  const dialog = app.getByRole('dialog', { name: 'Transcribe the recordings' });
  await dialog.getByLabel('Add the transcript when it’s ready').check();
  const transcribeAt = Date.now();
  await dialog.getByRole('button', { name: 'Transcribe', exact: true }).click();
  await until('the transcript', async () => Object.keys((await workspace(id)).transcripts).length > 0, 60 * 60_000, 5000);
  const appTranscribeMs = Date.now() - transcribeAt;
  log(`wp8 room: StyleCode transcribed and added it in ${(appTranscribeMs / 1000).toFixed(0)} s`);
  await context.close();

  // The same recording through WP2's harness, with the app's settings, for numbers beside WP3's clean-file runs.
  const words = await step('wp8 room words', 'spikes/transcription/run.ts', [
    'words',
    'whisper-turbo-gpu',
    KAROO,
    'room',
    '--no-context',
    '--label',
    'wp8-room-whisper-turbo-gpu-mc0',
  ]);
  const speakers = await step('wp8 room speakers', 'spikes/transcription/run.ts', [
    'speakers',
    'eres2net',
    KAROO,
    'room',
    '--threshold',
    '0.7',
    '--label',
    'wp8-room-speakers-eres2net-t0.7',
  ]);
  if (words.code !== 0 || speakers.code !== 0) throw new Error('A harness run on the room recording failed: see the log.');

  writeFileSync(
    done,
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        meeting: KAROO,
        hardware: HARDWARE,
        power: process.env.STYLECODE_POWER ?? 'not recorded',
        browser: browser.version(),
        microphone,
        speaker,
        cleanMs,
        recordedMs,
        offsetMs,
        rms: { room: Number(loudness.toFixed(5)), clean: Number(cleanLoudness.toFixed(5)) },
        appTranscribeMs,
        harness: { words: 'wp8-room-whisper-turbo-gpu-mc0', speakers: 'wp8-room-speakers-eres2net-t0.7' },
        compareWith: { words: 'whisper-turbo-gpu-mc0', speakers: 'speakers-eres2net-t0.7', version: 'clean' },
      },
      null,
      2,
    )}\n`,
  );
  log('ok wp8 room');
}

// ---------------------------------------------------------------------------
// 2. An hour, through the app
// ---------------------------------------------------------------------------

async function hour(browser: Browser): Promise<string> {
  const done = join(OUT, 'hour.json');
  if (existsSync(done)) {
    log('skip wp8 hour: done before');
    return (JSON.parse(readFileSync(done, 'utf8')) as { companyId: string }).companyId;
  }
  if (
    !(await fetch('http://localhost:11434/api/tags').then(
      (r) => r.ok,
      () => false,
    ))
  )
    throw new Error('Ollama isn’t running: start it, then start WP8 again.');
  const id = await seed(BOSVELD, { kind: 'delete-after-transcription' }, ['Ruan du Toit']);
  // The app's AI settings, as WP3's extraction runs used them.
  const ai = await fetch(`${BASE}/api/ai/config`, {
    method: 'PUT',
    headers: { 'x-stylecode-ai': '1', 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'ollama',
      providers: { ollama: { baseUrl: 'http://localhost:11434', model: MODEL, contextSize: 6144 } },
    }),
  });
  if (!ai.ok) throw new Error(`AI settings: ${ai.status}`);

  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const app = await sessionPage(context, id);
  // What goes wrong in the page is kept, as messages only (the first try's AI stopped part-way without a word in the logs).
  const pageErrors: string[] = [];
  app.on('pageerror', (e) => pageErrors.push(`${new Date().toISOString()} ${e.message.slice(0, 300)}`));
  app.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`${new Date().toISOString()} ${m.text().slice(0, 300)}`);
  });
  const wav = join(AUDIO, `${BOSVELD}.clean.wav`);
  const chooser = app.waitForEvent('filechooser');
  await app.getByRole('button', { name: 'Add a WAV file…' }).click();
  await app.getByRole('dialog', { name: 'Add a recording' }).getByRole('button', { name: 'Choose a WAV file…' }).click();
  await (await chooser).setFiles(wav);
  const fileId = await until('the WAV to be added', async () => (await workspace(id)).sessions.se_1.audioFileIds[0], 20 * 60_000);
  const audioMs = (await workspace(id)).files[fileId].audio!.durationMs;
  log(`wp8 hour: added ${(audioMs / 60_000).toFixed(1)} min of sound`);

  await unloadModel();
  await coolGpu('wp8 hour');
  log('start wp8 hour: Transcribe, add when ready, then ask the AI');
  await app.getByRole('button', { name: 'Transcribe…' }).click();
  const dialog = app.getByRole('dialog', { name: 'Transcribe the recordings' });
  const estimate = await dialog.getByTestId('transcribe-estimate').innerText();
  await dialog.getByLabel('Add the transcript when it’s ready').check();
  await dialog.getByLabel('Then ask the AI for findings').check();
  const gpu = gpuLog();
  const startedAt = Date.now();
  await dialog.getByRole('button', { name: 'Transcribe', exact: true }).click();

  const addedAt = await until(
    'the transcript to be added',
    async () => (Object.keys((await workspace(id)).transcripts).length ? Date.now() : null),
    3 * 60 * 60_000,
    5000,
  );
  log(`wp8 hour: transcript added after ${((addedAt - startedAt) / 60_000).toFixed(1)} min`);
  const nav = app.getByRole('navigation', { name: 'StyleCode' });
  const ended = await until(
    'the AI to finish',
    async () => {
      const text = await nav.innerText();
      const m = /The AI (has finished|couldn’t finish|stopped on)/.exec(text);
      return m ? { at: Date.now(), how: m[1] } : null;
    },
    4 * 60 * 60_000,
    5000,
  );
  const resources = gpu.stop();
  log(`wp8 hour: the AI ${ended.how} after ${((ended.at - startedAt) / 60_000).toFixed(1)} min in all`);
  // The proposals are saved a moment after the run ends: wait before reading the client's file.
  await pause(3000);
  // The run's own words on the session page: why it stopped, and what was added (counts, not proposals).
  const aiSaid = (
    await app
      .locator('.ws-run-status')
      .innerText()
      .catch(() => '')
  )
    .replace(/\s+/g, ' ')
    .slice(0, 500);
  if (ended.how !== 'has finished') {
    const record = join(OUT, `hour.failed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(
      record,
      `${JSON.stringify({ at: new Date().toISOString(), companyId: id, aiEnded: ended.how, aiSaid, pageErrors, minutes: { transcribeToAdded: Number(((addedAt - startedAt) / 60_000).toFixed(2)), transcribeToEnd: Number(((ended.at - startedAt) / 60_000).toFixed(2)) }, gpu: resources }, null, 2)}\n`,
    );
    await context.close();
    // Not marked done, so starting WP8 again tries the hour again.
    throw new Error(`The AI ${ended.how} the hour. It said: “${aiSaid}”. Page errors: ${pageErrors.length}. See ${record}.`);
  }

  const ws = await workspace(id);
  const transcript = Object.values(ws.transcripts)[0];
  const deleted = ws.sessions.se_1.deletedRecordings;
  const proposals = Object.values(ws.findings).filter((f) => f.origin.kind === 'ai');
  const checks = {
    recordingGone: !existsSync(join(DATA, 'companies', id, 'files', fileId)) && ws.sessions.se_1.audioFileIds.length === 0,
    lineSaysWhen: deleted.length === 1 && deleted[0].reason === 'transcribed' && !!deleted[0].deletedAt,
    deletedWhenAdded: deleted[0]?.deletedAt === transcript.importedAt,
  };
  log(`wp8 hour: checks ${JSON.stringify(checks)}; ${proposals.length} proposals`);
  const speeds = JSON.parse(readFileSync(SPEEDS, 'utf8')) as { speeds: unknown[] };
  writeFileSync(
    done,
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        meeting: BOSVELD,
        companyId: id,
        hardware: HARDWARE,
        power: process.env.STYLECODE_POWER ?? 'not recorded',
        model: MODEL,
        contextSize: 6144,
        audioMs,
        estimateShown: estimate,
        minutes: {
          transcribeToAdded: Number(((addedAt - startedAt) / 60_000).toFixed(2)),
          addedToProposals: Number(((ended.at - addedAt) / 60_000).toFixed(2)),
          transcribeToProposals: Number(((ended.at - startedAt) / 60_000).toFixed(2)),
        },
        aiEnded: ended.how,
        aiSaid,
        pageErrors,
        transcriptSource: transcript.source,
        segments: Object.values(ws.segments).filter((s) => s.transcriptId === transcript.id).length,
        proposals: proposals.length,
        checks,
        deletedRecording: deleted[0] ?? null,
        transcriptionSpeed: speeds.speeds.at(-1) ?? null,
        gpu: resources,
      },
      null,
      2,
    )}\n`,
  );
  await context.close();
  log('ok wp8 hour');
  return id;
}

// ---------------------------------------------------------------------------
// 3. The hour's proposals, as the Phase 2 scorer reads them
// ---------------------------------------------------------------------------

async function exportHour(id: string): Promise<void> {
  const ws = await workspace(id);
  const transcript = Object.values(ws.transcripts)[0];
  const segments = Object.values(ws.segments)
    .filter((s) => s.transcriptId === transcript.id)
    .sort((a, b) => a.index - b.index);
  const c = JSON.parse(readFileSync(join(ROOT, 'eval', 'consultations', BOSVELD, 'consultation.json'), 'utf8')) as {
    title: string;
    startsAt: string;
    timeZone: string;
  };
  let turn = 0;
  const evalTranscript: EvalTranscript = {
    consultation: BOSVELD,
    title: c.title,
    startsAt: c.startsAt,
    timeZone: c.timeZone,
    source: { fileName: 'StyleCode (WP8)', layout: 'transcribed on this computer' },
    segments: segments.map((s, i) => ({
      id: s.id,
      turn: `E${i === 0 || segments[i - 1].speakerLabel !== s.speakerLabel ? ++turn : turn}`,
      speakerLabel: s.speakerLabel,
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
    })),
  };
  const timeline = (
    JSON.parse(readFileSync(join(ROOT, 'eval', 'audio', `${BOSVELD}.timeline.json`), 'utf8')) as Record<
      string,
      { turns: TimelineTurn[] }
    >
  ).clean.turns;
  const key = JSON.parse(readFileSync(join(ROOT, 'eval', 'consultations', BOSVELD, 'answer-key.json'), 'utf8')) as AnswerKey;
  const dir = join(EVAL, 'transcription', 'extraction', 'wp8-hour.clean');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${BOSVELD}.transcript.json`), `${JSON.stringify(evalTranscript, null, 2)}\n`);
  writeFileSync(join(dir, `${BOSVELD}.key.json`), `${JSON.stringify(translateKey(key, timeline, evalTranscript), null, 2)}\n`);

  // The AI's proposals as it made them (before any review), in the order they were added.
  const proposals = Object.values(ws.findings)
    .filter((f) => f.origin.kind === 'ai' && f.origin.proposed)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((f) => ({
      kind: f.origin.proposed!.kind,
      status: f.origin.proposed!.status,
      statement: f.origin.proposed!.statement,
      evidence: f.origin
        .proposed!.evidence.filter((e) => e.kind === 'segment')
        .map((e) => ({ segmentId: e.segmentId!, quote: e.quote })),
    }));
  const hourRecord = JSON.parse(readFileSync(join(OUT, 'hour.json'), 'utf8')) as { minutes: { addedToProposals: number } };
  const runDir = join(EVAL, 'runs', 'p3-wp8-hour');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, `${BOSVELD}.json`),
    `${JSON.stringify(
      {
        consultation: BOSVELD,
        provider: 'ollama',
        model: MODEL,
        promptVersion: 'StyleCode (the app’s own run)',
        contextSize: 6144,
        chunks: null,
        startedAt: hourRecord && new Date().toISOString(),
        durationMs: Math.round(hourRecord.minutes.addedToProposals * 60_000),
        unreadableReplies: null,
        hardware: HARDWARE,
        think: 'off',
        transcriptFile: `transcription/extraction/wp8-hour.clean/${BOSVELD}.transcript.json`,
        keyFile: `transcription/extraction/wp8-hour.clean/${BOSVELD}.key.json`,
        note: 'The app’s proposals after its own checks (repeats and failed quotes removed), not the raw proposals WP3 scored. Speakers were not matched before the AI ran (both of decision 18’s options).',
        proposals,
      },
      null,
      2,
    )}\n`,
  );
  log(`ok wp8 export: ${proposals.length} proposals, ${segments.length} segments`);
}

async function main(): Promise<void> {
  beginDriver('wp8');
  const server = await startStyleCode();
  let browser: Browser | null = null;
  try {
    browser = await openBrowser();
    if (!SMOKE) await room(browser);
    const id = await hour(browser);
    await exportHour(id);
    log('wp8 done');
  } catch (e) {
    log(`FAILED wp8: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => undefined);
    server.kill();
  }
}

await main();
