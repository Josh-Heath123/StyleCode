import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDoc } from '../codegen/fixtures';
import { Editor } from '../editor/editor';
import type { DesignDocument } from '../model/types';
import { Assistant } from './assistant';
import type { AiConfig } from './client';
import { buildContext, type AiContext } from './context';
import { systemPrompt } from './prompt';
import { findingsDrawnOn, interpret } from './proposal';
import { orderFindings, type AiWait, type RecordFinding, type RecordSource } from './record';
import { responseSchema } from './schema';

/** The canvas AI with the engagement's record (Workspace Phase 4, decisions 14 to 17). */

const finding = (id: string, kind: string, createdAt: string, statement = `Finding ${id}.`): RecordFinding => ({
  id,
  statement,
  kind,
  createdAt,
});

const DAY = (d: number) => `2026-11-0${d}T09:00:00.000Z`;

function screen(): DesignDocument {
  return buildDoc({
    type: 'frame',
    id: 'screen',
    props: { name: 'Checkout', width: 800, height: 600 },
    children: [
      { type: 'rect', id: 'pay', props: { name: 'Pay button', x: 20, y: 20, width: 200, height: 48, findings: ['fd_pay'] } },
      {
        type: 'text',
        id: 'note',
        props: { name: 'Notice', x: 20, y: 100, text: 'Two days’ notice', findings: ['fd_notice', 'fd_x'] },
      },
    ],
  });
}

describe('the order findings are offered in (decision 15)', () => {
  it('linked to the layers in scope first, then by kind, most useful to design first, oldest first within each', () => {
    const all = [
      finding('fd_risk', 'risk', DAY(1)),
      finding('fd_biz', 'business-requirement', DAY(1)),
      finding('fd_fun2', 'functional-requirement', DAY(3)),
      finding('fd_fun1', 'functional-requirement', DAY(2)),
      finding('fd_pref', 'design-preference', DAY(4)),
      finding('fd_budget', 'budget', DAY(0)),
      finding('fd_con', 'constraint', DAY(1)),
      finding('fd_link2', 'risk', DAY(5)),
      finding('fd_link1', 'budget', DAY(4)),
    ];
    expect(orderFindings(all, new Set(['fd_link1', 'fd_link2'])).map((f) => f.id)).toEqual([
      'fd_link1',
      'fd_link2',
      'fd_pref',
      'fd_fun1',
      'fd_fun2',
      'fd_con',
      'fd_biz',
      'fd_budget',
      'fd_risk',
    ]);
    // Deterministic: the same however they arrive.
    expect(orderFindings([...all].reverse(), new Set(['fd_link2', 'fd_link1']))).toEqual(
      orderFindings(all, new Set(['fd_link1', 'fd_link2'])),
    );
  });
});

describe('the record in the context (decisions 15 and 16)', () => {
  const offered = [
    finding('fd_old', 'expectation', DAY(1), 'Customers expect to pay by card.'),
    finding('fd_pay', 'functional-requirement', DAY(2), 'Customers pay online when they order.'),
    finding('fd_notice', 'constraint', DAY(3), 'Orders need two days’ notice.'),
  ];

  it('is left out entirely without findings: the context is as it always was', () => {
    const doc = screen();
    const without = buildContext(doc, ['pay']) as AiContext;
    const empty = buildContext(doc, ['pay'], { findings: [] }) as AiContext;
    expect(empty.text).toBe(without.text);
    expect(without.text).not.toContain('findings=');
    expect(without.findings).toEqual({ shown: [], real: new Map(), notShown: 0 });
  });

  it('comes after the screen, with short ids; the layers in scope’s findings first, and every linked layer names its own', () => {
    const ctx = buildContext(screen(), ['pay'], { findings: offered }) as AiContext;
    const text = ctx.text;
    expect(text).toContain('* e2 rect "Pay button" 200×48');
    expect(text).toMatch(/\* e2 rect "Pay button" .*findings=F1/);
    // The notice isn't in scope, but its line names its findings too; fd_x wasn't offered, so it isn't named.
    expect(text).toMatch(/e3 text "Notice" .*findings=F3$/m);
    expect(text.indexOf('Confirmed findings')).toBeGreaterThan(text.indexOf('e3 text'));
    expect(text).toContain('- F1 functional-requirement: "Customers pay online when they order."');
    expect(text).toContain('- F2 expectation: "Customers expect to pay by card."');
    expect(text).toContain('- F3 constraint: "Orders need two days’ notice."');
    expect([...ctx.findings.real]).toEqual([
      ['F1', 'fd_pay'],
      ['F2', 'fd_old'],
      ['F3', 'fd_notice'],
    ]);
  });

  it('uses at most a third of the budget, and says how many more weren’t shown', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      finding(
        `fd_${i}`,
        'design-preference',
        `2026-11-01T09:${String(i).padStart(2, '0')}:00.000Z`,
        `A preference ${'x'.repeat(60)} ${i}.`,
      ),
    );
    const maxChars = 3000;
    const ctx = buildContext(screen(), ['pay'], { findings: many, maxChars }) as AiContext;
    const section = ctx.text.slice(ctx.text.indexOf('Confirmed findings'));
    const shownLines = section.split('\n').filter((l) => /^- F\d+ /.test(l));
    expect(shownLines.length).toBe(ctx.findings.shown.length);
    expect(shownLines.join('\n').length).toBeLessThanOrEqual(maxChars / 3);
    expect(ctx.findings.notShown).toBe(40 - ctx.findings.shown.length);
    expect(ctx.findings.notShown).toBeGreaterThan(0);
    expect(section).toContain(`- … ${ctx.findings.notShown} more findings not shown`);
  });

  it('uses only what the screen leaves: on a crowded screen, none fits, no layer names one, and there is no findings section', () => {
    const ctx = buildContext(screen(), ['pay'], { findings: offered, maxChars: 150 }) as AiContext;
    expect(ctx.findings).toMatchObject({ shown: [], notShown: 3 });
    // The instructions and schema then have no findings (withFindings is false), so the context mentions none either.
    expect(ctx.text).not.toContain('Confirmed findings');
    expect(ctx.text).not.toContain('not shown');
    expect(ctx.text).not.toContain('findings=');
  });
});

