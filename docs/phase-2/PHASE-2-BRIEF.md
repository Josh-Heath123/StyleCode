# Workspace Phase 2: Extraction

> **For Claude Code.** Read these first:
> - `CLAUDE.md`;
> - `docs/phase-1/HANDOVER.md` and `docs/phase-2/NOTES-FOR-THE-BRIEF.md`;
> - `docs/spec/MVP.md` (stories 4 and 6), `docs/spec/DOMAIN-MODEL.md` and `docs/spec/CONSENT.md`;
> - "Old WP7" at the end of `docs/phase-0/PHASE-0-BRIEF.md`;
> - `docs/ARCHITECTURE.md` §12.
>
> Phase 2 is built in three slices, each on its own branch with its own pull request. At every **⏸ Check-in**, stop, report and wait.

## Goal

At the end of Phase 2, the consultant can:
- import the transcript Teams, Zoom or Google Meet produced, or paste one;
- say which speaker is which participant;
- ask the AI for findings, locally or by the provider the client agreed to;
- review every proposal with its quoted passage highlighted, keeping only what they checked;
- carry what was learned about a client into its next engagement.

Phase 2 is "Workspace Phase 2: Extraction" in `docs/ROADMAP.md`. Its acceptance criteria are the roadmap's, with the changes below.

## How decisions were made for this phase

The user asked the reviewer (Claude, in the planning Project) to settle what it could, because they don't have time for check-ins on detail. The decisions below are the reviewer's, made on the user's behalf on 2026-11-10, each following the specs and the recommendation recorded in Phase 0 or Phase 1. Raise any that looks wrong at the WP0 check-in. After that, don't reopen them.

**Check-ins in this phase are short:** screenshots, numbers and a recommendation. The user may pass a check-in to the reviewer and paste back its answer. Treat that answer as the user's.

## Decisions made for this phase

**Transcripts**

1. **The sample exports are the reviewer's, not the user's** (this changes MVP Q7). They are in `docs/phase-2/samples/`: one role-played meeting in nine layouts, rebuilt from each platform's published export layout, with the sources and how sure each layout is (`samples/README.md`). When a real export fails to import, type a new made-up sample in that layout, add it there, then support it. Never add the real file. Update MVP Q7 and the roadmap's "from the user's samples" to say so.
2. **Formats.** Support every layout in `samples/README.md`:
   - Teams `.vtt`, both from the meeting's Transcript pane and from Microsoft Graph;
   - Teams `.docx`, current and older layouts;
   - Zoom `.vtt` and `.txt`;
   - Google Meet `.docx` and `.txt`, including "Notes by Gemini", from which only the transcript is imported, never Gemini's AI-written notes;
   - pasted text (MVP 4.2).

   `.txt` joins `vtt` and `docx` as a source format. The platform is detected from the layout, and the consultant can correct it before importing.
3. **Segments follow the source.** Each cue, or each turn where the layout has no cues, becomes one segment. The one exception is Teams: parts that share an utterance id (`<uuid>/<n>-<part>`) are joined into one segment, placed where its first part was, even when another speaker's cue sits between them. The transcript view groups consecutive segments by the same speaker.

   Times are those the source gives:
   - **Google Meet:** a time line applies only to the first segment after it.
   - **Zoom `.txt`:** times are times of day. Each becomes an offset from the session's start when that gives 0 to 24 hours; otherwise it's an offset from the file's first time.
   - **Teams `.docx`, older layout:** the milliseconds aren't padded (`0:0:6.24` is 6 s 24 ms).
4. **The original file isn't kept.** The segments are the transcript, and the source records the file's name and format. Then deleting a transcript (C8) leaves no copy of the client's words behind.
5. **No new runtime dependency for `.docx`.** Read the zip in the browser with `DecompressionStream('deflate-raw')` and the XML with `DOMParser`. If that can't be made reliable on Windows and in the browsers CI runs, ask before adding a dependency.
6. **Importing is permanent.** It locks the consent record (C4), saves straight away and clears the undo history, as adding a file does. Replacing a transcript is possible only while no accepted finding cites it (MVP Q10). Replacing or deleting a transcript is permanent too, and removes pending proposals that cite it.

