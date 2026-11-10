# Workspace Phase 1: handover

Workspace Phase 1, the "workspace spine", is built: a consultant can run a real consultation in StyleCode with AI off. It covers the client, engagement and session; the consent form; time-stamped notes; findings written up by hand and linked; documents attached; and the record exported as a Markdown specification. Everything is kept in one folder per client on the consultant's computer.

- **Brief:** `docs/phase-1/PHASE-1-BRIEF.md`
- **Pull requests:**
  - Slice A, the workspace server: #9, plus #10 for the lock fix that missed it.
  - Slice B, clients, meetings, consent and notes: #11.
  - The licence change: #12.
  - Slice C, the record, files and export: this one.
- **How to use it:** the guide's [Running a consultation](../GUIDE.md#running-a-consultation).
- **How it works:** `docs/ARCHITECTURE.md` §12, ending with "The workspace in the browser".

## What was built

**The workspace server** (`server/workspace/`, Slice A)
- The `StyleCode Data` folder, with one folder per client.
- Saves are atomic and retried on Windows, and each one is checked against the revision it was based on.
- Permanent deletions are worked out by the server itself (decision 5), and file bytes are stored by id.
- StyleCode refuses to start inside a git repository, and warns about cloud-synced folders.
- A lock allows one StyleCode per data folder; it is released on exit and on stop signals, and taken over after a reboot.
- `npm start` builds when needed and serves on port 4173.
- The request checks are shared with `/api/ai`.

**The app shell** (Slice B)
- StyleCode opens on the clients list, with hash routes and a breadcrumb.
- Clients and the design editor are one click apart, and the editor keeps its view.
- Without the workspace server (as on GitHub Pages), it opens on the editor with a one-line note.
- The editor's projects are now called "Designs".

**Clients, engagements, sessions, participants** (Slice B, MVP stories 1 and 2)
- Create, edit and delete each.
- A client is deleted by typing its name; an engagement or session after a confirmation that names what goes.
- An engagement is active or ended on a date. Participants are on the client's side or yours.
- Client rows show their active engagements.

**The consent form** (Slice B, MVP story 3, `CONSENT.md`)
- The draft-1 wording in full, with the two AI statements; the external one names the provider set up in AI settings.
- C2 is shown beside each "yes". A draft can be saved; it can't be confirmed until C2 is met.
- Confirming, and editing, which clears the confirmation (C3). Changing who was asked, or the session's time, also clears it, with a warning first.
- "Nothing is agreed" blocks confirmation. Declined means notes only (C7).
- Withdrawal, with its reason: it locks the record, and it is final.
- The consent state shows at the top of each session.

**Notes** (Slice B, MVP story 5)
- <kbd>N</kbd> starts a note; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> adds it and starts the next.
- Each note shows its time of day and how far into the session it was written.
- Notes can be edited and deleted.
- A note not yet added is kept while the tab is open, so leaving the session page and coming back finds it; closing the page with one asks first.
- A note that findings quote lists them first, and one undo restores both (decision 6).

**The record** (Slice C, MVP stories 6.4 and 7)
- Findings added by hand, with a kind (including future consideration), a status and quotes from notes.
- Four groups (decision 8), filtered by kind and by session.
- Status and provenance are shown as two separate labels.
- Each finding has a history of changes with who and when, and every change is undoable.
- Links (influences, depends on, conflicts with, refines) within one engagement, shown from both ends and followed from the keyboard.

**Files** (Slice C, MVP Q2)
- Documents on a client or an engagement: name, size, who added each one and when.
- Adding and removing are both permanent: they save at once and clear the undo history.
- **Download** saves a copy and never opens the file inside StyleCode. Nothing reads a file's contents.

**Markdown export** (Slice C, MVP story 8)
- One file per engagement: the client, the engagement, its sessions and participants, findings grouped with their evidence, and links.
- Every consent record, with what it allows now, its amendments, and the full text of the wording shown (C9).
- Nothing from other engagements. Deterministic, byte for byte.

**Underneath**
- Every change is a pure function in `src/workspace/model/`, applied as one undoable step through `ui/steps.ts`. A refusal is reported, never passed off as done.
- Each open client has a `WorkspaceSession`, with its own undo and the editor's autosave behaviour.
- `SessionRegistry` keeps the current client open across pages and the editor.
- Read-only clients show each problem and what to do about it, and take no changes.

## Decisions made during Phase 1

The brief's decisions 1 to 10 were all followed. These came after it, all from the user:

