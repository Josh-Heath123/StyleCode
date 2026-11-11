# Workspace Phase 2: handover

Workspace Phase 2, "Extraction", is built. A consultant can import the transcript Teams, Zoom or Google Meet made, or paste one, and say which speaker is which participant. They can ask a local AI (or the provider the client agreed to) for findings, and review every proposal beside its highlighted passage, keeping only what they checked. What is learned about a client carries into its next engagement as company knowledge, and the export writes each meeting in its own local time.

- **Brief:** `docs/phase-2/PHASE-2-BRIEF.md`
- **Pull requests:**
  - Slice A, transcripts and consent after an import: #15 and #16.
  - Slice B, extraction and review: #17.
  - A fix outside the phase, for a flaky editor test that was a real focus bug: #18.
  - Slice C, company knowledge, the export, the docs and this handover: this one.
- **How to use it:** the guide's [Transcripts](../GUIDE.md#transcripts), [Asking the AI for findings](../GUIDE.md#asking-the-ai-for-findings), [Reviewing proposals](../GUIDE.md#reviewing-proposals), [Company knowledge](../GUIDE.md#company-knowledge) and [Consent after an import](../GUIDE.md#consent-after-an-import).
- **How it works:** `docs/ARCHITECTURE.md` §12, "Transcripts, extraction and company knowledge".
- **Measurements:** `docs/research/EXTRACTION.md`.

## What was built

**Slice A: transcripts** (WP0 to WP4)

- **Workspace version 2** (WP1): sessions keep their IANA time zone, transcripts can come from `.txt`, with a migration from version 1. The model functions `importTranscript`, `replaceTranscript`, `deleteTranscript`, `matchSpeaker`, `removeFinding`, provenance derived from evidence (decision 9), the retention check on amendments (decision 10) and the consent attachment (decision 12).
- **Reading transcripts** (WP2, `src/workspace/import/`): one pure reader per layout for all nine sample layouts (Teams `.vtt` from the pane and from Graph, Teams `.docx` current and older, Zoom `.vtt` and `.txt`, Google Meet `.docx` and `.txt`, "Notes by Gemini" with only its transcript, and pasted text). Encodings, line endings, voice spans with classes and entities, Teams parts joined by utterance id. `.docx` is read with `DecompressionStream` and `DOMParser`, with no new dependency. Every sample is tested against `meeting.json`.
- **Importing and speakers** (WP3): blocked without consent to transcription (C1), a preview with the platform (correctable), segments, speakers and the C11 warning; the transcript by speaker; matching speakers; replace and delete; findings quoting transcript segments; evidence links that land on the passage.
- **Consent after an import** (WP4): Amend… on a locked record, the withdrawal flow (offer to delete the transcript, then review what keeps a statement), and the consent attachment.

**Slice B: extraction** (WP5 to WP7)

- **The evaluation set** (WP5, `eval/`): three role-played consultations (Karoo Freight from the samples, Veldt Vets as a Zoom export, Umoya School as a Google Meet export) with answer keys checked by an independent subagent; the scorer (invented evidence, precision, recall, unclear pairs settled in CSV); a recorded run checked in CI.
- **Extraction** (WP6): the prompt and a schema built from the domain types, parts of at most 6144 tokens, every proposal checked before it is shown, and repeats left out (decisions 7 and 8). Requests go through `/api/ai/chat` and name the provider, address and model; consent is checked again before every part (C5, C6).
- **Measured on the user's laptop** (i7-12700H, 16 GB, RTX 3060 Laptop 6 GB, Ollama 0.40.16). The default is **qwen3:4b with thinking off**:

  | Model | Precision | Recall | Invented evidence | Minutes per hour of meeting |
  | --- | --: | --: | --: | --: |
  | qwen3:4b, parts of 6144 | 98% | 69% | 2% | 25 |
  | qwen3:4b, 6144, performance mode | 98% | 63% | 0% | 9 |
  | qwen3:8b | 90% | 56% | 10% | 41 |
  | gemma3:4b | 77% | 46% | 15% | 18 |

  Thinking on takes longer than the meeting. Invented evidence is what the checks catch; none of it is ever shown.
- **Review** (WP7): proposals beside the transcript and notes, the selected one's passages highlighted, accept (with the status chosen), edit or reject from the keyboard, each undoable; "(your side)" on the consultant's own words; the evaluation report per session; the note link (decision 14). At the user's request: runs carry on while the consultant works elsewhere, the page warns before closing during a run, a stopped or failed run keeps the proposals from the parts it finished and says which ("parts 1 to 4 of 7") until they are reviewed or discarded, and a time estimate is shown before a run.

**Slice C: company knowledge** (WP8 to WP11)

- **Company knowledge** (WP8): promote a finding from the record ("Add to company knowledge…"); the client's page lists its facts with kind, status, provenance, source or "source deleted", and quotes; every engagement of that client shows them, and no other client's; change and remove, each undoable. Facts have a status, copied when promoted (decision 17), which makes the workspace **version 3**. Deleting a finding from the record (decision 15) is now offered in the interface.
- **Export** (WP9): transcript quotes name the speaker (the matched participant, or the label) and the session; each session's times are written in its own zone with the offset, for example `2026-11-05 10:00 (GMT+2)` (decision 18). The snapshot is updated, and the file is still the same every time.
- **Docs** (WP10): the guide, ARCHITECTURE §12, DOMAIN-MODEL, CONSENT, MVP Q7, the roadmap (Phase 2 ✅) and the README; `docs/phase-3/NOTES-FOR-THE-BRIEF.md`.

