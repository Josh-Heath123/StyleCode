import { describe, expect, it } from 'vitest';
import { consentState } from './consent';
import {
  confirmIssues,
  consentFormFor,
  decline,
  saveConsentForm,
  saveIssues,
  withdrawConsent,
  type ConsentFormValues,
} from './consentForm';
import { sampleWorkspace, T0 } from './fixtures';
import type { CompanyWorkspace } from './types';
import { validateWorkspace } from './validate';
import { CURRENT_WORDING, wordingFor } from './wording';

const AT = '2026-11-06T10:00:00.000Z';
const LATER = '2026-11-06T11:00:00.000Z';
const ANTHROPIC = 'Anthropic (api.anthropic.com)';
const codes = (ws: CompanyWorkspace) => validateWorkspace(ws).map((p) => p.code);
function value<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** The sample workspace before anything was captured: no consent record, no transcript, no findings. */
function blank(): CompanyWorkspace {
  const ws = sampleWorkspace();
  return { ...ws, consents: {}, transcripts: {}, segments: {}, findings: {}, relations: {} };
}

/** A filled-in form: told everything for transcription and AI on this computer, and agreed to both. */
function filled(ws: CompanyWorkspace, changes: Partial<ConsentFormValues> = {}): ConsentFormValues {
  const v = consentFormFor(ws, 'se_1');
  return {
    ...v,
    askedParticipantIds: ['pa_client'],
    told: { ...v.told, transcribed: true, aiExtraction: true, processingLocal: true, canStopOrDelete: true },
    given: { ...v.given, transcription: true, aiLocal: true },
    ...changes,
  };
}

describe('the consent form (MVP 3.1)', () => {
  it('starts blank, with nothing told or agreed', () => {
    const v = consentFormFor(blank(), 'se_1');
    expect(v).toMatchObject({ askedParticipantIds: [], confirm: false, outcome: { kind: 'given' } });
    expect(Object.values(v.given).some((x) => x === true)).toBe(false);
  });

  it('saves a confirmed record with the current wording, who asked and when, valid', () => {
    const ws = value(saveConsentForm(blank(), 'se_1', filled(blank(), { confirm: true }), 'Sam Consultant', AT));
    const record = Object.values(ws.consents)[0];
    expect(record).toMatchObject({ sessionId: 'se_1', askedBy: 'Sam Consultant', wordingVersion: CURRENT_WORDING });
    expect(record.confirmed).toEqual({ by: 'Sam Consultant', at: AT });
    expect(consentState(record).given).toMatchObject({ transcription: true, aiLocal: true });
    expect(codes(ws)).toEqual([]);
  });

  it('shows C2 next to each "yes" the client wasn’t told about, and won’t confirm until it’s fixed, though a draft saves', () => {
    const v = filled(blank(), { given: { ...consentFormFor(blank(), 'se_1').given, audioRecording: true, transcription: true } });
    const issues = confirmIssues(v, 'Sam Consultant');
    expect(issues).toEqual([
      { place: 'audioRecording', message: 'Tick what you told them: recording the audio, how long the recording is kept.' },
    ]);
    expect(saveConsentForm(blank(), 'se_1', { ...v, confirm: true }, 'Sam Consultant', AT).ok).toBe(false);
    const draft = value(saveConsentForm(blank(), 'se_1', v, 'Sam Consultant', AT));
    expect(Object.values(draft.consents)[0].confirmed).toBeNull();
    expect(codes(draft)).toEqual([]);
  });

  it('needs who was asked, and the consultant’s name, to confirm', () => {
    const v = filled(blank(), { askedParticipantIds: [] });
    expect(confirmIssues(v, null).map((i) => i.place)).toEqual(['asked', 'confirm']);
  });

  it('external AI needs the external statement naming the same provider', () => {
    const base = filled(blank());
    const v: ConsentFormValues = {
      ...base,
      told: { ...base.told, processingExternal: true, externalProvider: ANTHROPIC },
      given: { ...base.given, aiExternal: true, externalProvider: ANTHROPIC },
    };
    expect(confirmIssues(v, 'Sam')).toEqual([]);
    const other = { ...v, given: { ...v.given, externalProvider: 'OpenAI (api.openai.com)' } };
    expect(confirmIssues(other, 'Sam')).toEqual([
      { place: 'aiExternal', message: 'Tick what you told them: the external AI provider.' },
    ]);
    // A "yes" with no provider can't even be saved.
    expect(saveIssues(blank(), 'se_1', { ...v, given: { ...v.given, externalProvider: null } })[0].place).toBe('aiExternal');
  });

  it('declined agrees to nothing, and is a valid confirmed record (notes only, C7)', () => {
    const v = decline(filled(blank(), { confirm: true }));
    expect(Object.values(v.given).filter((x) => x === true)).toEqual([]);
    const ws = value(saveConsentForm(blank(), 'se_1', v, 'Sam', AT));
    expect(consentState(Object.values(ws.consents)[0]).outcome.kind).toBe('declined');
    expect(codes(ws)).toEqual([]);
  });

  it('editing a confirmed record clears its confirmation unless confirmed again (C3), and an unchanged save changes nothing', () => {
    const confirmed = value(saveConsentForm(blank(), 'se_1', filled(blank(), { confirm: true }), 'Sam', AT));
    expect(saveConsentForm(confirmed, 'se_1', consentFormFor(confirmed, 'se_1'), 'Sam', LATER)).toEqual({
      ok: true,
      value: confirmed,
    });

    const edited = consentFormFor(confirmed, 'se_1');
    const unconfirmed = value(
      saveConsentForm(confirmed, 'se_1', { ...edited, given: { ...edited.given, aiLocal: false }, confirm: false }, 'Sam', LATER),
    );
    expect(Object.values(unconfirmed.consents)[0].confirmed).toBeNull();
    const reconfirmed = value(
      saveConsentForm(unconfirmed, 'se_1', { ...consentFormFor(unconfirmed, 'se_1'), confirm: true }, 'Sam', LATER),
    );
    expect(Object.values(reconfirmed.consents)[0].confirmed).toEqual({ by: 'Sam', at: LATER });
    expect(Object.keys(reconfirmed.consents)).toHaveLength(1);
  });

  it('refuses someone who isn’t a client participant of the session as asked', () => {
    expect(saveIssues(blank(), 'se_1', filled(blank(), { askedParticipantIds: ['pa_me'] }))[0].place).toBe('asked');
  });
});

