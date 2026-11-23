# Workspace Phase 4: handover

Workspace Phase 4, "Canvas in context", is built. A consultant can create a design from an engagement, or copy one of the editor's own designs into it, and get back to the engagement in one step. The design and its images live in the client's folder, never in the browser's storage, and go when the engagement or the client is deleted. The engagement's record sits beside the canvas, a layer can be linked to the findings it answers, and the link shows from both sides. The canvas AI on a client's design is given the engagement's confirmed findings where each session's consent allows it, says which it drew on, and says how many it left out and why.

- **Brief:** `docs/phase-4/PHASE-4-BRIEF.md`
- **Pull requests:**
  - Slice A, designs in the engagement: #23.
  - Slice B, the record beside the canvas: #24.
  - Slice C, the canvas AI with the record, the docs and this handover: this one.
- **How to use it:** the guide's [Designing for a client](../GUIDE.md#designing-for-a-client), and step 4 of [Running a consultation](../GUIDE.md#running-a-consultation) for the `draft-2` statement.
- **How it works:** `docs/ARCHITECTURE.md` §3 (design file version 5 and layer links), §7 (the two persistence adapters), §8 (the record as context) and §12, "Canvas in context".
- **Consent:** `docs/spec/CONSENT.md`, "Changes from Workspace Phase 4".
- **Measurements:** `docs/research/CANVAS-AI.md`.

## What was built

**Slice A: designs in the engagement** (WP0 to WP3; MVP story 9.1)

- **Two flaky tests fixed at their cause** (WP1, decision 23): a panel field selected its text a frame after focus even when something had been typed meanwhile (the keyboard-only accessibility test's width of 1); the settings test read a name other tests changed in parallel, and now runs on its own, after the rest.
- **Designs and their images in the company's folder** (WP2, decisions 2, 3, 6 and 8): `designs/<document id>.stylecode.json` in the editor's file format, images in `designs/assets/<content hash id>`. Saves run one at a time over their revision, through a temporary file, with the last good copy and a 50 MB limit. The server reads, saves and downloads only a design the client's saved workspace lists, creates files only, and never overwrites one. Deleting a design, an engagement or a client removes its files and the images no other design uses; unlisted files go after a day.
- **The editor on an engagement's design** (WP3, decisions 1, 2, 4, 5, 7 and 8): the Designs card (New design, Copy one of the editor's designs, Open, Rename, Delete); the second persistence adapter, autosaving through the workspace API with the editor's save status, retries, warning before closing and recovery screen; the routes `#/c/…/e/…/d/<design>[/l/<layer>]` and the top bar with **Back to the engagement**; a damaged design, and every design of a read-only client, listed with the reason and a **Download**.

**Slice B: the record beside the canvas** (WP4 to WP6; decisions 9 to 11)

- **Links in the design** (WP4): a layer's `findings` holds the ids of the findings it answers, as a new list kind in the property registry. Design file version 5; version 4 files open unchanged. Linking and unlinking are one undo step each; links survive a paste only into the design they came from, and are left out of the AI's properties, code export and the preview.
- **The Record panel** (WP5): beside the layers on an engagement's design, the engagement's findings in the record's four groups, with a filter, read-only, shown and hidden with Alt+R. **Link to the selected layers**; a selected layer's properties list its findings, with **Open in the record** and **Unlink**.
- **The other side** (WP6): on the record page each finding lists **In designs:** with a link to each layer, through a new route `#/c/…/e/…/record/f/<finding>`; a link to a finding no longer in the record says so, with **Remove link**.

**Slice C: the canvas AI with the record** (WP7 to WP12)

