import { describe, expect, it } from 'vitest';
import {
  addParticipant,
  consentSummary,
  createEngagement,
  createSession,
  editEngagement,
  editParticipant,
  editSession,
  removeParticipant,
} from './entities';
import { consentRecord, sampleWorkspace, T3 } from './fixtures';
import type { CompanyWorkspace } from './types';
import { validateWorkspace } from './validate';
import { createWorkspace } from './workspace';

const AT = '2026-11-06T10:00:00.000Z';
const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);
function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('engagements (MVP 2.1)', () => {
  it('creates one in the company, valid, and edits it', () => {
    const empty = createWorkspace({ name: 'Harbour Bakery' }, AT);
    const { workspace, id } = value(
      createEngagement(empty, { name: ' Online ordering ', goal: 'Take cake orders online.', status: { state: 'active' } }, AT),
    );
    expect(workspace.engagements[id]).toMatchObject({ companyId: empty.company.id, name: 'Online ordering', createdAt: AT });
    expect(codes(workspace)).toEqual([]);

    const ended = value(editEngagement(workspace, id, { status: { state: 'ended', endedOn: '2026-12-01' } }, T3));
    expect(ended.engagements[id]).toMatchObject({ status: { state: 'ended', endedOn: '2026-12-01' }, updatedAt: T3 });
    expect(codes(ended)).toEqual([]);
  });

  it('refuses an empty name or an end without a date, and records nothing when nothing changes', () => {
    const ws = sampleWorkspace();
    expect(createEngagement(ws, { name: ' ', goal: '', status: { state: 'active' } }, AT).ok).toBe(false);
    expect(editEngagement(ws, 'en_1', { status: { state: 'ended', endedOn: 'soon' } }, AT).ok).toBe(false);
    expect(editEngagement(ws, 'en_1', { name: 'Online ordering' }, AT)).toEqual({ ok: true, value: ws });
    expect(editEngagement(ws, 'en_none', { name: 'x' }, AT).ok).toBe(false);
  });
});

describe('sessions (MVP 2.2)', () => {
  it('creates one in an engagement, valid, and edits it', () => {
    const { workspace, id } = value(createSession(sampleWorkspace(), 'en_1', { title: 'Follow-up', startsAt: AT }, AT));
    expect(workspace.sessions[id]).toMatchObject({ engagementId: 'en_1', title: 'Follow-up', audioFileIds: [] });
    expect(codes(workspace)).toEqual([]);
    const moved = value(editSession(workspace, id, { startsAt: '2026-11-07T09:30:00.000Z' }, T3));
    expect(moved.sessions[id].startsAt).toBe('2026-11-07T09:30:00.000Z');
  });

  it('refuses a missing engagement, an empty title or a time that is not one', () => {
    const ws = sampleWorkspace();
    expect(createSession(ws, 'en_none', { title: 'x', startsAt: AT }, AT).ok).toBe(false);
    expect(createSession(ws, 'en_1', { title: '  ', startsAt: AT }, AT).ok).toBe(false);
    expect(editSession(ws, 'se_1', { startsAt: '7 November' }, AT).ok).toBe(false);
  });
});

describe('participants (MVP 2.2)', () => {
  it('adds one on either side, valid, and edits them', () => {
    const { workspace, id } = value(
      addParticipant(sampleWorkspace(), 'se_1', {
        name: 'Jo Baker',
        role: 'Manager',
        organisation: 'Harbour Bakery',
        side: 'client',
      }),
    );
    expect(workspace.participants[id]).toMatchObject({ name: 'Jo Baker', side: 'client', speakerLabels: [] });
    expect(codes(workspace)).toEqual([]);
    expect(value(editParticipant(workspace, id, { role: 'Head baker' })).participants[id].role).toBe('Head baker');
    expect(addParticipant(workspace, 'se_1', { name: '', role: '', organisation: '', side: 'client' }).ok).toBe(false);
  });

  it('keeps someone the consent form names as asked: they can’t be removed or moved to the consultant’s side', () => {
    const ws = sampleWorkspace();
    // The sample's record is locked (a transcript was imported), so it can't change either.
    expect(removeParticipant(ws, 'pa_client')).toEqual({
      ok: false,
      error: 'Alex Owner is named on the consent record as asked, and the record can no longer be changed, so they stay.',
    });
    const unlocked = structuredClone(ws);
    unlocked.consents.cr_1.lockedAt = null;
    expect(removeParticipant(unlocked, 'pa_client')).toEqual({
      ok: false,
      error:
        'Alex Owner is named on the consent form as asked. To remove them, untick them under “Who was asked” on the consent form first.',
    });
    expect(editParticipant(unlocked, 'pa_client', { side: 'consultant' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('To move them to your side, untick them'),
    });
    // Someone not named on the form goes, and the workspace stays valid.
    const removed = value(removeParticipant(ws, 'pa_me'));
    expect(removed.participants.pa_me).toBeUndefined();
    expect(codes(removed)).toEqual([]);
  });
});

describe('consent in a word, for the session list', () => {
  it('says how far each session’s consent got', () => {
    const ws = sampleWorkspace();
    expect(consentSummary(ws, 'se_1')).toBe('given');
    ws.consents.cr_1 = consentRecord({ outcome: { kind: 'limited', limits: 'No recording.' } });
    expect(consentSummary(ws, 'se_1')).toBe('given with limits');
    ws.consents.cr_1 = consentRecord({ confirmed: null, lockedAt: null });
    expect(consentSummary(ws, 'se_1')).toBe('not confirmed');
    ws.consents.cr_1 = consentRecord({ amendments: [{ id: 'am_1', kind: 'withdrawal', by: 'Sam', at: T3, reason: 'Asked.' }] });
    expect(consentSummary(ws, 'se_1')).toBe('withdrawn');
    ws.consents = {};
    expect(consentSummary(ws, 'se_1')).toBe('not filled in');
  });
});