describe('the schema, the instructions and the reply (decision 16)', () => {
  it('the schema and instructions have findings only when findings are offered', () => {
    expect(responseSchema()).toEqual(responseSchema({ findings: false }));
    expect(JSON.stringify(responseSchema())).not.toContain('findings');
    expect(responseSchema({ findings: true })).toMatchObject({
      properties: { findings: { type: 'array', items: { type: 'string' } } },
      required: ['explanation', 'operations', 'findings'],
    });
    expect(systemPrompt()).toBe(systemPrompt({ findings: false }));
    expect(systemPrompt()).not.toContain('FINDINGS');
    expect(systemPrompt({ findings: true })).toContain("FINDINGS FROM THE CLIENT'S RECORD");
    expect(systemPrompt({ findings: true })).toContain("You can't change findings or link layers to them.");
  });

  it('reads the findings drawn on: offered ids once each, in order; others ignored and counted', () => {
    const ctx = buildContext(screen(), ['pay'], {
      findings: [finding('fd_pay', 'functional-requirement', DAY(2)), finding('fd_notice', 'constraint', DAY(3))],
    }) as AiContext;
    expect(findingsDrawnOn(['F2', 'F1', 'F2', 'F9', 'fd_pay', 7], ctx)).toEqual({ drewOn: ['fd_notice', 'fd_pay'], ignored: 3 });
    expect(findingsDrawnOn(undefined, ctx)).toEqual({ drewOn: [], ignored: 0 });
    const result = interpret(
      JSON.stringify({
        explanation: 'Made it bigger.',
        operations: [{ op: 'update', id: 'e2', set: { height: 56 } }],
        findings: ['F1', 'F5'],
      }),
      screen(),
      ctx,
    );
    expect(result.ok && result.proposal).toMatchObject({ drewOn: ['fd_pay'], ignoredFindings: 1 });
  });

  it('the AI can’t link layers to findings', () => {
    const ctx = buildContext(screen(), ['pay'], { findings: [finding('fd_pay', 'functional-requirement', DAY(2))] }) as AiContext;
    const result = interpret(
      JSON.stringify({ explanation: 'Linked.', operations: [{ op: 'update', id: 'e2', set: { findings: ['fd_pay'] } }] }),
      screen(),
      ctx,
    );
    expect(result).toMatchObject({ ok: false, errors: ['Operation 1: "findings" is not a property you can set.'] });
  });
});

const CONFIG: AiConfig = {
  provider: 'ollama',
  providers: {
    ollama: { baseUrl: 'http://localhost:11434', model: 'qwen3:4b', contextSize: 8192, hasKey: false, keySource: null },
    openai: { baseUrl: 'https://api.openai.com/v1', model: '', hasKey: false, keySource: null },
    anthropic: { baseUrl: 'https://api.anthropic.com', model: '', hasKey: false, keySource: null },
  },
  configPath: '/tmp/ai.json',
};