| When | Decision |
| --- | --- |
| Slice A review | Files are saved with `<a download>` as `application/octet-stream`, never opened in place. Removing a file deletes its bytes, so undo of a file addition had to be settled (see WP10 below). |
| Slice A follow-up | The lock is released on SIGINT, SIGTERM, SIGHUP and SIGBREAK. A lock from before the last boot is taken over. |
| WP5 check-in | Engagements in the wide column; "engagement" everywhere; the editor's "Projects" became "Designs"; read-only shows plain text with what to do for each problem; ids in monospace; the open client's session survives a trip to the editor; no breadcrumb on top-level pages; client rows count active engagements. |
| WP7 check-in | Changing the retention unticks its statement. "Audio kept" only for audio. "Nothing is agreed" blocks confirmation. Your name is asked once, when first needed. The consent attachment waits for files. Read-only clients can be deleted, with the folder id shown. A participant named on the form can't be removed until unticked. Sessions are listed oldest first. Meetings are "sessions" on screen. |
| Slice B review | A withdrawal is final (clears undo). A locked record keeps who was asked and when. |
| Before Slice C | Changing the name, role or organisation of someone named as asked on a confirmed record, or the session's date or time, clears the confirmation (C3), with a warning first. |
| WP10 | Adding a file is permanent, like removing one: it saves at once and clears the undo history. The action is labelled "Download". |
| Licence | StyleCode is under the PolyForm Strict License 1.0.0 from #12. Versions up to `0fdbdcd` were MIT. |
| Lock follow-up | A small pull request after Slice B replaces the process-number check with a heartbeat (refreshed every 30 s; taken over after 2 min). Not built yet. |

## What the reviews found

Each slice had an independent review before its pull request. Each pull request lists the review's findings and fixes. The ones that mattered most:

- **Slice A:** permanent deletions trusted the page; an upload could recreate a deleted client; two servers could share a folder.
- **Slice B:**
  - edits could be silently dropped after switching clients and coming back;
  - deleting a copied client folder could delete the original;
  - a withdrawal could be undone.
- **Phase 1** (WP13):
  - on a copied client folder, every link led into the original client;
  - a deletion whose save failed looked done.

## Tests

Measured on the user's Windows machine, at the commit this pull request ends with:

- **Unit tests** (Vitest): 441 passed, 1 skipped. The skipped one sends a real SIGINT to check the lock is released; it runs on Linux CI only, because `kill()` on Windows ends a process without running its handlers.
- **Browser tests** (Playwright): 92 passed, including:
  - axe accessibility scans of every workspace page and dialog;
  - each acceptance flow done from the keyboard.
- CI runs typecheck, unit tests and the build on Linux and Windows, plus the browser tests on Linux.

**Definition of done:** each item is covered by a browser test, except these:
- **Restarting with `npm start`:** browser tests reload the page and check the data on disk; the server's reading and listing of clients is unit-tested (`store.test.ts`). `npm start` itself was checked by hand in Slice A.
- **Refusing a data folder inside a git repository:** the server refuses to start, before any page could load, so it is unit-tested (`folder.test.ts`). The cloud-folder warning has a browser test.

## Known limitations

- **No restart test:** see the definition of done above.
- **Unreadable clients:** a client whose file can't be read at all is listed, but the app offers no way to delete it. Delete its folder by hand.
- **Exports can be ahead of the disk:** the export uses what the page shows, so while a save is failing it can include changes that aren't saved yet.
- **Evidence links** open the note's session, not the note itself.
- **The data-folder lock** still decides by process number, so a reused process number can block a start. The heartbeat pull request fixes this.
- **The demo GIFs** in `docs/media` still show "Projects" (re-record with `npm run demos`, which needs ffmpeg).
- **The consent wording** is a draft until the POPIA review (`CONSENT.md`).

## What Workspace Phase 2 starts with

Phase 2 is extraction: transcript import, AI proposals and their review, then company knowledge (`docs/ROADMAP.md`). `docs/phase-2/NOTES-FOR-THE-BRIEF.md` lists the questions it inherits:
- the four questions this brief deferred;
- amending a locked record;
- what happens after a withdrawal;
- the consent attachment;
- speaker labels;
- AI proposals that quote notes;
- whether findings can be deleted;
- a time zone for the export, which writes times in UTC.

It also needs the sample exports from Teams, Zoom and Google Meet (MVP Q7). Before it, the lock heartbeat pull request.

The model is ready for it:
- `canCapture` blocks transcript import without consent;
- `lockConsent` and `amendConsent` handle locking and amendments;
- `removeTranscript` scrubs a withdrawn session's words everywhere;
- `checkSpeakers` gives the C11 warning;
- AI proposals keep what the AI proposed, their provider and every session they were given.