**AI extraction**

7. **What the AI is given (Phase 0 open question 1).** One session at a time: its transcript and its notes, and only where C5 and C6 allow them for the provider in use. Nothing from other sessions, engagements or companies, and no company facts or designs. To stop the AI proposing something again (MVP Q11), code drops a proposal that repeats a finding already in the engagement, in the record or rejected. A repeat means the same kind and the same statement once case, spacing and punctuation are ignored, or the same kind with the same evidence. The count dropped is reported with the others.
8. **Statuses when accepting (open question 6).** The AI proposes "suggested", "assumption" or "unresolved", never "confirmed" (MVP 6.2). On accepting, the consultant can choose any of the four, with the AI's choice preselected.
9. **Provenance follows the evidence (open question 5).** A finding that cites at least one transcript segment is "said in a session" (MVP 6.4). When it no longer cites any, it goes back to what it was created as: "entered by the consultant", or "AI-suggested". Model functions set it on every evidence change, and the history's evidence changes explain it.

**Consent**

10. **Amending a locked record (left open in Phase 1, item 5).** Build "Amend…" for locked records: answers, retention, outcome, statements newly told with the wording shown, and the reason. It is checked like the form (C2). This closes the gap the Slice B review found: an amendment that changes the retention needs the retention statement told in the new words.
11. **After a withdrawal (C8, item 6).** First offer to delete the transcript: permanent, and it says what will go. Then list the findings and company facts that keep a statement from the session, each with a way to edit or remove it.
12. **The consent attachment (item 7).** One file per consent record, such as a signed form or an email, with the purpose `consent-attachment`. Adding, replacing or removing it doesn't change the record or clear its confirmation (C3), and it's allowed on a locked record. Removing it is permanent, like any file.
13. **Speaker labels on people named on a locked record (item 8) can be matched and changed.** Matching changes only `speakerLabels`, never who was asked.

**The record and knowledge**

14. **Proposals that quote a note (item 9).** When editing or deleting the note is refused because a proposal under review quotes it, the message links straight to that proposal.
15. **Deleting a finding (item 10).** Allowed for any finding in the record, as an ordinary undoable step. Its links go with it, and company facts promoted from it say "source deleted". Pending proposals are rejected, not deleted.
16. **Evidence links land on the passage (item 11).** A link opens the session at the cited segment or note and highlights it, and the route carries the passage, so back and forward work.
17. **A status on company facts (open question 3).** Promoting a finding copies its status onto the fact, shown the same way, and the fact can be edited afterwards. Promoting doesn't change the finding.
18. **Time zones (item 12).** Each session keeps the IANA time zone it was created in (`timeZone`, from the computer). The export writes each session's times in its zone with the offset, for example `2026-11-05 10:00 (GMT+2)`. It still gives the same file every time.

**Evaluation**

19. **The evaluation set has three role-played consultations:**
    - Karoo Freight, from the samples;
    - two more that you write, in other industries, typed as Zoom and Google Meet exports.

    You draft each answer key. An independent subagent checks it against its transcript before it's used. The user may correct the keys at any time, but nothing waits for that. The Karoo Freight key is drafted already (`samples/karoo-freight-kickoff/answer-key.draft.json`).
20. **Real client use still waits for the POPIA review** of the consent wording. External AI means sending personal information outside South Africa (`CONSENT.md`, question 3), so the guide repeats this where it explains external providers.

## Clarifications

- **Model versioning.** Saved workspaces exist now, so the model changes in WP1 raise the workspace version to 2, with a migration in `parseWorkspace` and tests (`DOMAIN-MODEL.md`, "Versioning"):
  - sessions get `timeZone`, the computer's zone at migration;
  - the source format gains `txt`.

  Record the changes in `DOMAIN-MODEL.md`.