## Decisions made during Phase 2

The brief's decisions 1 to 20 were followed. These were made along the way, with the user or the reviewer:

1. **qwen3:4b, thinking off, is the default model** (WP6 check-in), with parts sized for about 6144 tokens whatever the context setting, never more than it allows.
2. **An ellipsis at either end of a quote is removed before the check**, and the quote stored without it; one inside a quote still fails.
3. **A stopped or failed run keeps what it finished.** This replaces the brief's "a run can be cancelled, and then nothing is saved". The coverage ("parts 1 to 4 of 7") is kept in the browser's storage, ids and counts only, until those proposals are reviewed or discarded.
4. **Only the selected proposal shows its actions**, and the run's summary stays in sight (WP7 check-in).
5. **Repeats aren't failures:** the summary says "Left out" for repeats and passages changed during a run, and "failed StyleCode's checks" only for invented or unreadable evidence.
6. **Workspace version 3 for the fact status** (WP8). Version 2 had been saved on the user's computer by then, so the status needed a migration: a version 2 fact takes its source finding's status, or "suggested" if the finding is gone, so it never claims agreement it didn't have.
7. **A finding is promoted once** while its fact exists, so the same statement isn't listed twice.
8. **Check-in screenshots go in `.checkins/`**, which git ignores.

## What the reviews found

An independent subagent reviewed each slice and then the whole phase. Everything it found was fixed.

- **Slice A:** facts couldn't be traced to their session after a transcript was deleted (they now keep the session ids); retention told against the last words; Teams utterances across runs; Zoom times after midnight; clocks going back; Replace… shown only when allowed; amending, withdrawing and attaching rolled back on a failed save; a size limit on `.docx` entries.
- **Slice B:** a run didn't stop when its client was deleted or reloaded, or when consent was withdrawn mid-part; an error could be hidden; a run could stay "running"; a second partial run hid the first one's coverage; passages edited during a run were counted as invented; double presses; a wrong explanation in EXTRACTION.md.
- **The whole phase:** company facts in the review after a withdrawal could only be removed, not edited (now linked to the client's page); a damaged fact, opened read-only, crashed the client's and engagements' pages (now guarded, with a browser test); `updateFact` could clear a kind or status given as undefined; focus was lost after Delete and Remove (it now moves to the next item, or to Undo); the promote dialog promised quotes a finding didn't have; a read-only engagement offered to change facts; no accessibility scan of the record after promoting; and three doc sentences that said more than the code does.

Separately, the user's reviewer found `e2e/editor.spec.ts` "edits properties from the panel as single undo steps" failing about 1 run in 5. It was a real bug: a panel field selected its text one frame after getting focus, and in Chromium `select()` also focuses, so Enter pressed before that frame left the field focused and the next Ctrl+Z went to it. Fixed in #18, with a test that delays the frame.

## Tests

At the end of Slice C, on Windows:

- **Unit tests:** 598 passed, 1 skipped (a signal test that runs only on macOS and Linux), in 48 files. They include every sample layout against `meeting.json`, the scorer and a recorded evaluation run.
- **Browser tests:** 132 passed, including `transcripts.spec.ts`, `consent-after-import.spec.ts`, `extraction.spec.ts` (24 tests, with the fake Ollama in `e2e/fakeOllama.ts`), `knowledge.spec.ts` and the accessibility scans.
- **Type-check and format** are clean. CI runs the same on Linux, and type-check, unit tests and build on Windows.

No test touches the network or a real model: the AI in tests is `e2e/fakeOllama.ts` and recorded replies.

## Known limitations

- **Recall is about two thirds.** The AI is a first pass; the consultant still reads the transcript. The statement the AI writes isn't checked against its quote, only the quote against the transcript.
- **The measurements rest on three short role-plays** (5 to 15 minutes). An hour-long meeting takes 6 to 7 parts and somewhat longer than these suggest. The laptop's GPU is held back by heat after the first minute.
- **The sample layouts are reconstructions** from published sources (decision 1). A real export may differ; the process for that is in `docs/phase-2/samples/README.md`.
- **Google Meet gives a time only every few minutes**, so most of its segments have no time.
- **The consent wording is still `draft-1`.** Real client use, and especially external AI, waits for the POPIA review.
- **Company facts come only from findings.** The model allows a fact entered directly, but there is no interface for it. The export doesn't include company knowledge.
- **The demo GIFs** still show the editor before the workspace.

## What Workspace Phase 3 starts with

Capture: recording in the browser, local transcription with speakers, and audio retention (C10). It opens with the transcription test (old WP6). The questions it inherits are in `docs/phase-3/NOTES-FOR-THE-BRIEF.md`, first among them where the test audio comes from: the user won't have time to record role-plays, and synthetic speech with several voices, made on the computer, is the option to weigh, with what it can't show (real accents, crosstalk and room noise).
