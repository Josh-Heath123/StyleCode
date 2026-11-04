import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDoc } from '../codegen/fixtures';
import { Editor } from '../editor/editor';
import { createDocument } from '../model/document';
import { Assistant } from './assistant';
import type { AiConfig } from './client';

/**
 * The assistant's state machine, with the local server replaced by a fake
 * `fetch` that streams replies the way `/api/ai/chat` does.
 */

const CONFIG: AiConfig = {
  provider: 'ollama',
  providers: {
    ollama: { baseUrl: 'http://localhost:11434', model: 'test', contextSize: 8192, hasKey: false, keySource: null },
    openai: { baseUrl: 'https://api.openai.com/v1', model: '', hasKey: false, keySource: null },
    anthropic: { baseUrl: 'https://api.anthropic.com', model: '', hasKey: false, keySource: null },
  },
  configPath: '/tmp/ai.json',
};

function stream(lines: string[], hold?: Promise<void>): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
        if (hold) await hold;
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
  );
}

const reply = (operations: unknown[], explanation = 'Done.') => JSON.stringify({ explanation, operations });

function setup() {
  const doc = buildDoc({
    type: 'frame',
    id: 'screen',
    props: { name: 'Screen', width: 800, height: 600 },
    children: [{ type: 'rect', id: 'box', props: { name: 'Box', x: 20, y: 20, width: 100, height: 100 } }],
  });
  const editor = new Editor(doc);
  editor.select(['box']);
  const assistant = new Assistant(editor);
  assistant.setConfig(CONFIG);
  return { editor, assistant };
}

afterEach(() => vi.unstubAllGlobals());

describe('Assistant', () => {
  it('streams a reply into a proposal, and accepting records one AI step', async () => {
    const { editor, assistant } = setup();
    const replies = [reply([{ op: 'update', id: 'e2', set: { fill: '#11141a' } }], 'Darkened the box.')];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.messages[0].content).toContain('* e2 rect "Box"');
      const text = replies.shift()!;
      // Sent in pieces, as a provider would.
      return stream([JSON.stringify({ delta: text.slice(0, 20) }), JSON.stringify({ delta: text.slice(20) }), '{"done":true}']);
    });
    vi.stubGlobal('fetch', fetch);

    await assistant.ask('make it dark');
    expect(assistant.getState()).toMatchObject({
      status: 'review',
      explanation: 'Darkened the box.',
      summary: 'Changes 1 layer.',
    });
    expect(editor.getState().doc.nodes.box.fill).toBe('#11141a');
    expect(editor.committedDoc.nodes.box.fill).not.toBe('#11141a');

    assistant.accept();
    expect(assistant.getState().status).toBe('idle');
    expect(editor.history.peekUndo()).toMatchObject({ label: 'AI: make it dark', source: 'ai' });
    editor.undo();
    expect(editor.getState().doc.nodes.box.fill).not.toBe('#11141a');
  });

  it('tries one repair, then reports what was still wrong without changing anything', async () => {
    const { editor, assistant } = setup();
    const bodies: { messages: { role: string; content: string }[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return stream([JSON.stringify({ delta: reply([{ op: 'update', id: 'e9', set: { x: 1 } }]) })]);
      }),
    );
    const before = editor.getState().doc;
    await assistant.ask('move it');
    expect(bodies).toHaveLength(2);
    expect(bodies[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(bodies[1].messages[2].content).toContain('there is no layer "e9"');
    expect(assistant.getState()).toMatchObject({ status: 'error', problems: ['Operation 1: there is no layer "e9".'] });
    expect(editor.getState().doc).toBe(before);
  });

  it('reports a server error line in plain words', async () => {
    const { assistant } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream([JSON.stringify({ error: 'Couldn’t reach Ollama.' })])),
    );
    await assistant.ask('anything');
    expect(assistant.getState()).toMatchObject({ status: 'error', error: 'Couldn’t reach Ollama.' });
  });

  it('drops a request in progress when another project is opened', async () => {
    const { editor, assistant } = setup();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return stream([JSON.stringify({ delta: '{"explanation": "Working' })], hold);
      }),
    );
    const asking = assistant.ask('make it dark');
    await vi.waitFor(() => expect(assistant.getState().explanation).toBe('Working'));
    editor.loadDocument(createDocument('Other'));
    expect(assistant.getState().status).toBe('idle');
    expect(signal?.aborted).toBe(true);
    release();
    await asking;
    expect(assistant.getState().status).toBe('idle');
    expect(editor.hasProposal).toBe(false);
  });

  it('waits for an edit in progress to finish before showing the proposal', async () => {
    const { editor, assistant } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream([JSON.stringify({ delta: reply([{ op: 'update', id: 'e2', set: { radius: 12 } }]) })])),
    );
    editor.setEditingText('box');
    const asking = assistant.ask('round it');
    await vi.waitFor(() => expect(assistant.getState().phase).toBe('waiting'));
    expect(editor.hasProposal).toBe(false);
    // The edit finishes (here: the text editor closes after a change); the reply is checked again and shown.
    editor.setEditingText(null);
    editor.apply([{ type: 'update', id: 'box', props: { x: 60 } }], { label: 'Move' });
    await asking;
    expect(assistant.getState().status).toBe('review');
    expect(editor.getState().doc.nodes.box).toMatchObject({ x: 60, radius: 12 });
  });

  it('says what is needed before asking: settings, or something to change', async () => {
    const { editor, assistant } = setup();
    assistant.setConfig({ ...CONFIG, provider: 'off' });
    await assistant.ask('hello');
    expect(assistant.getState().error).toBe('Choose an AI provider and model in AI settings first.');
    assistant.setConfig(CONFIG);
    editor.loadDocument(createDocument('Empty'));
    await assistant.ask('hello');
    expect(assistant.getState().error).toBe('Draw a frame first, or select the layers to change.');
  });
});
