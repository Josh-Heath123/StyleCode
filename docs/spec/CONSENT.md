# Consent form

- **Status:** Approved by the user on 2026-11-04, with their changes (see "Decisions"). The wording stays a draft until the POPIA review.
- **Date:** 2026-11-04
- **Code:** `src/workspace/model/consent.ts` (rules), `validate.ts` (checks), tests in `consent.test.ts`, `rules.test.ts`, `review.test.ts` and `phase1.test.ts`
- **Changed in Workspace Phase 1 (WP4):** two statements for where the AI runs, amendments that record what the client was newly told, and withdrawal of a record that isn't locked yet (Phase 1 brief, decisions 2 and 3; see "Changes from Workspace Phase 1")
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
| What the client was told | One checkbox per statement, each showing its wording (below). The external-AI statement names the provider. | `told` (with `told.externalProvider`), `wordingVersion` |
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
| processingLocal | "The AI runs on my computer only; nothing is sent elsewhere." |
| processingExternal | "The transcript and my notes may be sent to *[provider]*, which processes them under its own terms, possibly outside South Africa." The record keeps the provider named. |
| retention | "The recording is kept for *[N days / until the project ends / only until it's transcribed]*. The transcript and my notes are kept with the project's records." |
| canStopOrDelete | "You can ask me to stop recording at any time, and ask me to delete the recording and the transcript." |

The wording is versioned. Each record keeps the version it was shown with, and the export prints that version's text, so a record always says exactly what the client heard.

## Rules

Each rule is checked in code and covered by a unit test, except where marked as a later phase.

| | Rule | Where |
| --- | --- | --- |
| **C1** | **Capture needs consent.** Importing or pasting a transcript needs a confirmed record with transcription = yes. Recording and importing audio need audio recording = yes (Phase 3). Neither is possible if consent was declined or withdrawn. *Settles the provisional rule from WP3.* | `canCapture`; `consent.required` |
| **C2** | **Told before agreed.** The client can only agree to what they were told. Each "yes" needs its statements ticked: recording needs *recorded* and *retention*; transcription needs *transcribed*; AI on this computer needs *aiExtraction* and *processingLocal*; AI by an external provider needs *aiExtraction* and *processingExternal*, naming that same provider. If anything is agreed, *canStopOrDelete* must be ticked too. The same holds for amendments: each "yes" is checked against everything the client has been told up to then, on the form and in earlier amendments, including statements the amendment itself records as newly told. | `missingStatements`, `missingFor`, `toldSoFar`, `amendConsent`; `consent.told`, `consent.provider`, `consent.wording` |
| **C3** | **A record counts only when confirmed.** A draft allows nothing. Changing anything on a confirmed record that isn't locked yet clears the confirmation, so the consultant confirms what the record now says. Adding an attachment doesn't. | `consentState`, `editConsent` |
| **C4** | **Locked once used.** Importing a transcript (or starting a recording) locks the record, and so does a withdrawal. After that it changes only by dated amendments, in order, each saying who and why, each checked like the record itself. An amendment can record statements the client was newly told, for example by email after the meeting, with the wording version shown. A withdrawal is final: renewed consent means a new session. | `lockConsent`, `amendConsent`; `consent.lock`, `consent.amendment` |
| **C5** | **AI processing needs consent.** The AI processes a session's transcript and notes (MVP Q15) only if its consent allows it at that time. A declined, withdrawn or unconfirmed session's notes are never sent to the AI. Every AI proposal records where it ran and every session it was given (the sessions it cites are among them), and is invalid if any of those sessions didn't allow that. | `canUseAi`; `finding.aiConsent`, `finding.origin` |
| **C6** | **Local or external** (MVP Q16). AI processing is *local* only when the provider is Ollama or an OpenAI-compatible server at a loopback address (`localhost`, `127.x.x.x`, `::1`). Anything else is *external*, including Ollama on another computer, and is named by company and host. Local needs "AI processing on this computer = yes". External needs "external provider = yes" and the same provider named on the form; another provider is refused, with the reason. | `classifyProvider`, `canUseAi` |
| **C7** | **Declined means notes only.** The session can have manual notes, which the AI doesn't process; transcript import, recording and AI stay unavailable, each saying why. | `canCapture`, `canUseAi` |
| **C8** | **Withdrawal.** Recorded as a dated amendment with the reason, on any confirmed record, locked or not; it locks the record. From then on nothing more is captured or processed by the AI. What was imported before the withdrawal stays valid until it is deleted. The app offers to delete the audio (Phase 3) and the transcript. Deleting the transcript removes every copy of its words: each cited segment becomes *deleted evidence* (no words, only the session and the date) in the finding, in what the AI proposed and in its history, and company facts lose their quotes from the session. Findings left with nothing to rest on, or said in the session with no transcript segment left, are removed. Afterwards the consultant is shown the findings and company facts that keep a statement from that session, so they can remove those too if the client asks. | `amendConsent`, `consentState`, `removeTranscript`; the interface in Phase 1 |
| **C9** | **Export.** The engagement's export includes every session's consent record, its amendments and the text of the wording version shown (MVP story 8). Phase 1 keeps each wording version's text in the code, by version id, so the export can print it. | Phase 1 (export) |
| **C10** | **Retention of audio** is kept as recorded. "Deleted after transcription" is a promise to the client: the audio is deleted as part of finishing the transcription, not left to a reminder. For "N days" and "until the engagement ends", see decision 4. | Phase 3 |
| **C11** | **Speakers who weren't asked.** When a transcript is imported, every speaker label that matches neither a client participant named on the consent form nor someone on the consultant's side is listed, with a warning that they weren't asked for consent. Segments without a speaker label are flagged as unchecked. The import can go ahead, and the warning is kept on the transcript. | `checkSpeakers`; `Transcript.unaskedSpeakers`, `unnamedSpeakers` |

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
  [ ] "The transcript and my notes may be sent to Anthropic (api.anthropic.com)…"
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
- The external-AI statement and the external provider row only appear when an external provider is set up in AI settings; both name that provider (C6).
- Choosing *Declined* sets every answer to no.
- Everything works from the keyboard, with labels on every control, and passes the accessibility check.

