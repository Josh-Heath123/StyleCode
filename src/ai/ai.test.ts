import { describe, expect, it } from 'vitest';
import { buildDoc } from '../codegen/fixtures';
import { applyOps } from '../model/ops';
import { PROPERTY_DEFS } from '../model/properties';
import type { DesignDocument } from '../model/types';
import { buildContext, resolveTarget, type AiContext } from './context';
import { suggestionsFor } from './suggestions';
import { createNode } from '../model/defaults';
import { systemPrompt, userMessage } from './prompt';
import { interpret, streamedExplanation } from './proposal';
import { AI_PROPERTIES, responseSchema } from './schema';

/** A pricing page: a column with a title and a row of two plan cards. */
function page(): DesignDocument {
  const plan = (id: string, name: string) => ({
    type: 'frame' as const,
    id,
    props: { name, layout: 'column' as const, gap: 8, width: 300, heightMode: 'hug' as const, fill: '#ffffff' },
    children: [{ type: 'text' as const, id: `${id}-name`, props: { name: 'Name', text: name } }],
  });
  return buildDoc({
    type: 'frame',
    id: 'screen',
    props: { name: 'Pricing', layout: 'column', width: 1280, height: 800 },
    children: [
      { type: 'text', id: 'title', props: { name: 'Title', text: 'Pricing', fontSize: 28 } },
      {
        type: 'frame',
        id: 'plans',
        props: { name: 'Plans', layout: 'row', gap: 24, widthMode: 'hug', heightMode: 'hug' },
        children: [plan('basic', 'Basic'), plan('pro', 'Pro')],
      },
      { type: 'rect', id: 'sticker', props: { name: 'Sticker', locked: true } },
    ],
  });
}

const ctxFor = (doc: DesignDocument, selection: string[]) => buildContext(doc, selection) as AiContext;
const reply = (operations: unknown[], explanation = 'Done.') => JSON.stringify({ explanation, operations });

describe('response schema', () => {
  it('lists every property the AI may set, flat and without length limits', () => {
    const schema = responseSchema();
    const text = JSON.stringify(schema);
    expect(text).not.toContain('$ref');
    expect(text).not.toContain('maxLength');
    expect(Object.keys((schema.properties as object) ?? {})).toEqual(['explanation', 'operations']);
    const update = ((schema.properties as any).operations.items.anyOf as any[]).find((o) => o.properties.op.enum[0] === 'update');
    expect(Object.keys(update.properties.set.properties).sort()).toEqual([...AI_PROPERTIES].sort());
    expect(AI_PROPERTIES).not.toContain('locked');
    expect(AI_PROPERTIES).not.toContain('src');
  });

  it('describes every settable property in the instructions', () => {
    const prompt = systemPrompt();
    for (const key of AI_PROPERTIES) expect(prompt).toContain(`- ${key} (`);
    expect(prompt).toContain(PROPERTY_DEFS.gap.description);
  });
});

describe('context', () => {
  it('uses short ids, marks what may change and shows its properties in full', () => {
    const doc = page();
    const ctx = ctxFor(doc, ['basic']);
    expect(ctx.scope).toEqual({ kind: 'selection', roots: ['basic'] });
    expect(ctx.real.get('e1')).toBe('screen');
    const basic = ctx.alias.get('basic')!;
    const lines = ctx.text.split('\n');
    expect(lines.find((l) => l.includes(`* ${basic} frame "Basic"`))).toContain('gap=8');
    // Out of scope: a short summary, no detailed properties.
    const pro = lines.find((l) => l.includes(`${ctx.alias.get('pro')} frame "Pro"`))!;
    expect(pro.startsWith('    *')).toBe(false);
    expect(pro).not.toContain('gap=');
    expect(lines.find((l) => l.includes('"Sticker"'))).toContain('locked');
    expect(ctx.targetLabel).toBe('“Basic”');
    expect(userMessage(ctx, ' make it pop ')).toMatch(/\n\nRequest: make it pop$/);
  });

  it('works on the screen in view when nothing is selected, and trims to a budget', () => {
    const doc = page();
    const whole = buildContext(doc, [], { fallbackScreen: 'screen' }) as AiContext;
    expect(whole.scope).toEqual({ kind: 'screen', roots: ['screen'] });
    expect(buildContext(doc, [])).toEqual({ error: 'Draw a frame first, or select the layers to change.' });
    const tight = buildContext(doc, ['title'], { maxChars: 10 }) as AiContext;
    expect(tight.text).toContain('more layers not shown');
    expect(tight.text).toContain(`* ${tight.alias.get('title')} text`);
  });
});

