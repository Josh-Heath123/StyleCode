# Workspace Phase 1: The workspace spine

> **For Claude Code.** Read `CLAUDE.md`, `docs/phase-0/HANDOVER.md`, `docs/spec/MVP.md`, `docs/spec/DOMAIN-MODEL.md`, `docs/spec/CONSENT.md`, ADR-0005 to ADR-0009 and `docs/ARCHITECTURE.md` §12 first. Phase 1 is built in three slices, each on its own branch with its own pull request. At every **⏸ Check-in**, stop, report and wait for the user.

## Goal

At the end of Phase 1, the consultant can run a real consultation with StyleCode, with no AI:

- open a client;
- create a project (engagement) and a meeting (session);
- fill in the consent form;
- take time-stamped notes;
- write up the findings by hand;
- link findings that affect each other;
- attach documents;
- export the record as a Markdown specification.

Everything is stored in one folder per client on the consultant's computer.

Phase 1 is the "Workspace spine" phase in `docs/ROADMAP.md`, and its acceptance criteria are the roadmap's.

## Decisions already made

Don't reopen these.

**By the user before Phase 1 (2026-11-04):**

1. **Files are in Phase 1.** Opening the canvas from an engagement waits for Workspace Phase 4. Attaching, opening and removing documents on a company or an engagement is in Phase 1 (MVP Q2). The editor stays as it is: a standalone tool, reachable from the workspace.
2. **Two statements for where the AI runs.** Replace the single `processingLocation` statement with two:
   - `processingLocal`: "The AI runs on my computer only; nothing is sent elsewhere."
   - `processingExternal`: "The transcript and my notes may be sent to *[provider]*, which processes them under its own terms, possibly outside South Africa."

   Under C2, local AI needs `aiExtraction` and `processingLocal`. External AI needs `aiExtraction` and `processingExternal`, with the provider named. The record then says exactly which version the client heard. This settles Phase 0 open question 2.
3. **Amendments can record what the client was newly told.** An amendment can add `told` statements and the wording version shown, for example when the client agrees to external AI by email after the meeting. C2 then checks each "yes" against everything the client has been told up to that point. This settles open question 8.
4. **Workspace first.** StyleCode opens on the consultant's list of clients, with the design editor one click away. Where the workspace server isn't running (the GitHub Pages demo, or any static build), the app opens on the editor and says, in one line, that the workspace needs StyleCode running on your computer. It never shows workspace controls that can't work.

**Already decided in Phase 0:** ADR-0001 to ADR-0009, `MVP.md` (Q1 to Q16), `DOMAIN-MODEL.md` and `CONSENT.md` (C1 to C11), as approved.

## Clarifications this brief makes

These follow from the approved specs. If one looks wrong, raise it at the WP0 check-in.

- **No consent record locks in Phase 1.** Locking happens on transcript import (Phase 2) or recording (Phase 3), so in Phase 1:
  - Changing a confirmed record edits it and clears the confirmation (C3), and the consultant confirms it again.
  - The "Amend…" interface for locked records is built in Phase 2, when import first locks a record.
  - **Withdrawal** works on any confirmed record, locked or not. It is always recorded as a dated amendment, and it locks the record. The model's `amendConsent` changes to allow this.
- **Deleting can't be undone** (MVP Q6), so a deletion also clears the undo history. The confirmation says so.
- **No transcripts in Phase 1,** so findings entered by hand can cite notes as evidence (a quote of at least three words, or the whole note). Their provenance is "entered by the consultant".
- **A "future consideration" finding kind** is added. Vision §8 lists future considerations in the workspace, and the model has no place for them.
- **Model versioning.** No workspace has been saved yet, so the model changes in Slice B go into version 1 directly. From the moment Slice B is merged, a saved workspace can exist, and every later model change raises the version, with a migration and a test.

## Deferred to the Phase 2 brief

These are not part of Phase 1. Don't build for them beyond what the model already does.

- AI context beyond a session's own transcript and notes (open question 1).
- A status on company facts (open question 3).
- Changing provenance when segments are attached (open question 5).
- Statuses offered when accepting a proposal (open question 6).
- Transcript import, AI extraction, recording, company knowledge screens, the canvas inside an engagement, sync between devices, and more than one consultant.

