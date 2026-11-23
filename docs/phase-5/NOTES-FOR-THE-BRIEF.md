# Notes for the Workspace Phase 5 brief

Started on 19 November 2026, during the repository follow-ups (pull request #27), and added to by Phase 4's Slice C docs work. These are questions the Phase 5 brief inherits. None of them is decided; each needs the user, or the reviewer on the user's behalf.

## Creating a client reads every client's file

`WorkspaceStore.create` (`server/workspace/store.ts`) refuses a name another client already has, ignoring case (MVP Q4). To know the names, it lists every client: it reads and fully validates each client's `workspace.json`. And it does so inside one queue shared by every create, so creates run one at a time, each waiting for the ones before it.

Measured on the laptop (Windows), 19 November 2026:
- **The test folder:** after a full local browser-test run it held 134 clients, 714 KB of `workspace.json` in all (the largest 38 KB).
- **One listing:** with the laptop otherwise idle, listing those 134 clients took 158 ms, then 128 and 109 ms (three runs, from a Node script calling `list()`).
- **Under load:** during a full local run, with the browser workers creating clients at once (and other work on the laptop at the same time), one create took 4,775 ms (the server's wait, from the trace). In a second run, with nothing else running, a create hadn't answered when `workspace.spec.ts:20` gave up at 7.7 s.
- **What fails:** `workspace.spec.ts:20` ("StyleCode opens on the clients list, and a new client opens on its own page") expects the new client's page within 5 s of Add client. It failed in two of the three full local runs on 19 November. It passes on CI, where each runner's folder holds fewer clients.

A consultant with tens of clients won't notice. The browser tests create hundreds in one folder, and a consultant who keeps a client folder for every engagement over years would hold hundreds too.

*Options, for the brief:* keep the names in memory, read once and updated by each create, rename and delete in the same queue; or read only each file's company name, not the whole file. Either keeps the case-insensitive check as it is. No product code changed for it yet.

## The dev server that stopped once

During one local full run on 19 November, the browser tests' dev server stopped answering at 14:41:06 (local time) for the rest of the run: every request after one `/api/ai/chat` was refused, on both `::1` and `127.0.0.1`. Its output (Playwright's `[WebServer]` lines, stderr only then) shows no error and no stack.

- **What it wasn't:** rewriting the files edited at that moment, against a second dev server, changed nothing. It didn't happen in the two quiet full runs that followed.
- **What could stop it without a word:** the data folder lock's signal handlers (`server/workspace/folder.ts`) release the lock and call `process.exit` on SIGINT, SIGTERM, SIGHUP or SIGBREAK, and print nothing. Whether a console event reached it is unknown.
- *If it happens again:* CI now keeps the dev server's stdout in the log (pull request #27); a local run can show it with `DEBUG=pw:webserver`. A line from those handlers saying which signal arrived would answer it.


## A standalone canvas request doesn't take the heavy slot

On an engagement's design, a canvas request on a model on this computer takes the heavy slot and waits for a hot graphics card to cool (Phase 4, decision 17). The standalone editor's requests don't (decision 18 keeps its behaviour as it was). So a standalone request on a local model can run at the same time as a transcription or an extraction run, and the two compete for the GPU, which Phase 3 measured at 5.6 times slower transcription and 83% slower extraction (`docs/research/TRANSCRIPTION.md`, "Recommendation"). *For the brief:* whether the standalone editor's local requests should take the slot too, now that the slot and the cooling pause have a place in the assistant (`RecordSource.takeTurn`).

## The canvas AI's changes rarely fit these designs

Phase 4's live check (`docs/research/CANVAS-AI.md`, 21 November 2026, qwen3:4b with `think: false`, role-played, one run): changes fitted the design in 4 of 16 requests, 3 of 8 with the record and 1 of 8 without. The repair attempt was asked for in 14 and rescued 2. The 12 that still didn't fit broke three of the design's rules, as often without the record as with it:
- changed a layer that wasn't marked as changeable (5 replies);
- put a new layer somewhere other than inside or next to a marked layer (6);
- set a property a rectangle doesn't have: `text`, `textResize`, padding, mobile text settings (4).

So the limit is the model's grip on the design, not the record. *For the brief, each to be measured, not assumed:*
- **Thinking on.** It no longer stalls since `6646f00` (reasoning counts as activity), but it is slower, and in Phase 2 qwen3:4b with thinking spent its whole reply limit reasoning (`EXTRACTION.md`). It may help with the structure rules above.
- **A bigger model.** qwen3:8b doesn't fit in the laptop's 6 GB GPU with its context (`EXTRACTION.md`), so it would be slower; a hosted model would need the client's consent to that provider.
- **A simpler schema or prompt.** For example, saying which layer types take which properties next to each marked layer, listing the marked ids again at the end, or a worked example of adding a layer next to the selection.

A re-run of the live check (`spikes/canvas-ai/start-live-check.cmd`) against each change would show which helps, on the same requests. One run of 16 is noisy, so more than one run per setting.

## `think: false` goes to every Ollama model

Canvas requests (Phase 4, after the live check's first run, `docs/research/CANVAS-AI.md`) and extraction both send `think: false` to whatever Ollama model is chosen, thinking or not. People report Ollama refusing requests with "… does not support thinking". Checked on 21 November 2026 whether `false` alone causes that:
- **On this laptop's Ollama (0.40.16) it doesn't.** Phase 2's gemma3:4b extraction runs (11 November 2026, `eval/runs/gemma3-4b/`, each recording `"think": false`) sent `false` to a model with no thinking capability through the AI server's Ollama adapter, and all three got their replies.
- **Ollama's code refuses only `true`.** In `server/routes.go` on Ollama's main branch (read 21 November 2026, <https://raw.githubusercontent.com/ollama/ollama/main/server/routes.go>), the generate handler refuses a model without thinking only `if req.Think != nil && req.Think.Bool()`. The chat handler's check wasn't read word for word.
- **The reports look like `true`.** In the ones found (for example <https://github.com/continuedev/continue/issues/11265>, <https://github.com/musistudio/claude-code-router/issues/1046>), the tool asked for thinking, or by its users' account kept asking after a setting turned it off. None showed the request body.
- *Not verified:* releases older than 0.40.16. Whether an early release with `think` (it arrived in 0.9.0, May 2025) refused `false` wasn't found.

So no code changed: gating `think` on `/api/show` listing the `thinking` capability isn't needed for the Ollama in use. *For the brief:* whether to gate it anyway, for consultants on older Ollama releases, or instead to state the oldest Ollama StyleCode supports.

## The hygiene check reads compressed image bytes as text

`scripts/hygiene.ts` looks for email addresses in a binary file's whole content (ASCII only, `ASCII_EMAIL`). In Phase 4's WP11 that matched random bytes in `docs/media/canvas-ai-record.png`'s compressed image data (`Q…@sm.Oo`): a false alarm, worked around by moving the demo's camera 4 px (`e2e/demos/workspace.demo.ts`, `cd55055`) so the bytes came out differently. Any re-recorded picture can hit it again, by chance. *For the brief:* in images, scan only the chunks that hold text for addresses (PNG's `tEXt`, `iTXt` and `zTXt`, the last two decompressed where compressed, and `eXIf`; their equivalents in JPEG and GIF), not the pixel data, without weakening the check for text files. Each part needs a test: an address in each text chunk is still refused, and the bytes that matched in WP11 pass.

## Flakes to watch

Seen once each, not yet explained. None is retried or skipped; each fails its run if it comes back.

- **`e2e/retention.spec.ts:224`, a 500 adding a WAV (20 November 2026, a local Windows run of presentation WP7). The gap it showed is fixed.** "A read-only client's recording past its time is listed, but left alone by the delete action" failed in `withRecordings` (`retention.spec.ts:56`): `POST …/added-recordings` answered 500 instead of 201, for a client created moments before. The server's log showed `ENOENT: no such file or directory, open '…\companies\co_…\files\fi_….tmp'`. `RecordingFiles.addWav` opened its temporary file with `wx` without making `files/` first, unlike `WorkspaceStore.addFile`, and `RecordingFiles.start` had the same gap. *Fixed on `workspace-4c-ai-context`:* both make `files/` (never recursively) before opening, and a unit test removes `files/` and adds a WAV and starts a recording (`server/workspace/recordings.test.ts`); without the fix it fails with that same ENOENT. *Still open:* `files/` is made when a client is created (`server/workspace/store.ts:263`), so why it was missing in that run is unknown; a client folder put back from a copy that leaves out empty folders is one way it happens. *If a 500 like it comes back:* list the company folder at the moment of failure.
- **A unit test, name not recorded (20 November 2026, presentation WP7).** One `npm test` run reported 1 failed of 863, during work on `scripts/readme.ts`; the run's output wasn't kept, so which test is unknown. Ten runs of `npx vitest run` in a row afterwards (on `workspace-4c-ai-context`, from `e9a26b2`) all passed, 862 with 1 skipped. *If it comes back:* keep the whole output, and note what else the laptop was running.