describe('notes', () => {
  it('keeps notes inside the context budget', () => {
    const doc = page();
    const ops = Array.from({ length: 30 }, (_, i) => ({
      type: 'create' as const,
      parentId: doc.rootId,
      index: 99,
      nodes: [createNode('note', { text: `Note ${i}: ${'make it better '.repeat(40)}`, noteTarget: 'pro' }, `n_${i}`)],
    }));
    const withNotes = applyOps(doc, ops).doc;
    const ctx = buildContext(withNotes, ['basic'], { maxChars: 8000 }) as AiContext;
    expect(ctx.text.length).toBeLessThan(8000 + 400);
    expect(ctx.text).toContain('more notes not shown');
    expect(ctx.text).toContain('Note 0:');
  });

  it('tells the model about the designer’s notes on the screen, never as something it may change', () => {
    const doc = page();
    const note = (id: string, props: Record<string, unknown>) =>
      applyOps(doc, [{ type: 'create', parentId: doc.rootId, index: 99, nodes: [{ ...createNode('note', props as never, id) }] }])
        .doc;
    let withNotes = note('n_pointing', { text: 'Make this the hero plan', noteTarget: 'pro', x: 2000, y: 2000 });
    withNotes = applyOps(withNotes, [
      {
        type: 'create',
        parentId: doc.rootId,
        index: 99,
        nodes: [createNode('note', { text: 'Use our brand blue', x: 10, y: 10 }, 'n_over')],
      },
      {
        type: 'create',
        parentId: doc.rootId,
        index: 99,
        nodes: [createNode('note', { text: 'Somewhere else', x: 5000, y: 5000 }, 'n_far')],
      },
    ]).doc;
    const ctx = buildContext(withNotes, ['basic']) as AiContext;
    expect(ctx.notes).toBe(2);
    expect(ctx.text).toContain('Notes from the designer:');
    expect(ctx.text).toContain(`- "Make this the hero plan" (on ${ctx.alias.get('pro')} "Pro")`);
    expect(ctx.text).toContain('- "Use our brand blue"');
    expect(ctx.text).not.toContain('Somewhere else');
    expect([...ctx.alias.keys()]).not.toContain('n_over');
    expect(systemPrompt()).toContain('notes on the canvas');
    const target = resolveTarget(withNotes, ['basic']);
    expect('error' in target ? [] : suggestionsFor(withNotes, ['basic'], target)[0]).toBe('Do what the notes say');
    // A note can't be created or changed by the AI.
    const reply = JSON.stringify({
      explanation: '',
      operations: [{ op: 'create', ref: 'n1', parent: ctx.alias.get('basic'), type: 'note', set: {} }],
    });
    expect(interpret(reply, withNotes, ctx).ok).toBe(false);
  });
});

