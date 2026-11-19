# Workspace Phase 4: Canvas in context

> **For Claude Code.** Read these first:
> - `CLAUDE.md`;
> - `docs/phase-3/HANDOVER.md` and `docs/phase-4/NOTES-FOR-THE-BRIEF.md`;
> - ADR-0007 (`docs/decisions/0007-editor-projects-and-engagement-designs.md`), with ADR-0006 and ADR-0008;
> - `docs/ARCHITECTURE.md` §3, §4, §7, §8 and §12;
> - `docs/spec/MVP.md` (story 9.1), `docs/spec/DOMAIN-MODEL.md` and `docs/spec/CONSENT.md` (C2, C4, C5, C6, C8 and the POPIA questions).
>
> Phase 4 is built in three slices, each on its own branch with its own pull request. At every **⏸ Check-in**, stop, report and wait.

## Goal

At the end of Phase 4, the consultant can:
- create a design from an engagement, or copy one of the editor's own designs into it, and get back to the engagement in one step;
- trust that the design lives in the client's folder, with its images, and goes when the engagement or the client is deleted;
- see the engagement's record beside the canvas, and link a layer to the findings it answers, seeing the link from both sides;
- ask the canvas AI for changes that draw on the engagement's confirmed findings, and see which findings it used. Findings are left out where a session's consent doesn't allow it, and the assistant says how many and why.

Phase 4 is "Workspace Phase 4: Canvas in context" in `docs/ROADMAP.md`. Its acceptance criteria are the roadmap's, with the changes below. It also builds MVP story 9.1, "Open the canvas from an engagement". That story was planned for Phase 1 but wasn't built, and nothing links an engagement to a design yet: `DesignLink` is in the model, but no page, route or server code uses it.

## How decisions were made for this phase

The user asked the reviewer (Claude, in the planning Project) to settle what it could. The decisions below are the reviewer's, made on the user's behalf on 2026-11-17. Each follows the ADRs, the specs, the roadmap and `docs/phase-4/NOTES-FOR-THE-BRIEF.md`. Raise any decision that looks wrong at the WP0 check-in, especially where the code shows a simpler way to the same behaviour. After that, don't reopen them.

**Check-ins in this phase are short:** screenshots, numbers and a recommendation. The user may pass a check-in to the reviewer and paste back its answer. Treat that answer as the user's.

## Decisions made for this phase

### Designs in the engagement (ADR-0007)