**Amend and withdraw:** *Amend…* (on a locked record) opens the same answers, prefilled with the current state, plus the statements not yet told, a required reason and an optional attachment; it adds an amendment and never changes the original. *Withdraw consent…* (on any confirmed record) asks for the reason, records the withdrawal, then offers to delete the transcript (and audio), listing the findings that would go with it. After deleting, it lists the findings and company facts that keep a statement from the session, each with a way to remove it. The record's history shows the original and each amendment with who, when and why.

**Import warning** (C11), shown after importing and kept on the transcript:

```
│ Transcript imported · 312 segments                                  │
│ ⚠ 2 speakers weren't asked for consent: "Jo", "Guest 1".            │
│   Match them to participants, or check that they agreed.            │
```

## Decisions

The user's decisions (2026-11-04): the recommendations on all six, with these changes.

1. **Transcript import needs transcription = yes** (C1); AI is a separate yes (C5). The client can agree to a transcript without AI.
2. **Deleting after a withdrawal** (C8): findings and copied quotes from the session go, as described in C8, and statements stay. *Change:* afterwards the consultant is shown the findings and company facts that keep a statement from that session, so they can remove those too if the client asks.
3. **Several client representatives:** the answers are what everyone asked agreed to; if one person says no to something, record no (or "given with limits"), and the guide says so. Per-person answers aren't modelled.
4. **Audio past its retention date** (Phase 3): for now, the app doesn't delete on its own; when StyleCode opens with audio past its retention date, it lists it with one action to delete it all, and shows it again until done. *Note for the Phase 3 brief:* "deleted after transcription" is a promise to the client, so the audio is deleted as part of finishing the transcription, not left to a reminder (C10).
5. **Transcripts and notes** are kept with the project's records, as the wording tells the client; deleting the transcript on request is covered by withdrawal (C8).
6. **The draft wording** is reviewed by someone qualified in POPIA before real use (see below).

Also added by the user: rule **C11** (speakers who weren't asked), and the external-AI wording "The transcript and my notes may be sent to *[provider]*, which processes them under its own terms, possibly outside South Africa."

## Questions for the POPIA review

For someone qualified in POPIA, before StyleCode is used with real clients. Nothing here is a conclusion; these are the questions.

1. **The wording itself** (draft-1, above): is it enough for consent to be "voluntary, specific and informed" (section 1), and is anything missing, such as who the responsible party is, the purpose, or how to complain?
2. **Transcripts and notes have no retention period of their own.** Only audio retention is asked (C10); transcripts and notes are kept with the project's records until deleted. Is a retention period needed for them, and should the form ask for one?
3. **Sending personal information to an AI provider outside South Africa.** Section 72 limits transfers of personal information about a data subject outside the Republic, allowing them for example where the recipient is bound by comparable protection or the data subject consents ([popia.co.za, section 72](https://popia.co.za/section-72-transfers-of-personal-information-outside-republic/), checked 2026-11-04). Is the external-AI statement and its "yes" enough, and should the form name the country or the provider's terms?
4. **Keeping the consultant's own statements after a withdrawal.** C8 deletes the client's words but keeps findings and company facts in the consultant's wording, which may still describe what the client said. Is that acceptable, or should a withdrawal remove them too unless the client agrees otherwise?
5. **People in the meeting who weren't asked** (C11): what should the consultant do when a transcript includes speakers who weren't asked?

## Changes from Workspace Phase 1

Made in WP4, from the user's decisions before Phase 1 (`docs/phase-1/PHASE-1-BRIEF.md`), with tests in `src/workspace/model/phase1.test.ts`:

1. **Two statements for where the AI runs** (decision 2). `processingLocation` is replaced by `processingLocal` and `processingExternal`. The external statement keeps the provider it named (`told.externalProvider`), and agreeing to external AI needs that same provider, so the record says exactly which version the client heard. This settles Phase 0 open question 2.
2. **Amendments can record what the client was newly told** (decision 3): `told` lists the statements now told, and `wordingVersion` names the wording shown. C2 then checks each "yes" against everything the client has been told up to that point. This settles open question 8.
3. **Withdrawal on a record that isn't locked yet** is recorded as a dated amendment, like any other, and locks the record. Phase 1 has no import or recording, so a record can be withdrawn before it was ever locked.
