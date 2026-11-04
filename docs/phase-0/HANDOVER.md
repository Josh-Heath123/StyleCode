# Workspace Phase 0: handover

- **Date:** 2026-11-04
- **Branch:** `phase-0-foundations`, from `main` at `fe1fa10`
- **Brief:** `docs/phase-0/PHASE-0-BRIEF.md`

Phase 0 laid the foundations for the consulting workspace: decisions, specs and a tested domain model, with no interface. The editor is unchanged, apart from `~/.stylecode/ai.json` saves now retrying on Windows.

## What was produced

| Work package | Output |
| --- | --- |
| WP0 | The base branch checked; the `onboarding.ts` / `Onboarding.tsx` name clash fixed (renamed to `onboardingState.ts`) and a Windows CI job added, merged as PR #6 |
| WP1 | `docs/decisions/TEMPLATE.md`, ADR-0001 to ADR-0004 |
| WP2 | `docs/spec/MVP.md`: the first-version slice as user stories, with Q1 to Q16 decided |
| WP3 | `docs/spec/DOMAIN-MODEL.md` and `src/workspace/model/`: types, validation, rules, tests and performance budgets |
| WP4 | `docs/ARCHITECTURE.md` §12, ADR-0005 to ADR-0009, storage measured on the user's laptop |
| WP5 | `docs/spec/CONSENT.md`: fields, draft wording, rules C1 to C11, an interface sketch and questions for the POPIA review |
| WP6, WP7 | Moved out of Phase 0 by the user: now the openings of Workspace Phases 3 and 2 |
| WP8 | `docs/ROADMAP.md`, "Consulting workspace": Phases 0 to 7 with scope, acceptance criteria and dependencies |
| WP9 | An independent review, its fixes, this handover and the pull request |
| Also | `CLAUDE.md` checked against the repo (Prettier, audio ignores, consent wording, code map); `server/shared/rename.ts` |

Tests at hand-over: typecheck, formatting, 286 unit tests and 50 browser tests, all passing on the user's Windows laptop; CI runs Linux and Windows.

## Decisions

All by the user, recorded where they apply.

| Decision | Where |
| --- | --- |
| The workspace is built in the StyleCode repo | ADR-0001 |
| Local-first: data, recordings and files stay on the computer | ADR-0002 |
| Consent is recorded before any recording or transcript import | ADR-0003 |
| Deterministic engines for cost, compatibility and constraints | ADR-0004 |
| Browser plus a local Node server, started with one command | ADR-0005 |
| A `StyleCode Data` folder, one folder and one JSON file per company; no SQLite for now | ADR-0006 |
| Editor projects stay in IndexedDB; engagement designs are copied into the company | ADR-0007 |
| The workspace API has the AI server's request checks, file-safety rules, and refuses to run inside a git repository | ADR-0008 |
| OS disk encryption, no app-level encryption yet; a warning for cloud-synced folders | ADR-0009 |
| The MVP slice and Q1 to Q16 | `docs/spec/MVP.md` |
| The domain model, with the seven review changes and six decisions | `docs/spec/DOMAIN-MODEL.md` |
| The consent form, with six decisions and the user's changes | `docs/spec/CONSENT.md` |
| Transcription and extraction tests moved to Workspace Phases 3 and 2 | The brief; `docs/ROADMAP.md` |

## Open questions

**From the independent review, for the user to decide** (none of these were decided in Phase 0):

1. **AI context beyond a session's own transcript and notes.** Rule C5 covers a session's transcript and notes. Phases 2, 4 and 7 would also give the AI findings, company facts and designs, which draw on other sessions; the editor's AI sends designs with no consent check. *Reviewer's recommendation:* check every finding, fact or design in an AI call against the sessions it draws on, leave out what fails, and say so.
2. **One "processingLocation" statement for two wordings.** The record doesn't say whether the client heard the local or the external version, and ticking the local one satisfies C2 for external AI too. *Recommendation:* two statements, `processingLocal` and `processingExternal`.
3. **Company facts have no status.** An assumption can be promoted and read as a fact. *Options:* copy the status onto the fact (recommended), or promote only confirmed findings.
4. **Phase 1 scope:** MVP.md puts opening the canvas (story 9) and file attachments (Q2) in Phase 1; the roadmap's Phase 1 has neither (the canvas is in Phase 4).
5. **Provenance can't change.** MVP 6.4 says attaching segments makes a finding "said in a session", but edits don't change provenance or record it. Derive provenance from evidence, or make it an edited field with history?
6. **Statuses when accepting a proposal.** MVP 6.2 offers confirmed, assumption or unresolved, but the AI may propose "suggested", which is kept; MVP 7.1 still describes three groups, while the record has four.
7. **Parts of the vision without a home in the roadmap:** a coherent architecture rather than a list of compatible options (§5), capacity and performance calculations (§7), comparing alternatives on cost (§6), company knowledge as AI context (§3), live transcription (§9.4), and a place for future considerations (§8).
8. **Telling the client something new later.** Amendments have no "told" field, so a later yes to something not told at first can never be valid. Allow "told" in amendments, or require a new session?

**Also open:**

- **POPIA review** before real use: the questions are listed in `docs/spec/CONSENT.md`. The wording stays `draft-1` until then.
- **Sample exports** from Teams, Zoom and Google Meet, provided by the user at the start of Workspace Phase 2 (MVP Q7).
- **When to revisit SQLite:** ADR-0006 names the triggers (a real workspace taking over a second to load, a need for ranked search, or `node:sqlite` stable with FTS5 on Windows).
- **Audio retention for "N days" and "until the engagement ends"** is a reminder for now; the Phase 3 brief confirms it (CONSENT.md decision 4).
- **Acceptance criteria for Workspace Phases 4 to 7** are first drafts, refined in each phase's brief.

## What Workspace Phase 1 starts with

1. A brief for Phase 1 (`docs/phase-1/`), from the roadmap's scope and acceptance criteria.
2. The shared request checks: move them from `server/ai/handler.ts` into `server/shared/`, with their tests, before adding any workspace route (ADR-0008).
3. `server/workspace/`: the `StyleCode Data` folder, refusing to start inside a git repository, the cloud-sync warning, reading and saving `workspace.json` with `checkBeforeSave`, `renameWithRetry` and the revision check (ADR-0006).
4. `npm start`, and the guide's sections on starting StyleCode for client work and on protecting client data.
5. The interface for companies, engagements, sessions, the consent form, notes and the hand-entered record, on top of the domain model in `src/workspace/model/`.

The domain model is ready to use as it is. Its changes are pure functions returning new values (`acceptProposal`, `editFinding`, `amendConsent`, `removeTranscript`…), so each user action can become one undoable step, and `parseWorkspace` already opens a damaged workspace read-only.