- **AI requests go through `server/ai`** (`/api/ai/chat`), so keys never reach the browser. The extraction schema is built from the domain types, as the editor's assistant builds its schema from the property registry (`src/ai/schema.ts`). The browser assembles, validates and stores the proposals.
- **Code checks every proposal before it's shown** (MVP 6.1). It drops a proposal if:
  - it cites a segment or note that isn't in the session it was given;
  - a quote doesn't appear in its passage (`quoteAppearsIn`), or is too short (`isQuoteLongEnough`);
  - its kind or status isn't allowed;
  - it repeats a finding (decision 7).

  It then reports the count dropped for each reason. Each proposal is stored as a pending finding with `origin.kind = 'ai'`, its provider, model, processing and `inputSessionIds` (C5).
- **Asking for findings** is one undoable step that adds the pending proposals together. A run can be cancelled, and then nothing is saved. Accepting, editing and rejecting are each an undoable step (MVP 6.2).
- **AI off, or not allowed for this session:** the action isn't offered, and the session says why (MVP 6.1, C7). The session never offers a provider that consent doesn't cover (C6).
- **No AI in CI.** Unit and browser tests use the fake provider (`e2e/fakeOllama.ts`) and recorded replies, and never touch the network.

## Ground rules

As in Phase 1 (`docs/phase-1/PHASE-1-BRIEF.md`, "Ground rules"), with these branches:
- `workspace-2a-transcripts`
- `workspace-2b-extraction`
- `workspace-2c-knowledge`

Also:
- **AI's visual identity:** cantaloupe marks what the AI proposed, as in the editor, and never what the consultant accepted.
- **Measurements happen on the user's computer** (`CLAUDE.md`). Run the live model measurements there, with Ollama, and record the hardware.

## Slice A: Transcripts (`workspace-2a-transcripts`)

### WP0: Start clean

1. If the lock heartbeat pull request (`NOTES-FOR-THE-BRIEF.md`, "Still open") isn't merged yet, finish it first, as its own pull request.
2. Update `main`, create `workspace-2a-transcripts`, and run every check. Note the counts.
3. Commit this brief and `docs/phase-2/samples/` as they are, as the first commit.
4. See what the computer has for local AI: is Ollama installed, and which models (`ollama list`)? Note the RAM and CPU, and the GPU if there is one. If Ollama isn't installed, ask the user once whether you may install it with `winget`. If they say no, WP6 measures with recorded replies only, and says so.

⏸ **Check-in:** report the baseline and the AI setup, and raise any decision above that looks wrong.

### WP1: Model changes (workspace version 2)

All of these are pure functions with unit tests:
- the version 2 migration (see "Clarifications");
- **`importTranscript`:** builds the transcript and segments, checks C1, locks the record (C4), runs `checkSpeakers` (C11) and records the platform;
- **`replaceTranscript` and deleting a transcript,** following decision 6 and C8 (`removeTranscript`);
- **`matchSpeaker`:** a label belongs to at most one participant. A label equal to a participant's name is matched automatically on import, and any match can be changed;
- **provenance derived from evidence** (decision 9);
- **`removeFinding`** (decision 15);
- **the retention check on amendments** (decision 10);
- **the consent attachment** (decision 12).

### WP2: Reading transcripts (`src/workspace/import/`)

- One pure parser per layout, plus detection, which takes bytes and returns segments or a refusal that names the problem. The details are in decisions 2 to 5 and `samples/README.md`:
  - UTF-8 with or without a byte-order mark, and UTF-16 with one;
  - `\n` and `\r\n`;
  - `<v Name>` with classes and HTML entities;
  - inline tags removed;
  - Teams parts joined.
- **Test every sample against `meeting.json`:** the same speakers, and the same words in the same order, when consecutive segments by one speaker are joined. Its `comparing` notes give the two expected differences: Teams labels Lerato "(Guest)", and the pasted text has one line without a speaker. The reviewer checked all ten files this way with a throwaway reader, so a failure is in the parser, not the sample. Add unit tests for the edge cases the README lists.
- A file that isn't a transcript (another `.docx`, an empty file, a `.vtt` without cues) is refused with a message saying what was expected.

