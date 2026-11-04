# Consent form

- **Status:** Draft, for the user's approval (Phase 0, WP5)
- **Date:** 2026-11-04
- **Code:** `src/workspace/model/consent.ts` (rules), `validate.ts` (checks), tests in `consent.test.ts`, `rules.test.ts` and `review.test.ts`
- **Sources:** ADR-0002 and ADR-0003; `docs/spec/MVP.md` story 3.1 and Q15, Q16; `docs/spec/DOMAIN-MODEL.md`; the Phase 0 brief, WP5

> **Not legal advice, and not a compliance feature.** This form helps the consultant ask for consent and keep an honest record of the answer. It does not make anyone compliant with POPIA or any other law. The wording shown to the client must be reviewed by someone qualified in POPIA before real use, and until then it stays a draft (version `draft-1`). For reference, POPIA defines consent as "any voluntary, specific and informed expression of will in terms of which permission is given for the processing of personal information" (section 1, [popia.co.za](https://popia.co.za/section-1-definitions/), checked 2026-11-04). The form is built around those three words: the client is told each thing (informed), answers each one separately (specific), and can decline without losing the meeting (voluntary).

## When

The consultant fills in the form for each session, **before** a transcript is imported or pasted (Phase 2) and before recording or importing audio (Phase 3). In practice consent is usually asked at the start of the meeting and the form filled in straight after; the form records how and when it was asked. Implementation: the form in Phase 1, the import block in Phase 2, the recording block in Phase 3.

## Fields

| Field | How it is filled in | Model |
| --- | --- | --- |
| Session, date and time | Automatic, from the session | `sessionId`, the session's `startsAt` |
| Client representatives asked | Chosen from the session's client participants (name, role, organisation). At least one. | `askedParticipantIds` |
| Asked by | The consultant's name, from settings | `askedBy` |
| How consent was asked | Verbally at the start of the meeting · in writing beforehand · other (described) | `method` |
| What the client was told | One checkbox per statement, each showing its wording (below) | `told`, `wordingVersion` |
| Consent given | Yes or no for each: audio recording · transcription · AI processing on this computer · AI processing by an external provider (named) | `given` |
| Retention of audio | Kept for N days · until the engagement ends · deleted after transcription | `retention` |
| Outcome | Given · given with limits (described) · declined | `outcome` |
| Confirmation | "I asked for consent as recorded above", with the time | `confirmed` |
| Attachment (optional) | A signed form or an email, stored as a file of the session or engagement | `attachmentFileId` |

The external provider isn't typed. The form offers the name of the external provider set up in AI settings, such as "Anthropic (api.anthropic.com)" (rule C6), so the record names exactly what will be used.

## Wording shown to the client (draft-1)

Each statement is shown on the form exactly as it should be said or sent to the client. The consultant ticks those they actually told the client. *Draft wording, to be reviewed before real use.*

| Statement | Wording |
| --- | --- |
| recorded | "I'd like to record the audio of this meeting." |
| transcribed | "What we say will be turned into a written transcript, by the meeting software or on my computer." |
| aiExtraction | "I'll use AI to help pick out requirements, questions and risks from the transcript and my notes. I check everything it suggests." |
| processingLocation | Either "The AI runs on my computer only; nothing is sent elsewhere." or "The AI runs on my computer, and may also be sent to *[provider]* to process." |
| retention | "The recording is kept for *[N days / until the project ends / only until it's transcribed]*. The transcript and my notes are kept with the project's records." |
| canStopOrDelete | "You can ask me to stop recording at any time, and ask me to delete the recording and the transcript." |

The wording is versioned. Each record keeps the version it was shown with, and the export prints that version's text, so a record always says exactly what the client heard.

## Rules

Each rule is checked in code and covered by a unit test, except where marked as a later phase.

| | Rule | Where |
| --- | --- | --- |
| **C1** | **Capture needs consent.** Importing or pasting a transcript needs a confirmed record with transcription = yes. Recording and importing audio need audio recording = yes (Phase 3). Neither is possible if consent was declined or withdrawn. *Settles the provisional rule from WP3.* | `canCapture`; `consent.required` |
| **C2** | **Told before agreed.** The client can only agree to what they were told. Each "yes" needs its statements ticked: recording needs *recorded* and *retention*; transcription needs *transcribed*; either kind of AI processing needs *aiExtraction* and *processingLocation*. If anything is agreed, *canStopOrDelete* must be ticked too. | `missingStatements`; `consent.told` |
| **C3** | **A record counts only when confirmed.** A draft allows nothing. Changing anything on a confirmed record that isn't locked yet clears the confirmation, so the consultant confirms what the record now says. Adding an attachment doesn't. | `consentState`, `editConsent` |
| **C4** | **Locked once used.** Importing a transcript (or starting a recording) locks the record. After that it changes only by dated amendments, in order, each saying who and why, each checked like the record itself. A withdrawal is final: renewed consent means a new session. | `lockConsent`, `amendConsent`; `consent.lock`, `consent.amendment` |
| **C5** | **AI processing needs consent.** The AI processes a session's transcript and notes (MVP Q15) only if its consent allows it at that time. A declined, withdrawn or unconfirmed session's notes are never sent to the AI. Every AI proposal records where it ran, and is invalid if a session it cites didn't allow that. | `canUseAi`; `finding.aiConsent` |
| **C6** | **Local or external** (MVP Q16). AI processing is *local* only when the provider is Ollama or an OpenAI-compatible server at a loopback address (`localhost`, `127.x.x.x`, `::1`). Anything else is *external*, including Ollama on another computer, and is named by company and host. Local needs "AI processing on this computer = yes". External needs "external provider = yes" and the same provider named on the form; another provider is refused, with the reason. | `classifyProvider`, `canUseAi` |
| **C7** | **Declined means notes only.** The session can have manual notes, which the AI doesn't process; transcript import, recording and AI stay unavailable, each saying why. | `canCapture`, `canUseAi` |
| **C8** | **Withdrawal.** Recorded as a dated amendment with the reason. From then on nothing more is captured or processed by the AI. The app offers to delete the audio (Phase 3) and the transcript; see decision 2. What was imported before the withdrawal stays valid until it is deleted. | `amendConsent`, `consentState`; deletion in Phase 1 |
| **C9** | **Export.** The engagement's export includes every session's consent record, its amendments and the text of the wording version shown (MVP story 8). | Phase 1 (export) |
| **C10** | **Retention of audio** is kept as recorded; deleting audio when it falls due is Phase 3 (decision 4). | Phase 3 |

## The interface (sketch)

**The session page** shows the consent state at the top, and blocked actions say why, with a way forward (MVP: "No placeholder controls", except a real feature blocked by a rule).

```
┌ Kick-off · 4 Nov 2026, 09:00 ─────────────────────────────────────┐
│ Consent: not filled in                    [ Fill in consent form ] │
│                                                                    │
│ Transcript   Import or paste is unavailable until the consent      │
│              form is filled in and confirmed.                      │
│ Notes        [ Add note ]                                          │
│ Findings     AI is unavailable: no consent recorded yet.           │
└────────────────────────────────────────────────────────────────────┘

 After confirming:
│ Consent: given · transcription, AI on this computer · audio kept   │
│          until the engagement ends            [ View ] [ Amend… ]  │
```

**The form** is one page, in the order the conversation goes:

```
Consent for "Kick-off", 4 Nov 2026, 09:00

Who was asked        [x] Alex Owner, Owner, Harbour Bakery
                     [ ] Jo Baker, Manager, Harbour Bakery
Asked by             Sam Consultant
How                  (•) Verbally at the start   ( ) In writing before   ( ) Other: ____

What you told them   (wording draft-1, shown in full)
  [x] "I'd like to record the audio of this meeting."
  [x] "What we say will be turned into a written transcript…"
  [x] "I'll use AI to help pick out requirements…"
  [x] "The AI runs on my computer only; nothing is sent elsewhere."
  [x] "The recording is kept until the project ends…"
  [x] "You can ask me to stop recording at any time…"

What they agreed to  Audio recording                        ( ) Yes (•) No
                     Transcription                          (•) Yes ( ) No
                     AI on this computer                    (•) Yes ( ) No
                     AI by Anthropic (api.anthropic.com)    ( ) Yes (•) No
Audio kept           ( ) For __ days  (•) Until the engagement ends  ( ) Deleted after transcription
Outcome              (•) Given  ( ) Given with limits: ________  ( ) Declined
Attachment           [ Add signed form or email… ]

[x] I asked for consent as recorded above.          [ Save ]  [ Cancel ]
```

- A "yes" whose statement isn't ticked shows the problem next to it, and Save stays available but the form can't be confirmed until it's fixed (rule C2).
- The external provider row only appears when an external provider is set up in AI settings; it names that provider (C6).
- Choosing *Declined* sets every answer to no.
- Everything works from the keyboard, with labels on every control, and passes the accessibility check.

**Amend and withdraw** (on a locked record): *Amend…* opens the same answers, prefilled with the current state, plus a required reason and an optional attachment; it adds an amendment and never changes the original. *Withdraw consent…* asks for the reason, records the withdrawal, then offers to delete the transcript (and audio), listing the findings that would go with it. The record's history shows the original and each amendment with who, when and why.

## Decisions for the user

1. **Transcript import needs transcription = yes** (C1). Should importing a transcript the meeting platform already made also require AI consent? *Recommendation:* no; import needs transcription only, and AI is a separate yes (C5). The client can agree to a transcript without AI.
2. **Deleting after a withdrawal.** When the consultant accepts the offer to delete the transcript, findings whose only evidence is in it are removed, and others lose that evidence, as for deleting a session (DOMAIN-MODEL decision 4). Company knowledge keeps its copy of the source statement, but should its copied quotes from that transcript go too? *Recommendation:* yes, remove copied quotes from the withdrawn session and keep the statement, which is the consultant's own wording. (The model would then record the session on each copied quote.)
3. **Several client representatives.** The form has one set of answers for the session. *Recommendation:* the answers are what everyone asked agreed to; if one person says no to something, record no (or "given with limits"), and the guide says so. Per-person answers aren't modelled.
4. **Retention when audio falls due** (Phase 3). *Recommendation:* the app doesn't delete on its own; when StyleCode opens with audio past its retention date, it shows the list with one action to delete it all, and shows it again until done. Decided in Phase 3's brief.
5. **Retention of transcripts and notes.** The form's retention is for audio, as the brief says, and the wording tells the client that transcripts and notes are kept with the project's records. *Recommendation:* keep it so for the first version; deleting the transcript on request is covered by withdrawal (C8).
6. **The draft wording** above, to be reviewed by someone qualified in POPIA before real use.