1. **A design opens from its engagement** (MVP 9.1). The engagement page gets a **Designs** card:
   - **New design** creates the editor's starter document (one 1440×900 desktop frame, `createStarterDocument`) and opens it.
   - **Copy one of the editor's designs…** lists the standalone designs in this browser and copies the one chosen (decision 3).
   - Each design row has **Open**, **Rename…** and **Delete…**.

   In the editor, the top bar shows the client, the engagement and the design, with **Back to the engagement** one step away (a link, and a shortcut if the editor's shortcuts leave one free). The editor's own **Designs** list keeps showing only standalone designs.

2. **Where a design lives.** The design is stored at `designs/<document id>.stylecode.json` in the company's folder (ADR-0006, ADR-0007), in the editor's own file format, read with `parseProject`. Its **images** go in `designs/assets/<asset id>`, under the content-hash ids the editor already uses, so an image used twice is stored once per company. They are never kept in the browser's storage, so deleting a client leaves nothing of it behind in IndexedDB. While a design is open, the page holds its images in memory. Saves follow `workspace.json`'s rules:
   - one at a time, to a temporary file renamed into place with `renameWithRetry`;
   - the last good copy is kept;
   - each save carries the revision it was based on, and a stale one is refused;
   - the server refuses a design that `parseProject` rejects, and one over a size limit set well above the measured size of the 5,000-layer performance document.

   Design files and images that no saved workspace lists are removed on a permanent save once they are a day old, as files are (Phase 1, decision 5). The server works out which images are still used by reading the company's designs.

3. **Copying a standalone design into an engagement:**
   - the copy gets a new document id and keeps the original's name;
   - the images it uses are uploaded into the company;
   - its layer links (decision 10) are dropped;
   - the original is untouched, which a browser test checks by comparing the IndexedDB record before and after.

   Nothing is migrated automatically (ADR-0007).

4. **The editor's second persistence adapter.** A company design autosaves through `/api/workspace` with the editor's existing behaviour: half a second after a change, retries with backoff, the save status, the warning before closing with unsaved changes, and the recovery screen. Two rules are tested in the browser:
   - a company design is never written to IndexedDB;
   - a standalone design is never written to a company folder.

   A design open in two tabs doesn't fall back to "last tab wins": the stale save is refused and the tab says "This design changed in another tab. Reload it to carry on." Switching designs follows the editor's present rules: a running save finishes first, and it asks before losing changes that couldn't be saved. While a company design is open, its client stays open in the registry (`SessionRegistry.hold`), so the record beside it stays current. If the client or the engagement is deleted while its design is open, the editor closes the design without saving it back, and says why.

5. **One name.** Renaming the design in the editor or on the engagement renames it in both places (the document's name and `DesignLink.name`).

6. **Deleting.**
   - Deleting a design from the engagement is a permanent step, with a dialog that names it and says it can't be undone. It removes the design file and any images no other design of the client uses.
   - Deleting an engagement or a client removes its designs and their images. The model already drops the engagement's design links; the server now deletes their files.

7. **A design that can't be opened.** A design whose file doesn't parse, or one belonging to a client that opens read-only, is listed with the reason and a **Download** of the file as it is. It isn't opened in the editor and is never saved over, as the editor already treats a damaged project.

8. **Routes:**
   - `#/c/<company>/e/<engagement>/d/<design>` opens the editor on that design.
   - `…/d/<design>/l/<layer>` opens it with that layer selected and in view.
   - `#/editor` stays the standalone editor.

   The server reads and writes only designs in the company named in the request, by an id checked with `isValidId` (ADR-0008). It never touches anything outside the company's `designs/` folder.

### The record beside the canvas

9. **A Record panel** shows when a company design is open, beside the layers panel. It can be shown and hidden, and is reachable from the keyboard. It lists the engagement's findings in the record's four groups, with statement, kind and status, and a text filter. The panel is read-only: findings are edited on the record page, one link away. Only that engagement's findings appear. The standalone editor has no Record panel.

10. **Links live on the layer, in the design.**
    - A layer gets a `findings` property: the ids of the findings it answers. This raises the design file to version 5, and older files open unchanged.
    - Linking and unlinking are ordinary editor changes, one undo step each. A link moves, copies and deletes with its layer.
    - Like `noteTarget`, the property is excluded from what the AI may set (`src/ai/schema.ts`). It is also left out of code export and the preview.
    - Links survive copy and paste only within the same design. Pasted into any other design, a layer loses them, and so does a design copied in by decision 3.

    Keeping links on the layer means one undo history and no second store to keep in step. The canvas's own model stays pure: it holds ids only, and learns what they mean from the workspace.

11. **Both sides of a link:**
    - **From a layer:** a selected layer's properties list its findings (statement and status), each with **Unlink** and **Open in the record**. A Record-panel finding offers **Link to the selected layer** (several layers at once if several are selected).
    - **From the record:** a finding on the record page lists **In designs:** "Checkout › Pay button", each a link to that layer (decision 8). The page reads the engagement's designs through the workspace API.
    - A link to a finding that is no longer in the record shows "No longer in the record", with **Remove link**. A link whose layer was deleted went with the layer.

12. **The Markdown export is unchanged in Phase 4.** Designs and their links come into the full specification export of Phase 7, as the roadmap says.

### The canvas AI with the record

13. **A new consent statement, `aiDesign`, in wording `draft-2`.** Today the client is told: "I'll use AI to help pick out requirements, questions and risks from the transcript and my notes." Designing screens from the record is a further use of the same AI, and C2 says the client can only agree to what they were told. So `draft-2` adds:

    > "I may also use AI to help sketch the screens from what we agree. It sees my summary of what you said, not the recording or the transcript."

    - It is a statement the consultant ticks when they've said it. **It is not a new yes:** the AI yes (on this computer, or by the named provider, C2 and C6) still decides where the AI may run.
    - A session's findings go to the canvas AI only if `aiDesign` was told: on the form, or later through an amendment recording it as newly told (C4).
    - **Workspace version 6** migrates every existing record with `aiDesign` not told. `draft-1` keeps its text: a version's text never changes (`wording.ts`), and new forms show `draft-2`.
    - Add it to `CONSENT.md`'s questions for the POPIA review. The wording is still a draft, and real client use still waits for that review.

14. **What the canvas AI is given from the record (C5, extended):**
    - only the design's engagement's **confirmed** findings: accepted, with status "confirmed". Never proposals under review, "suggested", assumptions or unresolved ones;
    - only each finding's statement and kind. Never its quotes, evidence, notes or transcript;
    - a finding is included only if **every session it rests on** allows it at that moment: the sessions of its evidence and, for a finding the AI proposed, every session it was given (`origin.inputSessionIds`). Each must pass `canUseAi` for the provider set up now (C5, C6) and have been told `aiDesign`;
    - a finding resting on no session (entered by the consultant, citing nothing) is sent only to an AI on this computer.

    This is checked again before every request, as extraction checks before every part. The assistant says how many findings were left out and why, for example: "3 findings left out: their sessions don't allow this provider". The check is a pure model function with unit tests. `src/ai` keeps its layering: it receives the record as plain data from the app and never imports `src/workspace`.

15. **Room and order.** The screen comes first: what the request may change, its ancestors, and then the rest of §8's context. Findings use what's left of the character budget, at most a third of it, in this order:
    - those linked to the layers in scope;
    - then the others by kind, most useful to design first: design preference, functional requirement, non-functional requirement, expectation, constraint, business requirement, then the rest;
    - oldest first within each.

    What doesn't fit is summarised: "… 6 more findings not shown". The order is deterministic, with unit tests.

16. **Saying which.**
    - The model sees findings under short ids (`F1`, `F2`…), as it sees layers (`e1`…). A layer that has links shows them on its line: `findings=F3,F7`.
    - The reply gains a `findings` list: the ids it drew on. The schema has it only when findings were offered.
    - The assistant shows "Drew on:" with each finding's statement, linking to the record. An id that wasn't offered is ignored and counted.
    - **The AI can't link layers to findings or change the record.** Links are the consultant's statement of what answers what, as a confirmed status is (ADR-0004: the AI never marks anything as verified).

17. **Heavy jobs.** A canvas request on a model on this computer is a local AI run, so it takes its turn in the heavy slot behind a transcription or an extraction, and says so. The cooling pause applies before it (Phase 3, decision 10). **Stop** and **Don't wait** work as they do elsewhere. Requests to an external provider don't take the slot.

18. **What doesn't change.**
    - The design itself goes to the AI as it does today, locally or externally as the settings say. It is the consultant's work, not the client's words. The guide says plainly that whatever is typed into a design is sent with it.
    - The standalone editor gets no record, no findings and no consent check. Its behaviour, tests and performance budgets stay as they are.

### What Phase 4 inherits (`docs/phase-4/NOTES-FOR-THE-BRIEF.md`)

19. **Extraction questions 1 to 3 wait.** These are decision 8's downstream check for `--max-context 0`, the quote check's 18 of 127, and the part size. Phase 4 doesn't change extraction, and each needs about an hour of the laptop's GPU and the user's time. They go to the first phase that changes extraction, or a short measurement slice before real client use, whichever comes first. The part size goes first, because it may raise recall the most (82 to 83% against 65 to 70%). Record this in `ROADMAP.md`.

20. **Heat (question 4).** The guide recommends the laptop's balanced or quiet power mode for transcription and long AI runs: slower, but cooler, and Windows stops the laptop less often for heat. Phase 3's measurements aren't repeated, because the estimates already come from this computer's own past runs, so they follow the mode in use. On the user's laptop, StyleCode's long runs use OMEN's Balanced mode.

21. **Question 5** (waiting rows on the start-up list) stays as built. **Question 7** (AI context beyond one session) is answered for the canvas by decision 14; extraction still reads one session.

22. **Question 6: a company fact records its engagement.** Workspace version 6 is needed anyway (decision 13), so a fact's source also gains the engagement's id. It is migrated from the fact's finding or its sessions where either still exists, and is otherwise none. New promotions set it. The export then finds a fact even after its finding and sessions are gone.

23. **Two flaky tests are fixed in Slice A** (WP1), because every slice's CI must pass without retries:
    - `e2e/accessibility.spec.ts`, "keyboard only › moves through the layer tree, renames a layer and edits a property": the width typed from the keyboard came out as 1 rather than 900 on CI's first try (#22). That looks like the panel-field focus race #18 fixed, in another path.
    - `e2e/workspace.spec.ts`, "settings keep the consultant's name and show the data folder": it reads a name other tests change in parallel.

    `e2e/large-document.spec.ts` and `e2e/images.spec.ts` stay on the watch list. If one fails again, fix it in its own small pull request.

### Checking it with the real model

24. **A short live check on the laptop** (WP10). Tests use `e2e/fakeOllama.ts`, so they can't show whether qwen3:4b actually uses findings. The run is:
    - about 8 requests on two role-played engagements, Harbour Bakery and Karoo Freight, each with a design and a record of 15 to 30 confirmed findings;
    - each request made with and without the record;
    - on qwen3:4b on this computer, in Balanced mode, from a committed launcher the user double-clicks, in about 20 minutes.

    Record per request:
    - whether the reply validated;
    - the findings it cited, and whether every one was offered;
    - whether it cited at least one of the findings a small key marks as relevant;
    - the time taken.

    Write it up in `docs/research/CANVAS-AI.md`, saying the data is role-played. There is no pass mark. If replies validate less often with the record than without, or cite findings they weren't given, report it with a recommendation (for example a smaller share of the budget).

## Clarifications

- **Model versioning.** Two separate formats change:
  - **The workspace goes to version 6:** `aiDesign` on every consent record's `told`, and `engagementId` on a company fact's source. The migration is in `parseWorkspace`, with tests, recorded in `DOMAIN-MODEL.md`.
  - **The design file goes to version 5:** a layer's `findings`. Version 4 files open unchanged. Record it in `ARCHITECTURE.md` §3.
- **New model functions,** pure, with unit tests:
  - attaching a new design, attaching a copy, renaming and removing a design (workspace);
  - linking, unlinking and stripping links (design);
  - which findings a request may use, and why the others are left out (decision 14);
  - the order and budget of the findings in the context (decision 15).
- **No network and no real model in tests.** Browser tests use the fake Ollama, as the editor's AI tests do, and extend the Harbour Bakery fixture with a design that has links. Test data is role-played.
- **Not the AI's colour.** Links and the Record panel are the consultant's, in electric blue. Cantaloupe stays for what the AI proposes, including its "Drew on" list while the proposal is under review.
  - *Note, 19 November 2026:* the identity work (`docs/presentation/PRESENTATION-BRIEF.md`, I1 and I7) keeps this split in new colours: the consultant's marks are warm white, and the AI's are orange (`docs/brand/IDENTITY.md`).
- **PowerShell is denied to you on this laptop,** as before.

## Ground rules

As in Phase 1 (`docs/phase-1/PHASE-1-BRIEF.md`, "Ground rules"), with these branches:
- `workspace-4a-designs`
- `workspace-4b-record`
- `workspace-4c-ai-context`

Also:
- **The editor is shared with standalone use.** Every existing editor test stays green, as it is. `e2e/layout-parity.spec.ts` stays green, and the performance budgets (`src/model/performance.test.ts`, `src/workspace/model/performance.test.ts`) aren't loosened.
- **Companies never mix,** and neither do the editor's two stores. Browser tests check that a design from one client never opens under another's route, and that decision 4's two rules hold.
- **No new runtime dependency.**
- **Long runs** (anything over about 10 minutes on the laptop) start from a committed `.cmd` launcher the user double-clicks, with its own data folder and local Ollama only. They refuse cloud models (`-cloud`, `:cloud`), delete nothing outside their own folder, and have no "done" markers left over that would skip a step. Tell the user before the run: Balanced mode, a hard surface with the back raised, the lid open, and lock the screen rather than sign out.
- **CI** stays as pinned in #22: every action at a full commit SHA with its release as a comment. Change nothing in `.github/` without asking.

## Slice A: Designs in the engagement (`workspace-4a-designs`)

### WP0: Start clean

1. Update `main` (at `d6002b2` or later), create `workspace-4a-designs`, and run every check. Note the counts.
2. Commit this brief as the first commit.
3. Read the editor's persistence (`src/persistence/session.ts`, `assets.ts`) and the shell (`src/workspace/ui/Shell.tsx`), and say how you'll add the second adapter without changing standalone behaviour.

⏸ **Check-in:** the baseline, the plan for the adapter, and any decision above that looks wrong.

### WP1: Two flaky tests (decision 23)

- **The keyboard-only accessibility test.** Reproduce it with `--repeat-each` and more workers than the default, find the race, and fix its cause in the panel field, not by waiting longer in the test. Then run it 50 times under 4 workers, all green.
- **The consultant's name.** Make the settings test independent of other tests changing the name, for example by giving the tests that change it their own project or their own name, not with retries.

### WP2: The server and the model

- Designs and their images in the company's folder (decisions 2, 6 and 8): routes, revision checks, the last good copy, size limits, and cleanup.
- Model functions to attach a new design, attach a copy, rename and remove one.
- Server tests:
  - ids and company checks;
  - a design of another company refused;
  - a stale revision refused;
  - a design `parseProject` rejects refused;
  - unlisted files removed after a day;
  - the engagement's and the client's deletion removing designs and images;
  - an image used by two designs kept until both are gone.

### WP3: The editor on a company design

- The second persistence adapter and the images (decisions 2 and 4).
- The routes (decision 8), and the top bar with **Back to the engagement**.
- The Designs card (decision 1): new, copy, open, rename, delete. Designs that can't be opened are handled as decision 7 says.
- Browser tests:
  - the original is unchanged after a copy, and the copy is in the company's folder with its images;
  - decision 4's two rules;
  - two tabs;
  - closing and reopening StyleCode finds the design;
  - the engagement's deletion;
  - a damaged design and a read-only client;
  - the accessibility check of the new screens.

Then run an independent review of Slice A (a subagent that hasn't seen your reasoning), fix what it finds, push, and open the pull request.

⏸ **Check-in:** screenshots at 2× of:
- the Designs card with two designs, one of them damaged;
- the copy dialog;
- the editor on a company design, with its top bar.

Also bring the pull request link and the CI result. Wait for the merge.

## Slice B: The record beside the canvas (`workspace-4b-record`)

### WP4: Links in the design (decision 10)

- Design file version 5, with `findings` on layers.
- Linking, unlinking and stripping, as editor changes.
- Excluded from the AI's schema, code export and the preview.
- Unit tests:
  - version 4 files open unchanged;
  - the random-operations undo test still passes with links;
  - paste into another design and a copy into the engagement strip links;
  - code export is byte-for-byte unchanged by links.

### WP5: The Record panel (decisions 9 and 11)

- The panel, the filter, and **Link to the selected layer**.
- A layer's findings in its properties, with **Unlink** and **Open in the record**.
- Keyboard and screen reader: the panel joins the editor's keyboard models and announces links made and removed.

### WP6: The other side (decision 11)

- **In designs:** on the record page, with links to the layer.
- "No longer in the record", with **Remove link**.
- Browser tests:
  - link from the canvas and see it on the record page;
  - follow it back to the layer;
  - undo the link;
  - delete the finding and see "No longer in the record";
  - the accessibility check.

Then run an independent review of Slice B, fix what it finds, push, and open the pull request.

⏸ **Check-in:** screenshots at 2× of:
- the editor with the Record panel open and a selected layer showing its findings;
- a finding on the record page with **In designs:**.

Also bring the pull request link and the CI result. Wait for the merge.

## Slice C: The canvas AI with the record (`workspace-4c-ai-context`)

### WP7: Consent and workspace version 6 (decisions 13, 14 and 22)

- `aiDesign` and wording `draft-2`, on the form and in amendments. The export prints the wording version each record was shown (C9).
- The version 6 migration, with tests.
- The pure check of which findings a request may use, and why others are left out.
- Unit tests:
  - each consent case: declined, withdrawn, local only, the wrong provider, `aiDesign` not told, told by amendment;
  - a finding resting on two sessions where only one allows it;
  - an AI-proposed finding whose input session doesn't allow it;
  - a finding resting on no session, local and external.

### WP8: The context and "Drew on" (decisions 14 to 18)

- The record in the canvas AI's context, with the order and budget, and short ids, including on linked layers.
- The `findings` list in the reply, shown as "Drew on:", with ids not offered ignored and counted.
- The left-out message.
- The heavy slot and the cooling pause for local canvas requests.
- Unit tests for the context builder (order, budget, the third, "… more not shown"), the schema with and without findings, and interpreting the reply.
- Browser tests with the fake Ollama:
  - a request that draws on findings and says which;
  - a finding left out by consent, and the message;
  - a canvas request waiting behind a transcription;
  - the standalone editor unchanged.

### WP9: The live check's launcher (decision 24)

Write the runner, its two role-played records and designs, the small key, and the committed launcher.

⏸ **Check-in:** the launcher's path, for the reviewer to read before the user double-clicks it, and how long it should take.

### WP10: The live check on the laptop

The user double-clicks the launcher. Score the results, and write `docs/research/CANVAS-AI.md`.

### WP11: Docs and roadmap

- **The guide:**
  - designs in an engagement;
  - copying one of the editor's designs;
  - the Record panel and links;
  - the canvas AI with the record: what it sends, what it leaves out and why, and that a design is sent as it is;
  - the new consent statement;
  - the balanced power mode (decision 20).
- **`ARCHITECTURE.md`:**
  - §3: design file version 5;
  - §7: the two persistence adapters;
  - §8: the record as context, with the consent check;
  - §12: `designs/` with `assets/` in the storage diagram, and a new "Canvas in context (built in Workspace Phase 4)" section.
- **`DOMAIN-MODEL.md`:** version 6.
- **`CONSENT.md`:** `draft-2`, C5 as extended, a "Changes from Workspace Phase 4" section, and the new POPIA question.
- **`MVP.md`:** story 9.1 built, and "a canvas informed by the record" no longer out of scope.
- **`ROADMAP.md`:** Phase 4 ✅, with decision 19's place for the extraction questions.
- **The README.**
- **`docs/phase-5/NOTES-FOR-THE-BRIEF.md`:** the questions Phase 5 inherits.

### WP12: Review and hand-back

1. Run an independent review of the whole of Phase 4: a subagent that hasn't seen your reasoning checks the work against this brief, the specs and the roadmap's acceptance criteria. Ask it to look hardest at decision 4's two rules, decision 14's consent check, and companies never mixing.
2. Fix what it finds.
3. Write `docs/phase-4/HANDOVER.md`: what was built, the decisions, test counts, the live check, known limitations, and what Phase 5 starts with.
4. Push, and open the pull request.

⏸ **Check-in:** the pull request link and the CI result.

## Acceptance criteria

The roadmap's, with this phase's decisions:
- From an engagement I can create a design, or copy one of the editor's designs into it. The original is unchanged, the copy is in the company's folder with its images, and I get back to the engagement in one step.
- Closing and reopening StyleCode finds the design as I left it. Deleting the engagement or the client deletes its designs and their images.
- I can link a layer to a finding and see the link from both sides. Undo removes it.
- The AI's suggestions for a screen can draw on the engagement's confirmed findings, and say which. Findings whose sessions don't allow it are left out, and it says how many and why.
- The editor's own designs work exactly as before, and nothing of a client's is kept in the browser's storage.
- Everything works from the keyboard and passes the accessibility check. Typecheck and unit tests are green on Linux and Windows, and browser tests on Linux, as CI runs them, without retries.

## Definition of done

- [ ] The two flaky tests fixed at their cause
- [ ] Designs and their images in the company's folder; the second persistence adapter; the Designs card, routes and top bar; copies leave originals untouched; the two stores never mixed
- [ ] Design file version 5 with links; the Record panel; both sides of a link
- [ ] Workspace version 6 with its migration; `aiDesign` in wording `draft-2`; facts that record their engagement
- [ ] The canvas AI with the record: consent-checked, budgeted, "Drew on", left-out counts, the heavy slot and the cooling pause
- [ ] The live check run on the laptop, and `docs/research/CANVAS-AI.md` written
- [ ] Guide, architecture, specs and roadmap updated; Phase 5 notes written
- [ ] An independent review per slice and of the whole phase; handover written; three pull requests merged by the user
