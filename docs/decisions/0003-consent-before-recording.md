# ADR-0003: Consent is recorded before any recording

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

The workspace captures what clients say in consultations: first as meeting transcripts imported from Teams, Zoom or Google Meet, or pasted in (Phase 2), and later as recordings transcribed on the consultant's computer (Phase 3). The people speaking are the consultant's clients. Their words may be processed by AI, on the consultant's computer or by an external provider (ADR-0002).

The user decided before Phase 0 that every session has a consent form that the consultant fills in, and that recording can't start without it (Phase 0 brief, "Decisions already made", 3). On 2026-11-04 the user confirmed that the consent form applies to imported transcripts too.

## Decision

- Every session has at most one consent record, filled in by the consultant. It records that consent was asked for, how, by whom, what the client was told and what they agreed to.
- Recording, audio import, and importing or pasting a transcript are unavailable for a session until it has a consent record that allows them.
- What was agreed limits what the app does with that session's data. For example, if external AI processing wasn't agreed, the app refuses external providers for that session.
- Once recording starts or a transcript is imported, the consent record is locked. Later changes, including a withdrawal, are added as dated amendments and never overwrite it.
- These rules are enforced in code and covered by tests, not left to the interface alone.
- The form records what the consultant says happened. It is not a legal compliance mechanism, and the app doesn't present it as one.

The fields, the exact rules and the interface are specified in `docs/spec/CONSENT.md` (WP5).

## Options considered

- **A required consent record per session, enforced in code (chosen).** Makes it impossible to capture a session by accident without consent, and gives every session an auditable record of what was agreed, which also governs AI processing. Against: an extra step before every captured meeting.
- **An optional reminder or checkbox.** Less friction. Against: easy to skip, records nothing about what was agreed, and can't drive what the app does with the data.
- **Rely on the meeting platform's own notice** (for example the recording banner in Teams). No extra step. Against: covers only that the meeting was recorded, says nothing about AI processing or where it happens, and doesn't exist for in-person meetings or pasted transcripts.

## Consequences

- The consent form is built in Phase 1. Transcript import is blocked without it from Phase 2, and recording from Phase 3.
- The domain model (WP3) has a consent record per session with amendments, and the session's data carries enough to check every rule.
- The engagement's export includes its consent records.
- The wording shown to the client must be reviewed by someone qualified in POPIA before real use. Until then the form and its wording are drafts.
- Sessions where consent is declined can still have manual notes, so the app stays useful for them.