describe('interpreting replies', () => {
  it('turns operations into changes, with new layers referring to each other', () => {
    const doc = page();
    const ctx = ctxFor(doc, ['basic']);
    const basic = ctx.alias.get('basic')!;
    const result = interpret(
      reply([
        { op: 'update', id: basic, set: { fill: '#11141a', radius: 16 } },
        { op: 'create', ref: 'n1', parent: basic, type: 'frame', set: { name: 'Actions', layout: 'row', fill: null } },
        { op: 'create', ref: 'n2', parent: 'n1', type: 'text', set: { text: 'Choose' } },
      ]),
      doc,
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = applyOps(doc, result.proposal.ops).doc;
    expect(after.nodes.basic).toMatchObject({ fill: '#11141a', radius: 16 });
    const actions = after.nodes[after.nodes.basic.children[1]];
    expect(actions).toMatchObject({ name: 'Actions', layout: 'row', fill: null });
    expect(after.nodes[actions.children[0]].text).toBe('Choose');
    expect(result.proposal.changed).toEqual(['basic']);
    expect(result.proposal.created).toHaveLength(2);
    expect(result.proposal.summary).toBe('Changes 1 layer and adds 2.');
  });

  it('keeps to the layers it was given and never touches locked ones', () => {
    const doc = page();
    const ctx = ctxFor(doc, ['basic']);
    const result = interpret(
      reply([
        { op: 'update', id: ctx.alias.get('pro'), set: { fill: '#000000' } },
        { op: 'delete', id: ctx.alias.get('sticker') },
        { op: 'update', id: ctx.alias.get('basic'), set: { locked: true, wobble: 3 } },
        { op: 'update', id: 'e99', set: {} },
        { op: 'update', id: ctx.alias.get('basic-name'), set: { fill: 'reddish' } },
      ]),
      doc,
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      `Operation 1: ${ctx.alias.get('pro')} isn’t one of the layers you may change (marked *).`,
      `Operation 2: ${ctx.alias.get('sticker')} isn’t one of the layers you may change (marked *).`,
      'Operation 3: "locked" is not a property you can set.',
      'Operation 3: "wobble" is not a property you can set.',
      'Operation 4: there is no layer "e99".',
      'Operation 5: fill must be a hex colour like #2f7bff, got "reddish"',
    ]);
  });

  it('allows new layers next to the selection, moves, tidying and deletions', () => {
    const doc = page();
    const ctx = ctxFor(doc, ['basic', 'pro']);
    const plans = ctx.alias.get('plans')!;
    const result = interpret(
      reply([
        { op: 'create', ref: 'n1', parent: plans, index: 0, type: 'frame', set: { name: 'Free', width: 200, height: 200 } },
        { op: 'move', id: ctx.alias.get('pro'), parent: plans, index: 0 },
        { op: 'delete', id: ctx.alias.get('basic-name') },
      ]),
      doc,
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = applyOps(doc, result.proposal.ops).doc;
    expect(after.nodes.plans.children[0]).toBe('pro');
    expect(after.nodes.basic.children).toEqual([]);
    expect(result.proposal.removed).toEqual(['basic-name']);
    // Changing something that isn't selected, even next to it, is refused.
    const outside = interpret(reply([{ op: 'update', id: plans, set: { gap: 4 } }]), doc, ctx);
    expect(outside.ok).toBe(false);
  });

  it('asks for a second look before deleting a lot, and accepts a reply that changes nothing', () => {
    const doc = page();
    const ctx = buildContext(doc, [], { fallbackScreen: 'screen' }) as AiContext;
    const big = interpret(reply([{ op: 'delete', id: ctx.alias.get('plans') }]), doc, ctx);
    expect(big.ok && big.proposal.needsConfirmation).toBe(true);
    expect(big.ok && big.proposal.removedCount).toBe(5);
    const none = interpret('```json\n{"explanation": "That needs a photo I don’t have.", "operations": []}\n```', doc, ctx);
    expect(none).toMatchObject({ ok: true, proposal: { ops: [], explanation: 'That needs a photo I don’t have.' } });
    expect(interpret('Sure! Here you go.', doc, ctx)).toEqual({ ok: false, errors: ['The reply was not a JSON object.'] });
    expect(interpret(reply([{ op: 'delete', id: 'e1' }]), doc, ctx)).toMatchObject({
      ok: false,
      errors: ['Operation 1: the screen itself can’t be deleted.'],
    });
  });

  it('protects locked layers inside what it may change, however the change is made', () => {
    const doc = buildDoc({
      type: 'frame',
      id: 'screen',
      props: { name: 'Screen', width: 800, height: 600 },
      children: [
        {
          type: 'frame',
          id: 'card',
          props: { name: 'Card', x: 20, y: 20, width: 300, height: 200 },
          children: [
            { type: 'rect', id: 'badge', props: { name: 'Badge', x: 10, y: 10, width: 40, height: 20, locked: true } },
            { type: 'rect', id: 'line', props: { name: 'Line', x: 10, y: 80, width: 200, height: 4 } },
          ],
        },
        { type: 'frame', id: 'vault', props: { name: 'Vault', x: 400, y: 20, width: 200, height: 200, locked: true } },
        { type: 'rect', id: 'loose', props: { name: 'Loose', x: 400, y: 300, width: 50, height: 50 } },
      ],
    });
    const ctx = buildContext(doc, [], { fallbackScreen: 'screen' }) as AiContext;
    const a = (id: string) => ctx.alias.get(id)!;
    const one = (op: unknown) => interpret(reply([op]), doc, ctx);
    expect(one({ op: 'delete', id: a('card') })).toMatchObject({
      ok: false,
      errors: [expect.stringContaining('locked layers inside')],
    });
    expect(one({ op: 'tidy', id: a('card') })).toMatchObject({
      ok: false,
      errors: [expect.stringContaining('locked layers inside')],
    });
    expect(one({ op: 'move', id: a('loose'), parent: a('vault') })).toMatchObject({
      ok: false,
      errors: [`Operation 1: ${a('vault')} is locked.`],
    });
    expect(one({ op: 'create', ref: 'n1', parent: a('vault'), type: 'rect', set: {} })).toMatchObject({ ok: false });
    expect(one({ op: 'update', id: a('badge'), set: { fill: '#ff0000' } })).toMatchObject({ ok: false });
    // Changing the frame around a locked layer, or moving that frame, is fine.
    expect(one({ op: 'update', id: a('card'), set: { fill: '#000000', x: 40 } }).ok).toBe(true);
    expect(one({ op: 'delete', id: a('line') }).ok).toBe(true);
  });

  it('tidies a frame the AI was given', () => {
    const doc = buildDoc({
      type: 'frame',
      id: 'screen',
      props: { name: 'Sketch', width: 600, height: 400 },
      children: [
        { type: 'rect', id: 'a', props: { x: 40, y: 40, width: 100, height: 50 } },
        { type: 'rect', id: 'b', props: { x: 40, y: 120, width: 100, height: 50 } },
      ],
    });
    const ctx = ctxFor(doc, ['screen']);
    const result = interpret(reply([{ op: 'tidy', id: 'e1' }]), doc, ctx);
    expect(result.ok && applyOps(doc, result.proposal.ops).doc.nodes.screen.layout).toBe('column');
  });
});

describe('streamed explanation', () => {
  it('reads the explanation while the reply is still arriving', () => {
    expect(streamedExplanation('{"expl')).toBeNull();
    expect(streamedExplanation('{"explanation": "Made it')).toBe('Made it');
    expect(streamedExplanation('{"explanation":"A \\"quoted\\" word\\n')).toBe('A "quoted" word\n');
    expect(streamedExplanation('{"explanation": "caf\\u00e9 done", "operations": [')).toBe('café done');
    expect(streamedExplanation('{"explanation": "half \\u00')).toBe('half ');
  });
});
