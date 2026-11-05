# Domain model of the consulting workspace

- **Status:** Approved by the user on 2026-11-04, with the changes from their review (see "Changes after review")
- **Date:** 2026-11-04
- **Code:** `src/workspace/model/` (types, validation and rules; no interface, no storage)
- **Sources:** `docs/vision/PRODUCT-VISION.md` §2, §3 and §7; `docs/spec/MVP.md`; ADR-0002 to ADR-0004

## The unit: one company's workspace

All data belongs to exactly one company. The model's top-level value is a `CompanyWorkspace`: the company, plus flat maps keyed by id of everything that belongs to it.

```
CompanyWorkspace (format "stylecode-workspace", version 1)
├── company            Company
├── knowledge          CompanyFact          (company knowledge, carried across engagements)
├── engagements        Engagement           → company
├── designs            DesignLink           → engagement
├── sessions           Session              → engagement
├── participants       Participant          → session
├── consents           ConsentRecord        → session (at most one each)
├── transcripts        Transcript           → session (at most one each)
├── segments           TranscriptSegment    → transcript
├── notes              Note                 → session
├── files              FileRef              → company, engagement or session
├── findings           Finding              → engagement; evidence → segments and notes
└── relations          FindingRelation      → two findings of one engagement
```

**Why this shape.** It follows StyleCode's design document: plain data, flat maps keyed by id, validated, versioned. Children point at their parent by id, so there are no nested copies to keep in step. Keeping a company's data in one value makes "companies' data never mix" a checkable rule: every reference must resolve inside the same workspace. It also matches the storage option WP4 evaluates first (one folder per company), but it doesn't depend on it. Tables in one database per company would map onto it directly.

**Ids** are short random strings with a prefix that says what they are (`co_`, `en_`, `se_`, `fd_`…), made and checked by the editor's existing `createId` and `isValidId`. Ids are never resolved through inherited object properties, so an id such as `constructor` can't resolve to something that isn't there.