## Ground rules

- **Branches and pull requests.** One branch and one pull request per slice, from an up-to-date `main`:
  - `workspace-1a-server`
  - `workspace-1b-spine`
  - `workspace-1c-record`

  Make small, clear commits. Push the branch and open the pull request when the slice is done. The user merges; never merge or push to `main`.
- **Keep everything green after every commit:** `npm run format:check`, `npm run typecheck`, `npm test` and `npm run test:e2e`. CI runs Linux and Windows.
- **Never touch real client data:**
  - `npm start` uses the real folder, `~/StyleCode Data`.
  - `npm run dev` uses a separate `~/StyleCode Data (development)`, unless `STYLECODE_WORKSPACE` is set.
  - Browser tests use a temporary folder, set in `playwright.config.ts`. The first workspace test refuses to run if the folder isn't that temporary one, as the AI tests already do for their settings file.
  - The app always shows which data folder is in use.
- **Test data is role-played.** Extend the Harbour Bakery fixture; never use real people or companies.
- **No new runtime dependencies** without asking. No router library: use hash routes, such as `#/c/<company>/e/<engagement>/s/<session>`, so the browser's back button works.
- **Reuse what exists:** the design tokens in `src/styles/app.css`, `Icon`, menus, dialogs with `useDialogFocus`, the `Announcer`, error boundaries, and the editor session's autosave behaviour (retry with backoff, a warning before closing with unsaved changes, a visible save status).
- **Every change is a pure function** from `src/workspace/model/`. Each user action is one undoable step. New model functions get unit tests.
- **Interface:** plain English, keyboard-first, passes `e2e/accessibility.spec.ts`. Same visual identity as the editor: midnight surfaces, electric blue for the user's actions, cantaloupe kept for AI. Phase 1 has no AI, so no cantaloupe.
- **Windows first.** The user runs StyleCode on Windows 11. Everything must work there: paths, renames (`renameWithRetry`), deleting folders that antivirus may hold open, and `npm start`.

## Slice A: the workspace server (`workspace-1a-server`)

### WP0: Start clean

1. Update `main`, create `workspace-1a-server`, and run every check. Note the counts.
2. Commit this brief (`docs/phase-1/PHASE-1-BRIEF.md`) as the first commit.

⏸ **Check-in:** report the baseline, and raise any clarification above that looks wrong.

### WP1: Shared request checks

Move the request checks from `server/ai/handler.ts` into `server/shared/`, with their tests, before any workspace route exists (ADR-0008):

- loopback address;
- Host;
- exact Origin;
- `Sec-Fetch-Site`;
- the StyleCode header.

`/api/ai` uses the shared module. Its tests stay green unchanged.

### WP2: `server/workspace/`

Build the workspace server as a Vite plugin next to `server/ai`, mounted on the dev and preview servers (ADR-0005, ADR-0006, ADR-0008).

**The data folder:**
- Resolution: `STYLECODE_WORKSPACE`, otherwise the default for the mode (see Ground rules). The folder is created if it's missing.
- Refuse to start if the folder is inside this repository or any git repository, with the reason.
- Warn if the folder is inside OneDrive (the `OneDrive` and `OneDriveConsumer` environment variables on Windows), Dropbox, Google Drive or iCloud Drive. The warning is shown in the app until the folder moves.
- Layout: `companies/<company id>/workspace.json`, `workspace.previous.json` and `files/<file id>`.

**Routes** (every one through the shared checks; JSON bodies with a size limit; ids checked with `isValidId` before they become part of a path):
- **List companies:** id, name, industry, last changed, and whether the file has problems.
- **Create a company:** names unique ignoring case (`isCompanyNameFree`), checked against every company on disk.
- **Read a workspace:** `parseWorkspace`. Editable when valid; read-only, with its problems listed, when not.
- **Save a workspace:**
  - `checkBeforeSave` first.
  - The save names the revision it is based on. If the file has changed since, it is refused, and the app says the client was changed in another window.
  - The file is written to a temporary file, the current one is kept as `workspace.previous.json`, and the new one is renamed into place with `renameWithRetry`.
