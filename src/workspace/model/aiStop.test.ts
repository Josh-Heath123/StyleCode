import { describe, expect, it } from 'vitest';
import { clearAiStop, noteAiStop } from './aiStop';
import { sampleWorkspace } from './fixtures';
import { validateWorkspace } from './validate';
import { parseWorkspace } from './workspace';

const STOP = {
  at: '2026-11-17T12:16:55.000Z',
  reason: 'The local AI didn’t answer.',
  partsDone: 9,
  parts: 13,
  model: 'qwen3:4b',
};

describe('a stopped AI run kept with its session (version 5)', () => {
  it('keeps the last stop, valid, and clears it', () => {
    const ws = sampleWorkspace();
    const noted = noteAiStop(ws, 'se_1', STOP);
    expect(noted.ok).toBe(true);
    if (!noted.ok) return;
    expect(noted.value.sessions.se_1.aiStop).toEqual(STOP);
    expect(validateWorkspace(noted.value)).toEqual([]);
    const later = noteAiStop(noted.value, 'se_1', { ...STOP, partsDone: 2, reason: '  Another reason. ' });
    expect(later.ok && later.value.sessions.se_1.aiStop).toMatchObject({ partsDone: 2, reason: 'Another reason.' });
    const cleared = clearAiStop(noted.value, 'se_1');
    expect(cleared.ok && cleared.value.sessions.se_1.aiStop).toBeNull();
  });

  it('refuses a stop that doesn’t add up, or for a session that isn’t there', () => {
    const ws = sampleWorkspace();
    expect(noteAiStop(ws, 'se_9', STOP).ok).toBe(false);
    expect(noteAiStop(ws, 'se_1', { ...STOP, partsDone: 14 }).ok).toBe(false);
    expect(noteAiStop(ws, 'se_1', { ...STOP, reason: ' ' }).ok).toBe(false);
    const bad = sampleWorkspace();
    bad.sessions.se_1.aiStop = { ...STOP, partsDone: -1 };
    expect(validateWorkspace(bad).map((p) => p.code)).toContain('session.aiStop');
  });

  it('migrates version 4: every session has no stop', () => {
    const v4 = sampleWorkspace() as unknown as { version: number; sessions: Record<string, Record<string, unknown>> };
    v4.version = 4;
    delete v4.sessions.se_1.aiStop;
    const parsed = parseWorkspace(v4);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.workspace.version).toBe(6);
    expect(parsed.workspace.sessions.se_1.aiStop).toBeNull();
    expect(parsed.problems).toEqual([]);
  });
});