- **Consent and workspace version 6** (WP7, decisions 13, 14 and 22): the statement `aiDesign` in wording `draft-2` ("I may also use AI to help sketch the screens from what we agree. It sees my summary of what you said, not the recording or the transcript."), told on the form or recorded later by an amendment, not a new yes. Workspace version 6 migrates every consent record with `aiDesign` not told, and gives a company fact's source its engagement. `findingsForDesign` decides which confirmed findings the canvas AI may use (below).
- **The record in the canvas AI's context** (WP8, decisions 14 to 18): before every request, and again before the repair, the assistant reads the AI settings and asks the workspace for the findings it may use with exactly that AI. The findings come after the screen and notes, in what is left of the budget and at most a third of it: those linked to layers in scope first, then by kind, oldest first, statement and kind only, with "… N more findings not shown". The reply may cite them; the assistant shows **Drew on:** with a link to each, ignores ids it didn't offer, and says how many were left out and why. A request on a model on this computer takes the heavy slot behind a transcription or an extraction and lets a hot graphics card cool first, with **Stop** and **Don't wait**. The standalone editor is unchanged: no record, same requests, schema and timing.
- **The live check** (WP9 and WP10, decision 24): a runner and a launcher the user double-clicked (`spikes/canvas-ai/`), and `docs/research/CANVAS-AI.md` (below).
- **Docs** (WP11): the guide, ARCHITECTURE, DOMAIN-MODEL, CONSENT, MVP, the roadmap (Phase 4 ✅, with decision 19's place for the extraction questions), the README's status, tour and highlights, a new tour picture (`docs/media/canvas-ai-record.png`), and `docs/phase-5/NOTES-FOR-THE-BRIEF.md`.
- **Along the way:**
  - Canvas requests to Ollama send `think: false`, as extraction does (`5312b48`); without it the first live run stalled on all 16 requests.
  - A thinking model's reasoning counts as activity for the 2-minute stall timer, never as reply text (`6646f00`).
  - Adding a WAV and starting a recording make the client's `files/` folder before writing in it (`15cc235`), the cause of a 500 seen once in `retention.spec.ts`.

## The live check

On the user's laptop (Intel Core i7-12700H, 16 GB; RTX 3060 Laptop, 6 GB), with qwen3:4b in Ollama 0.40.16, `think: false`, in OMEN's Balanced mode, from `spikes/canvas-ai/start-live-check.cmd`. Eight requests on two role-played engagements, Harbour Bakery (20 confirmed findings) and Karoo Freight (18, two left out by consent), each made with and without the record. **The data is role-played, it is one run of 16 replies, and there is no pass mark.** Details: `docs/research/CANVAS-AI.md`.

- **First run (20 November 2026):** thinking was left on, and all 16 requests stalled at 120 s with no reply text. That is why canvas requests now send `think: false`.
- **Second run (21 November 2026):**
  - With the record, 3 of 8 replies became proposals; without it, 1 of 8. So the record didn't lower how often changes fitted, but few did: 4 of 16.
  - Every finding cited had been offered, and no reply named an id it wasn't given. 2 of the 3 proposals made with the record cited a finding the key marks as relevant.
  - 14 of 16 replies needed the repair attempt, which rescued 2. The 12 that still didn't fit failed on the design, not the record: layers not marked for change, new layers outside the marked ones, properties a rectangle doesn't have; as often without the record as with it.
  - Model time, median of eight: **41.6 s with the record, 32.9 s without**; longest 90.2 s and 144.0 s. (`results.json`'s own summary holds 44.9 s and 41.2 s, because the runner then took the upper middle time; the runner now averages the two.)
  - None was cut off for length, and the page logged no errors.

## Decisions made during Phase 4

The brief's decisions 1 to 24 were followed. These were made along the way, with the user or the reviewer:

1. **`think: false` on every canvas request to Ollama,** on engagement designs and in the standalone editor, after the first live run. On Ollama 0.40.16 it isn't refused for a model without thinking (Phase 5 notes).
2. **Reasoning is activity, not text:** the AI server relays a thinking model's reasoning as a marker the page counts against the stall timer and otherwise ignores.
3. **The repair attempt checks consent again** and stops if the findings it may use changed since the first request, rather than send findings the first check allowed.
4. **A finding resting on no session** (entered by the consultant without citing one) goes only to an AI on this computer; one resting on a deleted session is left out. This is POPIA question 6's second half.
5. **The canvas AI stays apart from the workspace:** `src/ai` receives the record through a `RecordSource` the workspace hands it (`src/workspace/ui/designs/canvasAi.ts`), as the editor receives the record panel's data through a React context.
6. **The tour keeps four pictures:** "Design with the record beside the canvas" and the canvas AI share `canvas-ai-record.png`.

## What the reviews found

Each slice had an independent review, and the whole phase one at the end, by a subagent that hadn't seen how it was built. Everything they found was fixed, each with a test.

- **Slice A:** clearing up could remove the images of a listed design that couldn't be parsed, left temporary files behind, and could report a successful save as failed; a company design didn't autosave when IndexedDB was unavailable; an image could be stored in a store other than the one it started in; races on opening and leaving; the `?` shortcut and the tab title on a design route; open-design checks compared the design but not the client.
- **Slice B:** the view jumped when the workspace changed; focus was lost when the Record panel hid; a page or a note could hold links; the panel re-rendered on every frame of a drag.
- **The whole phase** (eight findings):
  1. **A design still opening could take the place of another client's.** Opening design A, then client B's design before A's file arrived, let A load into the editor under B's route, B's Record panel and B's canvas AI: B's findings could have gone to the AI with A's design, or been linked into A's file. *Fixed:* an open is called off when the page that asked for it leaves or asks for another design, checked after the file is read and again after the last design's save, just before the editor changes design (`OpenCancelledError`). A browser test holds A's file back and checks the editor, the top bar and B's file.
  2. **The same race on the way to the editor's own designs** could show a client's design in the standalone editor, or leave "Closing the design…" on screen. *Fixed* by the same change, with a browser test.
  3. **Deleting a design could remove an image another design had just added** but not yet saved, so that design showed a placeholder after a reload. *Fixed:* an image uploaded since the deleted design was last saved is left for the day-old clear-up. Two server tests: such an image is kept, and an image the deleted design added itself still goes.
  4. **The heavy slot was decided on this tab's AI settings, the request sent on the settings read afresh,** so a switch to a local model in another tab could run without the slot or the cooling pause. *Fixed:* the settings are read before the turn, and again after it; if they changed while waiting, the turn is taken again for the new ones. Two unit tests.
  5. **The canvas AI's waiting, cooling and left-out states had no accessibility scan.** *Fixed:* each is scanned in `e2e/canvas-ai.spec.ts` ("Drew on:" already was).
  6. **With findings offered but none fitting the budget,** the context had a findings heading while the instructions and schema had none. *Fixed:* no findings section then; a unit test.
  7. **An import's images could go to a client's folder** if a company design finished opening during the import. Only possible through finding 1's race, so *fixed* by it.
  8. **A layer pasted from one client's design into another's, or into the editor's own, kept the id of an image that stayed behind,** so one design named another client's image (a content hash, not the image). *Fixed:* the pasted layer's image is cleared, within the paste's undo step, and shows a placeholder as before. The paste browser test checks the layer and the client's file.

  Found sound: decision 4's two rules on every other path (saves, switching designs, images, copying, menus, deletions, two tabs); decision 14's consent check, through `findingsForDesign`, its one caller, the request and the repair; and companies kept apart on the server (ids, listed designs, editable clients, clear-up per company) and in the page (routes, links, the record, paste).
  Not a new limit, and left as it is: consent changed in another window isn't seen until this tab reads the workspace again, as for extraction.

## Tests

At the end of Slice C, on Windows (the user's laptop), after the review's fixes:

- **Unit tests:** 912 passed, 1 skipped (a signal test that runs only on macOS and Linux), in 76 files. Slice A ended at 783, Slice B at 799. New in Phase 4: the design files and their clear-up on the server, the `findings` property and design file version 5, workspace version 6 and its migration, `findingsForDesign` for every consent case, the canvas AI's context, order, budget, schema, reply and assistant with and without a record, and the start-up list's reading.
- **Browser tests:** 210 of 210 with `CI=1` (no retries, flaky tests fail the run), in 5.6 minutes. Slice A ended at 183, Slice B at 198. New in Phase 4: `designs.spec.ts`, `record-links.spec.ts` and `canvas-ai.spec.ts` (in the heavy jobs project), with accessibility scans of the new screens and states, and the consent form's `draft-2` statement in `consent.spec.ts`.
- **One failure on the way, fixed at its cause:** the first full run after the review's fixes failed `retention.spec.ts:224` on both tries. "Recordings to deal with" read every client one after another before it showed anything, and with 151 clients in the test folder it took longer than the test waits. The list now reads six clients at a time (`src/workspace/ui/PastTimeCard.tsx`, with `PastTimeCard.test.ts`); the full run after the fix passed (so did one before it, by chance). The failed run's trace was overwritten, so the cause is inferred, not measured (Phase 5 notes, "Flakes to watch").
- **Type-check, format, the README check, the token check, the notices and the hygiene check** are clean.

No test touches the network or a real model: the AI is `e2e/fakeOllama.ts` and the README's pictures use a scripted stand-in model. The live check is the only run against qwen3:4b, and it isn't part of CI.

## Known limitations

- **The canvas AI's changes rarely fit these designs:** 4 of 16 in the live check, with or without the record. The model's grip on the design's structure is the limit, not the record (`CANVAS-AI.md`; Phase 5 notes list what to measure).
- **`think: false` goes to every Ollama model,** thinking or not. Ollama 0.40.16 accepts it for a model without thinking; older releases weren't checked.
- **A standalone canvas request on a local model doesn't take the heavy slot** (decision 18), so it can compete with a transcription or an extraction for the GPU.
- **AI requests aren't checked for consent again on the server.** The page checks before every request and the repair; the servers check again only before storing a recording or an added WAV and starting a transcription, and every save is refused if it holds what consent didn't allow.
- **POPIA question 6 is open:** whether telling the client about `aiDesign` is enough without its own yes, and whether findings resting on no session may go to an AI on this computer.
- **Real client use still waits for the POPIA review** of wordings `draft-1` and `draft-2`.
- **The hygiene check's email pattern can match an image's compressed bytes** by chance; worked around once by moving a demo's camera (Phase 5 notes).
- **Designs and their links aren't in the Markdown export** (decision 12); they come with the full specification export of Phase 7.

## What Workspace Phase 5 starts with

Phase 5 in `docs/ROADMAP.md`. Its notes are in `docs/phase-5/NOTES-FOR-THE-BRIEF.md`:
- creating a client reads every client's file;
- the dev server that stopped once;
- whether a standalone canvas request should take the heavy slot;
- the canvas AI's fit rate, and what to measure for it (thinking on, a bigger model, a simpler schema or prompt), each against the live check's requests, more than once;
- whether to gate `think` on the model's capability, or state the oldest Ollama supported;
- the hygiene check scanning only an image's text chunks;
- the flakes to watch.

The three extraction questions from Phase 3 wait for the first phase that changes extraction, or a short measurement slice before real client use (decision 19, in the roadmap). Any measurement that needs a long run on the laptop starts from a launcher the user double-clicks.
