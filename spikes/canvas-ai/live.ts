/**
 * The live check of the canvas AI with the record (Workspace Phase 4, decision 24; WP9 and WP10). Started by
 * `start-live-check.cmd`, never from a tool call. Every company, person and statement is role-played
 * (`records.ts`).
 *
 * It starts StyleCode for client work (`scripts/start.ts`, port 4173) with a data folder of its own,
 * `~/.stylecode/canvas-ai/data/`, outside the repository and apart from the consultant's real data, emptied first, and
 * AI settings beside it (`~/.stylecode/canvas-ai/ai.json`). It
 * seeds Harbour Bakery and Karoo Freight, each with a design and a record, and points the AI at qwen3:4b in Ollama on
 * this computer. It refuses a cloud model and any address that isn't this computer.
 *
 * Each of the eight requests is made twice, through the app as the consultant makes it: with the record, and
 * without it (the assistant given no record, so the same design and request reach the model with no findings). The
 * order alternates, so heat doesn't favour one. Per request it keeps:
 * - whether the reply validated (a proposal to review), and whether it took the repair attempt;
 * - the findings it cited, and whether every one was offered;
 * - whether it cited at least one the key marks as relevant;
 * - the time taken, all in, and from the request being sent.
 *
 * Results go to a new folder each time, `eval/canvas-ai/runs/<time>/`: nothing earlier is read, skipped or deleted.
 * The progress log (`eval/canvas-ai/progress.log`, git-ignored) has times and counts only.
 *
 * CANVAS_SMOKE=1 checks this driver without a model: the fake Ollama from the browser tests, a throwaway folder, and
 * nothing written to eval/.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { ENGAGEMENTS, type LiveEngagement, type LiveLayer, type LiveRequest } from './records.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const BASE = 'http://localhost:4173';
const OLLAMA = 'http://localhost:11434';
const SMOKE = process.env.CANVAS_SMOKE === '1';
const MODEL = process.env.CANVAS_MODEL ?? 'qwen3:4b';
const HOME = SMOKE ? join(tmpdir(), 'stylecode-canvas-ai-smoke') : join(homedir(), '.stylecode', 'canvas-ai');
const DATA = join(HOME, 'data');
const AI_SETTINGS = join(HOME, 'ai.json');
const EVAL = SMOKE ? join(HOME, 'eval') : join(ROOT, 'eval', 'canvas-ai');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join(EVAL, 'runs', STAMP);
const LOG = join(EVAL, 'progress.log');
const WS = { 'x-stylecode-workspace': '1', 'content-type': 'application/json' };
const AI = { 'x-stylecode-ai': '1', 'content-type': 'application/json' };
const BY = 'Sam Naidoo (live check role-play)';
const AT = '2026-11-18T09:00:00.000Z';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  appendFileSync(LOG, `${stamped}\n`);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/workspace${path}`, { ...init, headers: WS });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** Refuses anything but a model on this computer: no cloud model, no other address (the brief's ground rules). */
async function checkModel(url: string, model: string): Promise<void> {
  if (/[-:]cloud$/i.test(model)) throw new Error(`${model} is a cloud model: the live check runs on this computer only.`);
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url)) throw new Error(`${url} isn't this computer.`);
  const tags = await fetch(`${url}/api/tags`).then(
    (r) => (r.ok ? (r.json() as Promise<{ models: { name: string }[] }>) : null),
    () => null,
  );
  if (!tags) throw new Error('Ollama isn’t running: start it, then start the live check again.');
  if (!tags.models.some((m) => m.name === model)) throw new Error(`Ollama doesn’t have ${model}: run "ollama pull ${model}".`);
}