**Times** are ISO 8601 timestamps. Transcript times are milliseconds from the start of the meeting. Calendar dates (an engagement's end, the date a source was checked) are `YYYY-MM-DD`.

**Who did something** is recorded as a name for the consultant (one consultant per computer, MVP), or as `{ provider, model }` for the AI, so the AI's work can never be mistaken for the consultant's.

## Entities

| Entity | Fields | Notes |
| --- | --- | --- |
| Company | name, industry, description (what they do), existing systems, notes | Free text, as in MVP story 1.1. The name is required, and must differ from other companies' names, ignoring case (MVP Q4; `isCompanyNameFree`). |
| CompanyFact | statement, kind, provenance, source (or none), who and when | Company knowledge (vision §3). Modelled now; the interface comes after extraction (MVP Q3). Only a finding in the record can be promoted. The source keeps a copy of the finding's statement, its quotes (with session and speaker) and the engagement's name, so the fact outlives the finding: when the finding, its session or its engagement is deleted, the link becomes "source deleted" with the date (`promoteToKnowledge`, `removeFindings`). |
| Engagement | company, name, goal, status (active, or ended on a date) | The end date is what "keep until the engagement ends" in the consent form refers to (MVP Q5). |
| DesignLink | engagement, name, StyleCode document id | A design belongs to one company: `sharedIds` also reports a document linked from two companies' workspaces. WP4 stores each design inside its company's data. |
| Session | engagement, title, start time, audio files (Phase 3) | |
| Participant | session, name, role, organisation, side (client or consultant), speaker labels | A speaker label belongs to at most one participant in a session. A person can have several labels ("Alex", "Alex (Guest)"). |
| ConsentRecord | see "Consent" below | One per session, with amendments. |
| Transcript | session, source (file: name, `vtt` or `docx`, platform; or pasted), who imported it and when | One per session (MVP Q10). Recording (Phase 3) adds a third source. |
| TranscriptSegment | transcript, position, speaker label, start and end (ms), text, confidence | Kept exactly as imported (MVP Q9). Times and confidence only where the source has them; an end needs a start. Positions run from 0 without gaps. |
| Note | session, text, when written, when changed | Shown as a time of day and as time since the session started (MVP 5.1). |
| FileRef | owner (company, engagement or session), purpose (document, audio, or consent attachment), name, media type, size, who added it and when | Audio belongs to a session and needs consent to recording (CONSENT.md, C1); a consent record's attachment must be a consent attachment. Stored in the company's folder by id (ADR-0006). |
| Finding | engagement, kind, statement, status, who set the status and when, provenance, evidence, origin | See "Findings". |
| FindingRelation | type, from, to, who and when | influences · depends on · conflicts with · refines. Directed: "from influences to". |

## Findings

A finding has two separate dimensions, and the model never merges them:

- **Status**, how settled it is (vision §2): `confirmed` · `suggested` · `assumption` · `unresolved`.
- **Provenance**, where its content comes from (vision §7):
  - `said-in-session`: someone said it; its evidence cites at least one transcript segment;
  - `consultant`: entered by the consultant;
  - `verified`: verified technical information, with its source and the date it was checked (technology catalogue, later);
  - `calculated`: computed by a deterministic engine, named with its version (cost engine, later);
  - `ai-suggested`: inferred by the AI; nobody said it.

**Kinds** come from vision §2: business requirement, functional requirement, non-functional requirement, expectation, objective, operational challenge, existing system, budget, performance, scalability, security, design preference, constraint, open question, risk, decision, future consideration (vision §8: something for a later phase or project; added in Workspace Phase 1).

**Evidence** is a list of passages, each a transcript segment or a note, with the words quoted from it. A quote must appear in its passage. Differences in white space, letter case and the style of quotation marks are ignored; anything else counts as invented evidence. A quote is at least three words, unless it is the whole segment or note, so a single word such as "a" can't count as evidence.

**Origin** records how the finding entered the workspace, separately from provenance (MVP Q14):

- entered by the consultant (who, when); or
- proposed by the AI (provider, model, where it ran: on this computer or by a named external provider, when), with what the AI proposed (kind, statement, status and evidence, kept unchanged) and the consultant's review: pending, accepted (who, when) or rejected (who, when).

So a client's statement extracted by the AI has provenance `said-in-session`, with origin "proposed by the AI, accepted by Sam at 11:00". A risk the AI spotted that nobody mentioned has provenance `ai-suggested`. The AI never proposes the status confirmed.

**History.** Every change to a finding's kind, statement, status or evidence is recorded with the old and new value, who made it and when (MVP 6.2 and 7.1), including edits made while accepting a proposal (`acceptProposal` with edits, `editFinding`, `setStatus`). Replaying the history from what the AI proposed gives the current values, so it's always visible what the consultant changed (Phase 2's evaluation uses this). A proposal that is pending or rejected has no history and reads exactly as proposed. For the consultant's own findings, the history must lead to the current values; their first values aren't kept separately.

**The record** is every finding entered by the consultant, plus every AI proposal the consultant accepted. Pending and rejected proposals are kept but aren't part of the record (MVP Q11). `recordGroups` groups the record as MVP Q12 says, plus a fourth group: confirmed, assumptions, open (status unresolved, or kind open question whatever its status), and suggested.

## Consent

Fields as listed in the Phase 0 brief (WP5 refines them in `docs/spec/CONSENT.md`):

- the session, who was asked (client participants), who asked, and how (verbally at the start, in writing beforehand, or other, described);
- the version of the wording shown, and what the client was told (one yes or no per statement, with separate statements for AI on this computer and AI by an external provider, and the provider the external statement named);
- what was agreed: audio recording · transcription · AI processing on this computer · AI processing by an external provider (named);
- retention: N days, until the engagement ends, or deleted after transcription;
- outcome: given · given with limits (described) · declined;
- the consultant's confirmation (who, when), an optional attachment, the time it was locked, and amendments.

`consentState(record, at)` gives what a record allows at a point in time, after its amendments up to then. A draft, declined or withdrawn record allows nothing.

**Amendments** can record statements the client was newly told, with the wording version shown, for example when the client agrees to external AI by email after the meeting. Each "yes" is checked against everything the client has been told up to that point (`toldSoFar`). Amendments are checked like the record itself: answers are yes or no, only fields of the form can change, limits are described and retention is valid. The terms left after each amendment are checked too (`termsIssues`), so external AI always has a named provider and declined consent agrees to nothing. Turning external AI off drops the provider. `amendConsent` refuses an amendment that fails any of these.

**Withdrawal is final.** It works on any confirmed record, and locks one that isn't locked yet. Nothing can follow it; if the client agrees again, that is a new session with its own consent record.

## Rules

Each rule is checked in code and covered by a unit test. `validateWorkspace` returns every problem, each with a stable code.

| Rule | Code | Where |
| --- | --- | --- |
| A finding said in a session cites at least one transcript segment, from its own engagement | `finding.saidNeedsSegment`, `evidence.engagement` | `validate.ts` |
| Every cited segment or note exists, and the quoted words appear in it | `evidence.missing`, `evidence.invented` | `validate.ts`, `quoteAppearsIn` |
| A quote is at least three words, unless it is the whole passage | `evidence.short` | `validate.ts`, `isQuoteLongEnough` |
| An AI proposal becomes confirmed only through the consultant's action, recording who and when | `finding.confirmedByAi`, `finding.review`, `finding.statusSet` | `validate.ts`, `acceptProposal`, `setStatus` |
| An AI proposal keeps what the AI proposed, and its evidence is checked like any other | `finding.proposed`, `evidence.*` | `validate.ts` |
| Every change to kind, statement, status or evidence is in the history, with who and when | `finding.history` | `validate.ts`, `editFinding` |
| An AI proposal is invalid if, when it was made, a session it cites didn't allow AI processing where it ran (local, or the named external provider; CONSENT.md C5 and C6, added in WP5) | `finding.aiConsent` | `validate.ts`, `canUseAi` |
| Company knowledge keeps a copy of its source; a deleted source is marked as deleted, with the date | `fact.source`, `ref.missing` | `validate.ts`, `removeFindings` |
| The AI never supplies verified or calculated information | `finding.aiProvenance` | `validate.ts` |
| One company's data never references another company's ids, and a design is linked from one company only | `ref.company`, `ref.missing` | `validate.ts`, `sharedIds` (ids and design documents found in two workspaces) |
| Links stay within one engagement, between findings in the record, without duplicates or self-links | `relation.*` | `validate.ts` |
| No transcript without a confirmed consent record that allowed transcription when it was imported | `consent.required` | `validate.ts`, `canCapture` |
| Importing a transcript locks the consent record | `consent.lock` | `validate.ts`, `lockConsent` |
| A locked record changes only by dated amendments, in order, each with who and why; nothing follows a withdrawal | `consent.amendment` | `validate.ts`, `editConsent`, `amendConsent` |
| Each amendment, and the terms after it, pass the same checks as the record | `consent.provider`, `consent.limits`, `consent.declined`, `consent.retention`, `field.*` | `validate.ts`, `amendmentIssues`, `termsIssues` |
| Recording needs consent to recording; declined consent allows only notes | | `canCapture` |
| The client was told each statement for what they agreed to, external AI naming the same provider, counting what amendments newly told (CONSENT.md C2) | `consent.told`, `consent.provider`, `consent.wording` | `validate.ts`, `missingFor`, `toldSoFar`, `toldIssues` |
| External AI only if the client agreed, with the provider named; AI processing covers the session's notes too (MVP Q15) | `consent.provider` | `aiPermission`, `validate.ts` |
| One consent record and one transcript per session; a speaker label belongs to one participant | `consent.duplicate`, `transcript.duplicate`, `participant.label` | `validate.ts` |

**Nothing is repaired, and one bad entry doesn't lock a client out.** The editor's project loader repairs what it safely can. The workspace loader doesn't, because dropping a piece of evidence or a consent amendment would quietly change what the record says. Instead:

- **Saving:** a workspace with any problem is never saved (`checkBeforeSave`), so a problem can't be written over the last good copy.
- **Loading:** `parseWorkspace` opens a valid workspace as editable. One with problems opens **read-only**, with the problems listed, so the consultant can still see the client's data. An entry that can't be read at all is left out of the view and listed as a problem; the file itself is untouched.
- **Refused:** only data that isn't a workspace, comes from a newer version, or is missing its company or a whole section.

The validator reads entries of any shape without failing, which the tests check by damaging every map and the nested values in turn.

**Changes are pure functions** that return a new value (`acceptProposal`, `rejectProposal`, `editFinding`, `setStatus`, `promoteToKnowledge`, `removeFindings`, `removeTranscript`, `removeSession`, `removeEngagement`, `editConsent`, `lockConsent`, `amendConsent`, and in `entities.ts` `createEngagement`, `editEngagement`, `createSession`, `editSession`, `addParticipant`, `editParticipant`, `removeParticipant`), so Phase 1 can make each one an undoable step, as the editor does with operations.

## Versioning

The workspace carries `format: "stylecode-workspace"` and `version: 1`. A newer version is refused with a message to update StyleCode. When the model changes, the version goes up and `parseWorkspace` gains a migration from the previous one, as the editor's project files do.

## Decisions

The user's decisions on the six points raised in the draft (2026-11-04):

1. **Withdrawal is final.** *Agreed.* After a withdrawal no further amendments are accepted. Renewed consent means a new session.
2. **"Suggested" findings** are shown as a fourth group in the record. *Agreed.*
3. **Transcript import needs consent to transcription.** *Agreed,* provisional until WP5 settles the exact rule. WP5: rule C1 of `docs/spec/CONSENT.md`.
4. **Deleting a session** (MVP 2.3) removes its consent record, transcript, segments and notes, and the findings whose only evidence is in it. A finding with evidence from other sessions too keeps that evidence and loses the rest. Company knowledge promoted from a removed finding stays, with its source marked as deleted (point 5 of the review). *Agreed.* Built in Workspace Phase 1: `removeSession` and `removeEngagement`, using `removeFindings` for company knowledge.
5. **AI proposals and consent.** *Partly now:* an AI proposal is invalid if a session it cites allowed no AI processing when it was made (`finding.aiConsent`). Whether the provider used was local or external, as the consent allowed, is checked once WP5 settles which providers count as local (MVP Q16). WP5: done, rules C5 and C6 of `docs/spec/CONSENT.md`; AI proposals now record where they ran (`origin.processing`).
6. **The consultant's name** comes from the app (asked once, in settings) in Phase 1. The model only requires it to be present. *Agreed.*

## Changes after review

The user's review of the draft asked for seven changes, all made, each with tests in `src/workspace/model/review.test.ts`:

1. Consent amendments are validated like the record, and the terms after every amendment are checked: external AI always needs a named provider.
2. The validator checks AI consent now (decision 5).
3. Every change to a finding's statement, kind, status or evidence records who and when, and AI proposals keep what the AI proposed.
4. A workspace with problems is never saved, and opens read-only with its problems listed, instead of being refused.
5. Company knowledge keeps a copy of its source, and survives the source's deletion as "source deleted".
6. `sharedIds` includes design document ids. WP4 stores each design inside its company's data.
7. A quote is at least three words, unless it is the whole segment or note.

## Changes from WP5

Made to support the approved consent rules (`docs/spec/CONSENT.md`):

- An AI proposal records where it ran, on this computer or by a named external provider (`origin.processing`, rules C5 and C6).
- Evidence can be `deleted`: no words, only the session and the date, after a transcript is deleted following a withdrawal (C8, `removeTranscript`).
- Each quote copied into a company fact records its session, so it can be removed with that session's transcript (C8).
- A transcript keeps the speakers who weren't asked for consent when it was imported (`unaskedSpeakers`, `unnamedSpeakers`, rule C11).

## Changes from the Phase 0 review (WP9)

Fixes from the independent review, each with a test in `src/workspace/model/wp9.test.ts`:

- Amendments obey rule C2 too: an amendment can't agree to something the client wasn't told (`consent.told`).
- A damaged file entry opens the workspace read-only instead of refusing it.
- An AI proposal lists every session the AI was given (`origin.inputSessionIds`), and all of them must have allowed the processing (rule C5), not only those it cites.
- Files have a purpose (document, audio, consent attachment); audio needs consent to recording.
- A finding the consultant entered can't be AI-suggested; "conflicts with" counts once in either direction; the same person can't be asked twice; an amendment with an unreadable date is never in force; `sharedIds` also checks ids kept after their entity is deleted.

**For Phase 1:** deleting a session (decision 4) must reuse `removeTranscript`'s clean-up, so that what the AI proposed and the history lose that session's words too, and a finding said in the session with no segment left is removed rather than left invalid. *Done in WP4:* both share `scrubPassages`.

## Changes from Workspace Phase 1 (WP4)

Made from the user's decisions before Phase 1 (`docs/phase-1/PHASE-1-BRIEF.md`), each with a test in `src/workspace/model/phase1.test.ts`. No workspace had been saved yet, so they go into version 1 directly; from Slice B's merge on, every model change raises the version, with a migration.

- **Two AI statements** (decision 2): `told.processingLocal` and `told.processingExternal`, with `told.externalProvider` naming the provider the external statement named. See CONSENT.md C2.
- **Amendments record what the client was newly told** (decision 3): `told` and `wordingVersion` on a change amendment.
- **Withdrawal on an unlocked record** is an amendment, and locks the record (`amendConsent`).
- **The `future-consideration` finding kind.**
- **Deleting a session** (`removeSession`, decision 4): its participants, consent record, transcript, segments, notes and files go. Every passage of the session cited by a finding becomes deleted evidence, in the finding, in what the AI proposed and in its history, as after a withdrawal. A finding whose only evidence was in the session is removed, and so is one said in a session with no transcript segment left; others keep their evidence from other sessions. Company knowledge promoted from a removed finding stays, marked "source deleted", and keeps its copied quotes (unlike `removeTranscript` after a withdrawal, which removes them, C8).
- **Deleting an engagement** (`removeEngagement`): its findings and their links, its sessions (as above), its design links and its files. Company knowledge from its findings stays, marked "source deleted".
- Both return what they removed (findings, files) and the company facts affected, so the confirmation can name them.
- **Engagements, sessions and participants** (WP6, `entities.ts`): create and edit each. A participant the session's consent record names as asked can't be removed or moved to the consultant's side until the record changes. `consentSummary` gives a session's consent in a word for lists.