function stream(text: string): Response {
  const body = `${JSON.stringify({ delta: text })}\n{"done":true}\n`;
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

/** A record source as the workspace would give one, counting its calls. */
function source(findings: () => RecordFinding[], leftOut: string | null = null) {
  const calls = { findings: 0, turns: 0, released: 0 };
  let onWait: ((wait: AiWait | null) => void) | null = null;
  const record: RecordSource = {
    findings: () => {
      calls.findings++;
      return { findings: findings(), leftOut };
    },
    href: (id) => `#/c/co_1/e/en_1/record/${id}`,
    takeTurn: async (_config, options) => {
      calls.turns++;
      onWait = options.onWait;
      return () => {
        calls.released++;
      };
    },
  };
  return { record, calls, wait: (w: AiWait | null) => onWait?.(w) };
}

function setup(record: RecordSource | null, configs: () => AiConfig = () => CONFIG) {
  const editor = new Editor(screen());
  editor.select(['pay']);
  const assistant = new Assistant(editor);
  assistant.setConfig(CONFIG);
  assistant.setRecord(record);
  const bodies: Record<string, unknown>[] = [];
  const replies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/config')) return new Response(JSON.stringify(configs()), { status: 200 });
      bodies.push(JSON.parse(init!.body as string));
      return stream(replies.shift()!);
    }),
  );
  return { editor, assistant, bodies, replies };
}

afterEach(() => vi.unstubAllGlobals());

