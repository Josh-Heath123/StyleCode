import { describe, expect, it } from 'vitest';
import {
  addParticipant,
  consentSummary,
  createEngagement,
  createSession,
  editEngagement,
  editParticipant,
  editSession,
  participantChangeClearsConfirmation,
  sessionTimeClearsConfirmation,
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
    expect(value(editParticipant(workspace, id, { role: 'Head baker' }, AT)).participants[id].role).toBe('Head baker');
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
    expect(editParticipant(unlocked, 'pa_client', { side: 'consultant' }, AT)).toMatchObject({
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

describe('a locked consent record keeps who was asked, and when (review of Slice B, finding 2)', () => {
  it('refuses changes to an asked participant’s details, or the session’s time, while the record is locked', () => {
    const ws = sampleWorkspace(); // Its record is locked: a transcript was imported.
    expect(editParticipant(ws, 'pa_client', { name: 'Jo Baker' }, AT)).toMatchObject({ ok: false });
    expect(editParticipant(ws, 'pa_client', { role: 'Manager' }, AT)).toMatchObject({ ok: false });
    expect(editSession(ws, 'se_1', { startsAt: '2026-11-05T09:00:00.000Z' }, AT)).toMatchObject({ ok: false });
    // Someone not asked, and the session's title, can still change.
    expect(editParticipant(ws, 'pa_me', { role: 'Lead consultant' }, AT).ok).toBe(true);
    expect(editSession(ws, 'se_1', { title: 'Kick-off meeting' }, AT).ok).toBe(true);
    // While the record isn't locked, the details can change.
    const unlocked = structuredClone(ws);
    unlocked.consents.cr_1.lockedAt = null;
    expect(editParticipant(unlocked, 'pa_client', { name: 'Alex Owner-Baker' }, AT).ok).toBe(true);
  });
});

describe('changing who was asked, or when, on a confirmed record clears its confirmation (C3)', () => {
  /** The sample, with its record confirmed but not locked (no transcript yet). */
  const confirmed = () => {
    const ws = sampleWorkspace();
    ws.transcripts = {};
    ws.segments = {};
    ws.findings = {};
    ws.relations = {};
    ws.consents.cr_1.lockedAt = null;
    return ws;
  };

  it('for an asked participant’s name, role or organisation, in the same step, and says so beforehand', () => {
    const ws = confirmed();
    expect(participantChangeClearsConfirmation(ws, 'pa_client', { role: 'Founder' })).toBe(true);
    expect(participantChangeClearsConfirmation(ws, 'pa_client', { role: 'Owner' })).toBe(false);
    expect(participantChangeClearsConfirmation(ws, 'pa_me', { role: 'Lead' })).toBe(false);
    const edited = value(editParticipant(ws, 'pa_client', { role: 'Founder' }, AT));
    expect(edited.participants.pa_client.role).toBe('Founder');
    expect(edited.consents.cr_1).toMatchObject({ confirmed: null, updatedAt: AT });
    expect(codes(edited)).toEqual([]);
    // Someone not asked changes nothing on the record.
    expect(value(editParticipant(ws, 'pa_me', { role: 'Lead' }, AT)).consents.cr_1.confirmed).not.toBeNull();
  });

  it('for the session’s date or time, but not its title', () => {
    const ws = confirmed();
    expect(sessionTimeClearsConfirmation(ws, 'se_1')).toBe(true);
    const moved = value(editSession(ws, 'se_1', { startsAt: '2026-11-05T09:00:00.000Z' }, AT));
    expect(moved.consents.cr_1.confirmed).toBeNull();
    expect(value(editSession(ws, 'se_1', { title: 'Kick-off meeting' }, AT)).consents.cr_1.confirmed).not.toBeNull();
  });

  it('not for a draft, and a locked record keeps refusing', () => {
    const draft = confirmed();
    draft.consents.cr_1.confirmed = null;
    expect(participantChangeClearsConfirmation(draft, 'pa_client', { role: 'Founder' })).toBe(false);
    expect(sessionTimeClearsConfirmation(draft, 'se_1')).toBe(false);
    expect(sessionTimeClearsConfirmation(sampleWorkspace(), 'se_1')).toBe(false);
    expect(editParticipant(sampleWorkspace(), 'pa_client', { role: 'Founder' }, AT).ok).toBe(false);
  });
});