describe('consent given to nothing', () => {
  it('can’t be confirmed: it should be declined, or say what was agreed', () => {
    const none = consentFormFor(blank(), 'se_1');
    const v = { ...none, askedParticipantIds: ['pa_client'], outcome: { kind: 'limited' as const, limits: 'No recording.' } };
    expect(confirmIssues(v, 'Sam')).toEqual([
      { place: 'given', message: 'Nothing is agreed: choose Declined, or set what they agreed to.' },
    ]);
    expect(saveConsentForm(blank(), 'se_1', { ...v, confirm: true }, 'Sam', AT).ok).toBe(false);
    expect(confirmIssues(decline(v), 'Sam')).toEqual([]);
  });
});

describe('withdrawal (C8)', () => {
  it('is recorded with its reason on an unlocked record, locks it, and stops everything', () => {
    const confirmed = value(saveConsentForm(blank(), 'se_1', filled(blank(), { confirm: true }), 'Sam', AT));
    expect(withdrawConsent(confirmed, 'se_1', ' ', 'Sam', LATER).ok).toBe(false);
    const ws = value(withdrawConsent(confirmed, 'se_1', 'The client asked us to stop.', 'Sam', LATER));
    const record = Object.values(ws.consents)[0];
    expect(record.lockedAt).toBe(LATER);
    expect(record.amendments).toMatchObject([
      { kind: 'withdrawal', reason: 'The client asked us to stop.', by: 'Sam', at: LATER },
    ]);
    expect(consentState(record)).toMatchObject({ withdrawn: true, given: { transcription: false, aiLocal: false } });
    expect(codes(ws)).toEqual([]);
    // A locked record changes only by amendments.
    expect(saveConsentForm(ws, 'se_1', { ...consentFormFor(ws, 'se_1'), confirm: false }, 'Sam', LATER).ok).toBe(false);
  });

  it('needs a confirmed record', () => {
    const draft = value(saveConsentForm(blank(), 'se_1', filled(blank()), 'Sam', T0));
    expect(withdrawConsent(draft, 'se_1', 'Asked to stop.', 'Sam', AT).ok).toBe(false);
  });
});

describe('the wording shown (draft-1)', () => {
  it('fills in the provider and how long the recording is kept, and knows only its own versions', () => {
    const wording = wordingFor('draft-1');
    expect(wording?.statement('processingExternal', { provider: ANTHROPIC, retention: { kind: 'until-engagement-ends' } })).toBe(
      `The transcript and my notes may be sent to ${ANTHROPIC}, which processes them under its own terms, possibly outside South Africa.`,
    );
    expect(wording?.statement('retention', { provider: null, retention: { kind: 'days', days: 30 } })).toMatch(
      /^The recording is kept for 30 days\./,
    );
    expect(wordingFor('draft-9')).toBeNull();
    expect(wordingFor('constructor')).toBeNull();
  });
});