### WP3: Importing, the transcript and speakers

On the session page:
- **Import transcript** (a file, or pasted text) is unavailable without consent to transcription, and says why (C1).
- **Before importing, a preview shows:**
  - the platform detected, which the consultant can change;
  - how many segments there are;
  - the speakers;
  - the C11 warning for speakers who weren't asked;
  - that importing locks the consent record and can't be undone.
- **The transcript view:** segments grouped by speaker, with the matched participant's name and side, and times where the source has them. The C11 warning stays on the transcript.
- **Matching speakers** (MVP 4.3): every label, its match, a way to change it, and "not matched".
- **Replace and Delete transcript,** following decision 6.
- **Findings added by hand can quote transcript segments** (MVP 6.4), which makes them "said in a session".
- **Evidence links land on the passage** (decision 16).

⏸ **Check-in: screens.** Screenshots at 2× of:
- the import preview for `teams-transcript.vtt`, with Lerato's C11 warning;
- the transcript;
- speaker matching;
- a refused file.

### WP4: Consent after import

- **Amend…,** following decision 10.
- **Withdrawal,** following decision 11.
- **The consent attachment,** following decision 12.

Then run an independent review subagent over the slice, fix what it finds, push, and open the pull request.

⏸ **Check-in:** the pull request link and the CI result. Wait for the merge.

## Slice B: Extraction (`workspace-2b-extraction`)

### WP5: The evaluation set and scorer (`eval/`)

This is old WP7, steps 1, 2 and 4, as in the Phase 0 brief.
- **Format:** `eval/consultations/<id>/transcript.json` (made by the WP2 importer), `answer-key.json` and `README.md`.
- **The three consultations of decision 19.**
- **The scorer:**
  - checks every cited passage and quote (invented evidence counts as a failure);
  - matches proposals to the key, automatically where the kind and evidence agree, and otherwise through a CSV for unclear matches;
  - reports precision, recall and the invented-evidence rate, per kind.
- **CI** runs the scorer's tests and scores one recorded run, so the harness can't silently break.

### WP6: Extraction

- **The prompt and the JSON schema,** from the domain types. The finding kinds come with their meanings (vision §2).
- **Chunking** for long transcripts: segment boundaries, with overlap, within the model's context size (`contextSize` in the AI settings). Proposals from all chunks are merged and deduplicated.
- **Validation, as in "Clarifications",** and storage as pending proposals.
- **Progress and cancelling,** and a clear message when the provider fails.
- **C5 and C6 checks** at the moment of sending, with `classifyProvider`.
- **Measure 2 or 3 local models** that fit the computer, through Ollama, on the three consultations. If the user adds a hosted model's key, measure one hosted model too, to show the gap.
- **Write `docs/research/EXTRACTION.md`:**
  - the results table, with the hardware;
  - the recommended default model, chunk size and prompt;
  - what accuracy StyleCode can promise;
  - how the interface should present uncertain findings.

⏸ **Check-in:** the results and the recommended default model.

### WP7: Reviewing proposals