describe('the assistant with the record', () => {
  const PAY = finding('fd_pay', 'functional-requirement', DAY(2), 'Customers pay online when they order.');

  it('offers the findings, pins the request to the settings checked, and shows what it drew on', async () => {
    const { record, calls } = source(() => [PAY], '1 finding left out: its session doesn’t allow AI on this computer.');
    const { assistant, bodies, replies } = setup(record);
    replies.push(
      JSON.stringify({
        explanation: 'Made the Pay button larger.',
        operations: [{ op: 'update', id: 'e2', set: { height: 56 } }],
        findings: ['F1', 'F4'],
      }),
    );
    await assistant.ask('make paying obvious');
    expect(calls).toMatchObject({ turns: 1, findings: 1, released: 1 });
    const sent = bodies[0] as {
      system: string;
      messages: { content: string }[];
      schema: unknown;
      provider: string;
      settings: unknown;
    };
    expect(sent.messages[0].content).toContain('- F1 functional-requirement: "Customers pay online when they order."');
    expect(sent.system).toContain("FINDINGS FROM THE CLIENT'S RECORD");
    expect(sent.schema).toMatchObject({ required: ['explanation', 'operations', 'findings'] });
    expect(sent).toMatchObject({ provider: 'ollama', settings: { baseUrl: 'http://localhost:11434', model: 'qwen3:4b' } });
    expect(assistant.getState()).toMatchObject({
      status: 'review',
      drewOn: [{ id: 'fd_pay', statement: 'Customers pay online when they order.', href: '#/c/co_1/e/en_1/record/fd_pay' }],
      ignoredFindings: 1,
      leftOut: '1 finding left out: its session doesn’t allow AI on this computer.',
    });
  });

  it('with no findings allowed, sends the request as the standalone editor does, and says why', async () => {
    const { record } = source(() => [], '2 findings left out: the client wasn’t told the AI may help sketch the screens.');
    const { assistant, bodies, replies } = setup(record);
    replies.push(JSON.stringify({ explanation: 'Done.', operations: [{ op: 'update', id: 'e2', set: { height: 56 } }] }));
    await assistant.ask('make it taller');
    const sent = bodies[0] as { system: string; schema: unknown; messages: { content: string }[] };
    expect(sent.system).toBe(systemPrompt());
    expect(sent.schema).toEqual(responseSchema());
    expect(sent.messages[0].content).not.toContain('Confirmed findings');
    expect(assistant.getState()).toMatchObject({ status: 'review', drewOn: [], leftOut: expect.stringContaining('2 findings') });
  });

  it('checks again before the repair, and stops if a finding it was given is no longer allowed', async () => {
    // Allowed when the request is sent; withdrawn by the time of the repair.
    let checks = 0;
    const { record, calls } = source(() => (checks++ === 0 ? [PAY] : []));
    const { assistant, bodies, replies, editor } = setup(record);
    // The first reply has a problem.
    replies.push(
      JSON.stringify({ explanation: 'x', operations: [{ op: 'update', id: 'e9', set: { height: 1 } }], findings: [] }),
    );
    const before = editor.getState().doc;
    await assistant.ask('make it taller');
    expect(bodies).toHaveLength(1);
    expect(calls.findings).toBe(2);
    expect(calls.released).toBe(1);
    expect(assistant.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('consent changed') });
    expect(editor.getState().doc).toBe(before);
  });

  it('takes its turn on the settings read now, not on what the tab last saw', async () => {
    // The tab still holds an external provider; the settings were changed to Ollama in another tab.
    const external: AiConfig = {
      ...CONFIG,
      provider: 'openai',
      providers: { ...CONFIG.providers, openai: { ...CONFIG.providers.openai, model: 'gpt-x', hasKey: true } },
    };
    const asked: AiConfig[] = [];
    const record: RecordSource = {
      findings: () => ({ findings: [PAY], leftOut: null }),
      href: (id) => id,
      takeTurn: async (config) => {
        asked.push(config);
        return () => undefined;
      },
    };
    const { assistant, bodies, replies } = setup(record);
    assistant.setConfig(external);
    replies.push(JSON.stringify({ explanation: 'Done.', operations: [], findings: [] }));
    await assistant.ask('make it taller');
    expect(asked.map((c) => c.provider)).toEqual(['ollama']);
    expect(bodies[0]).toMatchObject({ provider: 'ollama' });
  });

  it('takes its turn again when the settings change while it waits', async () => {
    const external: AiConfig = {
      ...CONFIG,
      provider: 'openai',
      providers: { ...CONFIG.providers, openai: { ...CONFIG.providers.openai, model: 'gpt-x', hasKey: true } },
    };
    // External when first read, Ollama by the time the turn is over.
    let reads = 0;
    const asked: string[] = [];
    let released = 0;
    const record: RecordSource = {
      findings: () => ({ findings: [PAY], leftOut: null }),
      href: (id) => id,
      takeTurn: async (config) => {
        asked.push(config.provider);
        return () => released++;
      },
    };
    const { assistant, bodies, replies } = setup(record, () => (reads++ === 0 ? external : CONFIG));
    replies.push(JSON.stringify({ explanation: 'Done.', operations: [], findings: [] }));
    await assistant.ask('make it taller');
    expect(asked).toEqual(['openai', 'ollama']);
    expect(released).toBe(2);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ provider: 'ollama' });
  });

  it('the standalone editor has no record: no turn, no findings, no pinning', async () => {
    const { assistant, bodies, replies } = setup(null);
    replies.push(JSON.stringify({ explanation: 'Done.', operations: [{ op: 'update', id: 'e2', set: { height: 56 } }] }));
    await assistant.ask('make it taller');
    expect(bodies[0]).not.toHaveProperty('provider');
    expect((bodies[0] as { system: string }).system).toBe(systemPrompt());
    expect(assistant.getState()).toMatchObject({ status: 'review', drewOn: [], leftOut: null, wait: null });
  });

  it('says what a local request waits for, and Stop ends the wait before anything is sent', async () => {
    let release = 0;
    let started: (() => void) | null = null;
    const record: RecordSource = {
      findings: () => ({ findings: [PAY], leftOut: null }),
      href: (id) => id,
      takeTurn: (_config, { signal, onWait }) =>
        new Promise((resolve, reject) => {
          onWait({ message: 'Waiting: a transcription is going on this computer.', cooling: false });
          started = () => resolve(() => release++);
          signal.addEventListener('abort', () => reject(new Error('Stopped.')));
        }),
    };
    const { assistant, bodies } = setup(record);
    const asking = assistant.ask('make it taller');
    await vi.waitFor(() => expect(assistant.getState().wait?.message).toContain('a transcription'));
    expect(assistant.getState().status).toBe('thinking');
    assistant.stop();
    await asking;
    expect(bodies).toHaveLength(0);
    expect(assistant.getState()).toMatchObject({ status: 'idle', wait: null });
    expect(started).not.toBeNull();
    expect(release).toBe(0);
  });

  it('“Don’t wait” is passed to the cooling wait', async () => {
    let skip: (() => boolean) | null = null;
    const record: RecordSource = {
      findings: () => ({ findings: [], leftOut: null }),
      href: (id) => id,
      takeTurn: async (_config, options) => {
        skip = options.skipCooling;
        return () => undefined;
      },
    };
    const { assistant, replies } = setup(record);
    replies.push(JSON.stringify({ explanation: 'Done.', operations: [] }));
    const asking = assistant.ask('anything');
    await vi.waitFor(() => expect(skip).not.toBeNull());
    expect(skip!()).toBe(false);
    assistant.dontWait();
    expect(skip!()).toBe(true);
    await asking;
  });
});