- **Delete a company:** the request repeats the company's exact name, as a second safeguard behind the interface's typed confirmation. It removes the company's folder, retrying if Windows reports a file busy.
- **Files:**
  - Upload to a company or an engagement, with a size limit, initially 50 MB per file. The bytes are stored by id, and the browser's file name is kept only as data.
  - Download as an attachment, with `X-Content-Type-Options: nosniff`.
  - Remove.

**Tests:** Node unit tests against temporary folders, covering:
- every refusal: inside a git repository, a bad id, a body that is too large, another origin, a stale revision, a workspace with problems;
- a save that survives an interrupted write;
- deleting a company.

Add browser tests for a request from another origin and for a path with an invalid id.

### WP3: `npm start` and the data folder in the guide

1. **`npm start`:** builds if needed, then serves the built app with both plugins, and prints the address. It must work from a Windows terminal.
2. **Docs:** update `CLAUDE.md` (commands), the README ("Getting started") and `docs/GUIDE.md` with three short sections:
   - "Starting StyleCode for client work": `npm start`; closing the terminal stops it; `npm run dev` is for development only.
   - "Where client data lives": the folder, one folder per client, backups are a folder copy.
   - "Protecting client data": ADR-0009's disk-encryption guidance, the cloud-folder warning, and that the consent wording is a draft until the POPIA review.
3. **Finish the slice:**
   1. Run an independent review subagent focused on security and data safety.
   2. Fix what it finds.
   3. Push the branch and open the pull request.

⏸ **Check-in:** give the user the pull request link and the CI result. Wait for the merge before starting Slice B.

## Slice B: clients, meetings, consent and notes (`workspace-1b-spine`)

### WP4: Model changes

Make these changes in `src/workspace/model/`, with tests, and update `DOMAIN-MODEL.md` and `CONSENT.md` to match:

1. The two AI statements (decision 2).
2. `told` and the wording version in amendments, with C2 applied to everything the client has been told so far (decision 3).
3. Withdrawal on an unlocked record, which locks it.
4. The `future-consideration` finding kind.
5. `removeSession` and `removeEngagement`, using the cascade the domain model already describes (decision 4, and `removeFindings` for company knowledge).

### WP5: App shell, navigation and the workspace store

1. **The front door** (decision 4):
   - The app opens on the list of clients.
   - Top-level navigation switches between the workspace and the editor. The editor keeps its own welcome screen and checklist, shown the first time the editor is opened.
   - Hash routes and a breadcrumb: Clients › Company › Engagement › Session.
2. **A client-side store for the open company:**
   - Loads through the API.
   - Applies changes through the model's pure functions, with its own undo and redo (separate from the editor's).
   - Autosaves like the editor does, with the save status, retries and the warning before closing.
   - Read-only mode shows a banner listing the problems and blocks every edit. Viewing and export still work.
3. **Settings:** the consultant's name, asked once before it is first needed, and the data folder in use, with any cloud-folder warning.

⏸ **Check-in: screens.** Build the shell and the clients list first, then show the user screenshots (Playwright, at 2×) of:
- the clients list, empty and with three clients;
- a company page;
- the navigation between the workspace and the editor.

Wait for the user's comments before building the remaining screens.

### WP6: Companies, engagements, sessions, participants

Build MVP stories 1 and 2:
- Create, edit and delete each.
- Deleting a company means typing its name. Deleting an engagement or a session needs a confirmation that names what will be deleted and says it can't be undone.
- Engagements have a status: active, or ended on a date.
- Participants each have a side (client or consultant) and a role.
- Every empty state says what to do next.

### WP7: The consent form

Build MVP story 3 and the interface in `CONSENT.md`:
- the form, with the draft-1 wording and the two AI statements;
- C2 shown next to each "yes";
- confirming, and editing an unlocked record (which clears the confirmation);
- declined consent means notes only (C7);
- withdrawal, with its reason;
- the consent state at the top of the session page.

C1's import and recording blocks come with the features they block (Phases 2 and 3). Don't add a placeholder for them.

⏸ **Check-in: consent.** The user fills in the form for a role-played session, from the keyboard alone, then confirms, edits, re-confirms and withdraws. Wait for their approval.

### WP8: Notes

Build MVP story 5:
- A keyboard shortcut starts a new note during a session.
- Each note shows its time of day and the time since the session started ("before the start" if it was written earlier).
- Editing a note keeps its original time and records when it was last changed.
- Notes can be deleted.
- Notes work when consent was declined.