- **The proposals beside the transcript and notes** on the session page, marked as the AI's. Selecting one highlights its quoted passages (MVP 6.2).
- **Accept,** with the status choice of decision 8.
- **Edit** before accepting (kind, statement, status, evidence).
- **Reject:** the proposal is kept, hidden, with who and when (MVP Q11).
- **Each of these is undoable.**
- **The keyboard:** moving between proposals, and accepting, editing and rejecting, all without the mouse (MVP 6.3). The shortcuts appear in the shortcuts dialog.
- **The counts dropped,** by reason, after each run.
- **The note link** of decision 14.
- **An evaluation report** from real use: per session, the proposals accepted, edited and rejected, by kind (the roadmap's last acceptance criterion). It's built from `origin.proposed` and the review states, and nothing leaves the computer.

⏸ **Check-in: screens.** Screenshots at 2× of a review in progress on Karoo Freight: a proposal selected with its passage highlighted, the edit form, and the counts dropped.

Then run an independent review subagent over the slice, fix what it finds, push, and open the pull request.

⏸ **Check-in:** the pull request link and the CI result. Wait for the merge.

## Slice C: Company knowledge (`workspace-2c-knowledge`)

### WP8: Company knowledge

- **Promote an accepted finding** (`promoteToKnowledge`), with decision 17.
- **The company page lists what is known about the client:** each fact with its kind, status, provenance and source, or "source deleted".
- **Every engagement of that company shows the facts,** and no other company's.
- **Edit or remove a fact,** as an undoable step.
- **After a transcript is deleted (C8),** facts lose their quotes from that session, and appear in decision 11's list.

### WP9: Export

- **Transcript quotes** in the findings' evidence, with the speaker (the matched participant's name, or the label) and the session.
- **Local times,** following decision 18.
- **Update the snapshot test.** The export still gives the same file every time.

### WP10: Docs and roadmap

- **Guide:** importing a transcript from each platform (where to download it), matching speakers, asking the AI, reviewing, company knowledge, and amending and withdrawing consent after an import.
- **`ARCHITECTURE.md` §12, `DOMAIN-MODEL.md` and `CONSENT.md`:** updated to describe what was built.
- **`MVP.md` Q7 and `ROADMAP.md`:** Phase 2 marked ✅, with decision 1 recorded.
- **`docs/phase-3/NOTES-FOR-THE-BRIEF.md`:** the questions Phase 3 inherits. One is test audio: old WP6 expected the user to record two role-played consultations, which they won't have time for. Note the option of synthetic speech with several voices, made on the computer, and what it can't show (real accents, crosstalk and room noise).

### WP11: Review and hand-back

1. Run an independent review of the whole of Phase 2: a subagent that hasn't seen your reasoning checks the work against this brief, the specs and the roadmap's acceptance criteria.
2. Fix what it finds.
3. Write `docs/phase-2/HANDOVER.md`: what was built, the decisions, test counts, the measurements, known limitations, and what Phase 3 starts with.
4. Push, and open the pull request.

⏸ **Check-in:** the pull request link and the CI result.

## Acceptance criteria

The roadmap's, with the samples of decision 1:
- Importing a transcript without confirmed consent to transcription is unavailable, and says why.
- Every layout in `docs/phase-2/samples/` imports and shows the meeting by speaker. Lerato is listed as not asked, and the warning stays on the transcript.
- A file that isn't a transcript is refused with the reason, and nothing changes.
- With a local model, I can ask for findings and review each proposal with its quoted passage highlighted. A proposal with an invented quote is never shown, and the count dropped is reported.
- A session whose consent allows only local AI refuses an external provider, saying why.
- After a withdrawal, deleting the transcript removes its words everywhere, and lists the findings and company facts that keep a statement from it.
- I can promote a finding to company knowledge and see it in the company's next engagement, with its source, or "source deleted".
- The evaluation report shows, per role-play transcript, the proposals accepted, edited and rejected.
- Everything works from the keyboard and passes the accessibility check. Typecheck and unit tests are green on Linux and Windows, and browser tests on Linux, as CI runs them.

## Definition of done

- [ ] Workspace version 2, with its migration and tests
- [ ] Every sample layout imports, tested against `meeting.json`
- [ ] Import, speakers, transcript view, replace and delete, amend, withdrawal flow and the consent attachment, each with browser tests
- [ ] The evaluation set (three consultations, checked keys), the scorer, and a recorded run in CI
- [ ] Extraction measured on the user's computer, in `docs/research/EXTRACTION.md`
- [ ] Review by keyboard, with undo, and the evaluation report
- [ ] Company knowledge across engagements, with "source deleted"
- [ ] The export with transcript quotes and local times; the snapshot updated
- [ ] Guide, architecture, specs and roadmap updated; Phase 3 notes written
- [ ] An independent review per slice and of the whole phase; handover written; three pull requests merged by the user