/** StyleCode for client work, with the live check's own data folder and AI settings. */
async function startStyleCode(): Promise<ChildProcess> {
  const inUse = await fetch(BASE).then(
    () => true,
    () => false,
  );
  if (inUse) throw new Error('Port 4173 is in use: close StyleCode (npm start) first, then start the live check again.');
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', join(ROOT, 'scripts', 'start.ts')],
    {
      cwd: ROOT,
      env: { ...process.env, STYLECODE_WORKSPACE: DATA, STYLECODE_AI_CONFIG: AI_SETTINGS },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  for (let i = 0; i < 600; i++) {
    const up = await fetch(`${BASE}/api/workspace/info`, { headers: WS }).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return child;
    await pause(1000);
  }
  child.kill();
  throw new Error('StyleCode didn’t start within 10 minutes.');
}

/** The design file, in the editor's format, as the browser tests' Harbour Bakery makes one. */
function designFile(e: LiveEngagement) {
  const nodes: Record<string, unknown> = {};
  const add = (layer: LiveLayer, parentId: string) => {
    const { children = [], ...props } = layer;
    nodes[layer.id] = { ...props, parentId, children: children.map((c) => c.id) };
    for (const c of children) add(c, layer.id);
  };
  nodes.l_page = { id: 'l_page', type: 'page', name: 'Page', fill: '#0d1017', parentId: null, children: [e.design.screen.id] };
  add(e.design.screen, 'l_page');
  return {
    format: 'stylecode',
    version: 5,
    savedAt: AT,
    document: { id: e.design.documentId, name: e.design.name, rootId: 'l_page', nodes },
  };
}

/** A client with the engagement, its sessions (each with a confirmed consent record), notes, findings and design. */
async function seed(e: LiveEngagement): Promise<string> {
  const created = await api<{
    workspace: Record<string, Record<string, unknown>> & { company: { id: string } };
    revision: string;
  }>('/companies', { method: 'POST', body: JSON.stringify({ profile: { name: e.company, industry: e.industry } }) });
  const ws = created.workspace;
  const id = ws.company.id;
  ws.engagements = {
    en_1: {
      id: 'en_1',
      companyId: id,
      name: e.engagement,
      goal: e.goal,
      status: { state: 'active' },
      createdAt: AT,
      updatedAt: AT,
    },
  };
  ws.sessions = {};
  ws.participants = {};
  ws.consents = {};
  ws.notes = {};
  for (const [i, s] of e.sessions.entries()) {
    ws.sessions[s.id] = {
      id: s.id,
      engagementId: 'en_1',
      title: s.title,
      startsAt: AT,
      timeZone: 'Africa/Johannesburg',
      audioFileIds: [],
      deletedRecordings: [],
      aiStop: null,
      createdAt: AT,
      updatedAt: AT,
    };
    const person = `pa_${i}`;
    ws.participants[person] = {
      id: person,
      sessionId: s.id,
      name: s.client,
      role: '',
      organisation: e.company,
      side: 'client',
      speakerLabels: [],
    };
    ws.consents[`cr_${i}`] = {
      id: `cr_${i}`,
      sessionId: s.id,
      askedParticipantIds: [person],
      askedBy: BY,
      method: { kind: 'verbal-at-start' },
      wordingVersion: s.toldAiDesign ? 'draft-2' : 'draft-1',
      told: {
        recorded: false,
        transcribed: false,
        aiExtraction: true,
        aiDesign: s.toldAiDesign,
        processingLocal: true,
        processingExternal: false,
        retention: false,
        canStopOrDelete: true,
        externalProvider: null,
      },
      given: { audioRecording: false, transcription: false, aiLocal: true, aiExternal: false, externalProvider: null },
      retention: { kind: 'until-engagement-ends' },
      outcome: { kind: 'given' },
      confirmed: { by: BY, at: AT },
      attachmentFileId: null,
      lockedAt: null,
      amendments: [],
      createdAt: AT,
      updatedAt: AT,
    };
  }
  ws.findings = {};
  for (const [n, f] of e.findings.entries()) {
    const when = new Date(Date.parse(AT) + (n + 1) * 60_000).toISOString();
    let evidence: unknown[] = [];
    if (f.note) {
      const noteId = `no_${n}`;
      ws.notes[noteId] = { id: noteId, sessionId: f.note.session, text: f.note.text, writtenAt: AT, updatedAt: AT };
      evidence = [{ kind: 'note', noteId, quote: f.note.quote }];
    }
    ws.findings[f.id] = {
      id: f.id,
      engagementId: 'en_1',
      kind: f.kind,
      statement: f.statement,
      status: 'confirmed',
      statusSet: { by: { kind: 'consultant', name: BY }, at: when },
      provenance: { kind: 'consultant' },
      evidence,
      origin: { kind: 'consultant', by: BY, at: when },
      history: [],
      createdAt: when,
      updatedAt: when,
    };
  }
  ws.designs = {
    de_1: { id: 'de_1', engagementId: 'en_1', name: e.design.name, documentId: e.design.documentId, createdAt: AT },
  };
  await api(`/companies/${id}`, { method: 'PUT', body: JSON.stringify({ workspace: ws, baseRevision: created.revision }) });
  await api(`/companies/${id}/designs`, {
    method: 'POST',
    body: JSON.stringify({ documentId: e.design.documentId, file: designFile(e) }),
  });
  return id;
}

interface Outcome {
  request: string;
  engagement: string;
  withRecord: boolean;
  validated: boolean;
  noChanges: boolean;
  repaired: boolean;
  error: string | null;
  /** What was still wrong with the reply after its repair attempt (the model's own ids). */
  problems: string[];
  /** The findings the request offered, by id. */
  offered: string[];
  leftOut: string | null;
  cited: string[];
  /** Ids it named that it wasn't given. */
  ignored: number;
  everyCitedOffered: boolean;
  citedRelevant: boolean;
  /** Of the key's findings, how many were offered. */
  relevantOffered: number;
  totalMs: number;
  /** From the first request to the model to the end: without the wait for the slot or the graphics card. */
  modelMs: number | null;
}

type Stylecode = {
  stylecode: {
    editor: { select(ids: string[]): void };
    assistant: {
      getState(): {
        status: string;
        config: unknown;
        noChanges: boolean;
        error: string | null;
        problems: string[];
        leftOut: string | null;
        drewOn: { id: string }[];
        ignoredFindings: number;
      };
      ask(text: string): Promise<void>;
      setRecord(record: null): void;
      dismiss(): void;
    };
  };
};

/** Opens the design with the page's debugging handle, and waits until the assistant has the record and its settings. */
async function openDesign(page: Page, companyId: string): Promise<void> {
  // A fresh page each time: the same address again wouldn't reload it, and the record would stay as the last run left it.
  await page.goto('about:blank');
  await page.goto(`${BASE}/?debug#/c/${companyId}/e/en_1/d/de_1`);
  await page.waitForSelector('.canvas');
  await page.waitForFunction(() => {
    const s = (window as unknown as Partial<Stylecode>).stylecode;
    return !!s && s.assistant.getState().config !== null && (s.assistant as unknown as { record: unknown }).record !== null;
  });
  await page.getByLabel('Design name').waitFor();
}

async function run(page: Page, companyId: string, e: LiveEngagement, r: LiveRequest, withRecord: boolean): Promise<Outcome> {
  await openDesign(page, companyId);
  if (!withRecord) await page.evaluate(() => (window as unknown as Stylecode).stylecode.assistant.setRecord(null));
  await page.evaluate((ids) => (window as unknown as Stylecode).stylecode.editor.select(ids), r.select);
  const chats: { at: number; body: { messages: { role: string; content: string }[] } }[] = [];
  const onRequest = (req: { url(): string; postDataJSON(): unknown }) => {
    if (req.url().includes('/api/ai/chat'))
      chats.push({ at: Date.now(), body: req.postDataJSON() as (typeof chats)[number]['body'] });
  };
  page.on('request', onRequest);
  const started = Date.now();
  await page.evaluate((text) => (window as unknown as Stylecode).stylecode.assistant.ask(text), r.text);
  const ended = Date.now();
  page.off('request', onRequest);
  const state = await page.evaluate(() => (window as unknown as Stylecode).stylecode.assistant.getState());
  await page.evaluate(() => (window as unknown as Stylecode).stylecode.assistant.dismiss());

  // What the request offered: the context's findings section, matched back to the record by statement.
  const first = chats[0]?.body.messages.find((m) => m.role === 'user')?.content ?? '';
  const byStatement = new Map(e.findings.map((f) => [JSON.stringify(f.statement), f.id]));
  const offered = [...first.matchAll(/^- F\d+ [\w-]+: (".*")$/gm)].map((m) => byStatement.get(m[1]) ?? '?');
  const cited = state.drewOn.map((f) => f.id);
  return {
    request: r.id,
    engagement: e.company,
    withRecord,
    validated: state.status === 'review',
    noChanges: state.noChanges,
    repaired: chats.length > 1,
    error: state.status === 'error' ? state.error : null,
    problems: state.problems,
    offered,
    leftOut: state.leftOut,
    cited,
    ignored: state.ignoredFindings,
    everyCitedOffered: state.ignoredFindings === 0 && cited.every((id) => offered.includes(id)),
    citedRelevant: cited.some((id) => r.relevant.includes(id)),
    relevantOffered: r.relevant.filter((id) => offered.includes(id)).length,
    totalMs: ended - started,
    modelMs: chats.length ? ended - chats[0].at : null,
  };
}

/** The middle of sorted times, or the mean of the two middle ones when there's an even number. */
function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function summary(outcomes: Outcome[]) {
  const of = (withRecord: boolean) => {
    const rows = outcomes.filter((o) => o.withRecord === withRecord);
    const times = rows
      .map((o) => o.modelMs)
      .filter((ms): ms is number => ms !== null)
      .sort((a, b) => a - b);
    return {
      requests: rows.length,
      validated: rows.filter((o) => o.validated).length,
      repaired: rows.filter((o) => o.repaired).length,
      noChanges: rows.filter((o) => o.noChanges).length,
      citedAny: rows.filter((o) => o.cited.length > 0).length,
      citedRelevant: rows.filter((o) => o.citedRelevant).length,
      citedNotOffered: rows.reduce((n, o) => n + o.ignored, 0),
      medianModelMs: median(times),
      maxModelMs: times.length ? times[times.length - 1] : null,
    };
  };
  return { withRecord: of(true), withoutRecord: of(false) };
}

async function openBrowser(): Promise<Browser> {
  if (SMOKE) return chromium.launch({ headless: true });
  try {
    return await chromium.launch({ channel: 'msedge', headless: false });
  } catch {
    log('canvas-ai: Edge couldn’t be started by Playwright; using its Chromium');
    return chromium.launch({ headless: false });
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  log(
    `canvas-ai live check${SMOKE ? ' (smoke)' : ''} (pid ${process.pid}, power: ${process.env.STYLECODE_POWER ?? 'not recorded'})`,
  );
  let fake: { url: string; close(): Promise<void> } | null = null;
  let server: ChildProcess | null = null;
  let browser: Browser | null = null;
  try {
    let url = OLLAMA;
    let model = MODEL;
    if (SMOKE) {
      const { startFakeOllama, FAKE_MODEL } = await import('../../e2e/fakeOllama.ts');
      fake = await startFakeOllama();
      url = fake.url.replace('127.0.0.1', 'localhost');
      model = FAKE_MODEL;
    } else await checkModel(url, model);
    // The live check's own folder, emptied first: nothing outside it is touched.
    rmSync(DATA, { recursive: true, force: true });
    mkdirSync(DATA, { recursive: true });
    server = await startStyleCode();
    const ai = await fetch(`${BASE}/api/ai/config`, {
      method: 'PUT',
      headers: AI,
      body: JSON.stringify({ provider: 'ollama', providers: { ollama: { baseUrl: url, model, contextSize: 8192 } } }),
    });
    if (!ai.ok) throw new Error(`AI settings: ${ai.status}`);
    await api('/settings', { method: 'PUT', body: JSON.stringify({ consultantName: BY }) });
    const ids = new Map<LiveEngagement, string>();
    for (const e of ENGAGEMENTS) ids.set(e, await seed(e));
    log(`canvas-ai: seeded ${ENGAGEMENTS.length} clients, ${ENGAGEMENTS.reduce((n, e) => n + e.findings.length, 0)} findings`);

    if (!SMOKE) {
      // Loads the model once, so the first request isn't timed with the load.
      await fetch(`${url}/api/generate`, { method: 'POST', body: JSON.stringify({ model, prompt: '', keep_alive: '15m' }) });
    }
    browser = await openBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 300)));
    const outcomes: Outcome[] = [];
    let n = 0;
    for (const e of ENGAGEMENTS) {
      for (const r of e.requests) {
        const order = n++ % 2 === 0 ? [true, false] : [false, true];
        for (const withRecord of order) {
          const o = await run(page, ids.get(e)!, e, r, withRecord);
          outcomes.push(o);
          log(
            `canvas-ai: ${r.id} ${withRecord ? 'with' : 'without'} the record: ${o.validated ? 'validated' : 'not validated'}` +
              `${o.repaired ? ' (repaired)' : ''}, offered ${o.offered.length}, cited ${o.cited.length} (relevant: ${o.citedRelevant ? 'yes' : 'no'}, not offered: ${o.ignored}), ${Math.round(o.totalMs / 1000)} s`,
          );
          writeFileSync(join(OUT, 'results.json'), `${JSON.stringify({ model, smoke: SMOKE, outcomes, pageErrors }, null, 2)}\n`);
        }
      }
    }
    const result = {
      model,
      smoke: SMOKE,
      power: process.env.STYLECODE_POWER ?? 'not recorded',
      startedAt: STAMP,
      summary: summary(outcomes),
      outcomes,
      pageErrors,
    };
    writeFileSync(join(OUT, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
    log(`canvas-ai done: ${JSON.stringify(result.summary)}`);
  } catch (e) {
    log(`FAILED canvas-ai: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => undefined);
    server?.kill();
    await fake?.close();
  }
}

await main();
