# Domain model of the consulting workspace

- **Status:** Draft, for the user's approval (Phase 0, WP3)
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
| CompanyFact | statement, kind, provenance, promoted from (a finding, or none), who and when | Company knowledge (vision §3). Modelled now; the interface comes after extraction (MVP Q3). Only a finding in the record can be promoted. |
| Engagement | company, name, goal, status (active, or ended on a date) | The end date is what "keep until the engagement ends" in the consent form refers to (MVP Q5). |
| DesignLink | engagement, name, StyleCode document id | Where the design document is stored is decided in WP4. |
| Session | engagement, title, start time, audio files (Phase 3) | |
| Participant | session, name, role, organisation, side (client or consultant), speaker labels | A speaker label belongs to at most one participant in a session. A person can have several labels ("Alex", "Alex (Guest)"). |
| ConsentRecord | see "Consent" below | One per session, with amendments. |
| Transcript | session, source (file: name, `vtt` or `docx`, platform; or pasted), who imported it and when | One per session (MVP Q10). Recording (Phase 3) adds a third source. |
| TranscriptSegment | transcript, position, speaker label, start and end (ms), text, confidence | Kept exactly as imported (MVP Q9). Times and confidence only where the source has them; an end needs a start. Positions run from 0 without gaps. |
| Note | session, text, when written, when changed | Shown as a time of day and as time since the session started (MVP 5.1). |
| FileRef | owner (company, engagement or session), name, media type, size, who added it and when | Session files are recordings (Phase 3). Where the bytes are stored is decided in WP4. |
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

**Kinds** come from vision §2: business requirement, functional requirement, non-functional requirement, expectation, objective, operational challenge, existing system, budget, performance, scalability, security, design preference, constraint, open question, risk, decision.

**Evidence** is a list of passages, each a transcript segment or a note, with the words quoted from it. A quote must appear in its passage. Differences in white space, letter case and the style of quotation marks are ignored; anything else counts as invented evidence.

**Origin** records how the finding entered the workspace, separately from provenance (MVP Q14):

- entered by the consultant (who, when); or
- proposed by the AI (provider, model, when), with the consultant's review: pending, accepted (who, when) or rejected (who, when).

So a client's statement extracted by the AI has provenance `said-in-session`, with origin "proposed by the AI, accepted by Sam at 11:00". A risk the AI spotted that nobody mentioned has provenance `ai-suggested`.

**The record** is every finding entered by the consultant, plus every AI proposal the consultant accepted. Pending and rejected proposals are kept but aren't part of the record (MVP Q11). `recordGroups` groups the record as MVP Q12 says: confirmed, assumptions, and open (status unresolved, or kind open question whatever its status).

## Consent

Fields as listed in the Phase 0 brief (WP5 refines them in `docs/spec/CONSENT.md`):

- the session, who was asked (client participants), who asked, and how (verbally at the start, in writing beforehand, or other, described);
- the version of the wording shown, and what the client was told (one yes or no per statement);
- what was agreed: audio recording · transcription · AI processing on this computer · AI processing by an external provider (named);
- retention: N days, until the engagement ends, or deleted after transcription;
- outcome: given · given with limits (described) · declined;
- the consultant's confirmation (who, when), an optional attachment, the time it was locked, and amendments.

`consentState(record, at)` gives what a record allows at a point in time, after its amendments up to then. A draft, declined or withdrawn record allows nothing.

## Rules

Each rule is checked in code and covered by a unit test. `validateWorkspace` returns every problem, each with a stable code. `parseWorkspace` refuses data from a newer version and data with any problem.

| Rule | Code | Where |
| --- | --- | --- |
| A finding said in a session cites at least one transcript segment, from its own engagement | `finding.saidNeedsSegment`, `evidence.engagement` | `validate.ts` |
| Every cited segment or note exists, and the quoted words appear in it | `evidence.missing`, `evidence.invented` | `validate.ts`, `quoteAppearsIn` |
| An AI proposal becomes confirmed only through the consultant's action, recording who and when | `finding.confirmedByAi`, `finding.review`, `finding.statusSet` | `validate.ts`, `acceptProposal`, `setStatus` |
| The AI never supplies verified or calculated information | `finding.aiProvenance` | `validate.ts` |
| One company's data never references another company's ids | `ref.company`, `ref.missing` | `validate.ts`, `sharedIds` (ids found in two workspaces) |
| Links stay within one engagement, between findings in the record, without duplicates or self-links | `relation.*` | `validate.ts` |
| No transcript without a confirmed consent record that allowed transcription when it was imported | `consent.required` | `validate.ts`, `canCapture` |
| Importing a transcript locks the consent record | `consent.lock` | `validate.ts`, `lockConsent` |
| A locked record changes only by dated amendments, in order, each with who and why | `consent.amendment` | `validate.ts`, `editConsent`, `amendConsent` |
| Recording needs consent to recording; declined consent allows only notes | | `canCapture` |
| External AI only if the client agreed, with the provider named; AI processing covers the session's notes too (MVP Q15) | `consent.provider` | `aiPermission`, `validate.ts` |
| One consent record and one transcript per session; a speaker label belongs to one participant | `consent.duplicate`, `transcript.duplicate`, `participant.label` | `validate.ts` |

**Nothing is repaired on load.** The editor's project loader repairs what it safely can. The workspace loader doesn't, because dropping a piece of evidence or a consent amendment would quietly change what the record says. Problems are reported, and the caller decides.

**Changes are pure functions** that return a new value (`acceptProposal`, `rejectProposal`, `setStatus`, `editConsent`, `lockConsent`, `amendConsent`), so Phase 1 can make each one an undoable step, as the editor does with operations.

## Versioning

The workspace carries `format: "stylecode-workspace"` and `version: 1`. A newer version is refused with a message to update StyleCode. When the model changes, the version goes up and `parseWorkspace` gains a migration from the previous one, as the editor's project files do.

## Decisions in this draft that need the user

Each has the choice made in the code, which is easy to change.

1. **Withdrawal is final.** After a withdrawal, no further amendments are accepted, so consent can't be quietly given back on the same session. *Alternative:* allow a later "consent given again" amendment.
2. **"Suggested" findings in the record.** MVP Q12 groups the record into confirmed, assumptions and open, which leaves no place for a finding with status `suggested` (for example something the client suggested, accepted as such). `recordGroups` returns them as a fourth group, "suggested". *Recommendation:* show it as a fourth group in the record.
3. **Transcript import needs consent to transcription.** This is provisional until WP5 settles the exact rule.
4. **Deleting a session** (MVP 2.3) removes its consent record, transcript, segments and notes, and the findings whose only evidence is in it. A finding with evidence from other sessions too keeps that evidence and loses the rest. Not coded yet (deletion is Phase 1); recorded here so the model supports it.
5. **AI proposals and consent.** The validator doesn't yet check that an AI proposal came from a provider the session's consent allowed, because whether a provider counts as local or external (MVP Q16) is settled in WP5. `aiPermission` gives the caller what is allowed.
6. **The consultant's name** comes from the app (asked once, in settings) in Phase 1. The model only requires it to be present.