Finish the slice:
1. Run an independent review focused on the consent rules, undo, and read-only mode.
2. Fix what it finds.
3. Push the branch and open the pull request.

⏸ **Check-in:** give the user the pull request link and the CI result. Wait for the merge.

## Slice C: the record, files and export (`workspace-1c-record`)

### WP9: Findings and the record

Build MVP stories 6.4, 7.1 and 7.2:
- **Add findings by hand:** kind (including future consideration), statement and status, with notes as evidence.
- **The record:** the engagement's record in four groups (confirmed, assumptions, open, suggested), filtered by kind and by session. Each finding shows its status and provenance as two separate labels.
- **Editing:** change statement, kind, status or evidence, each change recorded in the history with who and when, and each one undoable.
- **Links:** influences, depends on, conflicts with, refines. Links stay within one engagement, and can be followed both ways.
- **Keyboard:** moving through the record and adding a finding work without the mouse.

### WP10: Files

Attach, open and remove documents on a company or an engagement (MVP Q2), through the WP2 routes.
- Each file shows its name, size, who added it and when.
- Files are listed on the company or engagement page.
- Nothing reads a file's contents.

### WP11: Markdown export

Build MVP story 8:
- **One Markdown file per engagement,** containing:
  - company and engagement details;
  - sessions, with their participants;
  - findings, grouped as in the record, each with kind, status, provenance and quoted evidence;
  - links between findings;
  - every consent record, with its amendments and the full text of the wording version shown (C9).
- **Nothing from other engagements or companies.**
- **Deterministic:** the same record always produces the same file. Add a snapshot test.

### WP12: Docs and roadmap

- **README:** a short section on the workspace, with a screenshot of a role-played client.
- **Guide:** how to run a consultation in StyleCode, end to end.
- **ARCHITECTURE §12:** updated to describe what was built.
- **ROADMAP:** Workspace Phase 1 marked ✅. The vision items from Phase 0 open question 7 placed in the draft Phases 5 to 7:
  - a coherent architecture, not just a list of compatible options (§5);
  - capacity and performance calculations (§7);
  - comparing alternatives on cost (§6);
  - company knowledge as AI context (§3);
  - live transcription (§9.4).
- **Notes for the Phase 2 brief:** a list of the deferred questions.

### WP13: Review and hand-back

1. Run an independent review of the whole of Phase 1: a subagent that hasn't seen your reasoning, checking the work against this brief, the specs and the roadmap's acceptance criteria.
2. Fix what it finds.
3. Write `docs/phase-1/HANDOVER.md`: what was built, the decisions made, test counts, known limitations, and what Phase 2 starts with.
4. Push the branch and open the pull request.

⏸ **Check-in:** give the user the pull request link and the CI result.

## Definition of done

The roadmap's acceptance criteria for Workspace Phase 1, each covered by a browser test:

- [ ] I can create a company, an engagement and a session, close StyleCode, start it again with `npm start`, and find them again. The company is one folder under `StyleCode Data`.
- [ ] I can fill in, confirm, edit, re-confirm and withdraw a consent form. A "yes" to something I didn't tell the client can't be confirmed (C2), and the record shows which AI statement the client heard.
- [ ] I can add notes during a session and see their time and the time since the start. I can add findings by hand with a kind and status. The record shows them in four groups, and undo reverts each change.
- [ ] I can attach, open and remove a document on a company and on an engagement.
- [ ] Deleting a company asks me to type its name, and removes its folder.
- [ ] The Markdown export contains the findings, links and consent records, and is the same every time.
- [ ] Starting StyleCode with the workspace folder inside a git repository is refused, with the reason. A folder inside OneDrive shows a warning.
- [ ] A workspace file with a problem opens read-only and lists the problem. It is never saved over.
- [ ] StyleCode opens on the clients list. On the GitHub Pages demo, it opens on the editor and says the workspace needs StyleCode running on your computer.
- [ ] Everything works from the keyboard and passes the accessibility check. Typecheck and unit tests are green on Linux and Windows, and browser tests on Linux.
- [ ] Three pull requests, each reviewed independently and merged by the user; `docs/phase-1/HANDOVER.md` written.
