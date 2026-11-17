# Workspace Phase 3: handover

Workspace Phase 3, "Capture", is built. A consultant can record a meeting in the room, in the browser, with Stop one key away on every page, or add a WAV made elsewhere. With an NVIDIA graphics card, StyleCode transcribes the recordings on the computer, with who spoke when and the words it may have misheard marked, and nothing is sent anywhere. Recordings are kept only as long as the client agreed: "deleted after transcription" is kept by the step that adds the transcript, recordings past their time are listed each time StyleCode opens until they're gone, and every deletion leaves a line in the record. What Phase 2 left is done too: company knowledge in the export, facts entered directly, and times in the session's zone.

- **Brief:** `docs/phase-3/PHASE-3-BRIEF.md`
- **Pull requests:**
  - Slice A, the transcription test: #20.
  - Slice B, recording and transcription: #21.
  - Slice C, retention, what Phase 2 left, the docs and this handover: this one.
- **How to use it:** the guide's [Setting up transcription](../GUIDE.md#setting-up-transcription), [Recording a meeting](../GUIDE.md#recording-a-meeting), [Transcribing](../GUIDE.md#transcribing), [How long recordings are kept](../GUIDE.md#how-long-recordings-are-kept), [Company knowledge](../GUIDE.md#company-knowledge) and [Times](../GUIDE.md#times).
- **How it works:** `docs/ARCHITECTURE.md` §12, "Recording, transcription and retention".
- **Measurements:** `docs/research/TRANSCRIPTION.md`.

## What was built

**Slice A: the transcription test** (WP0 to WP3)

- **The test meetings as synthetic speech** (WP1, decisions 1 to 4; `eval/audio/`): Karoo Freight, Veldt Vets, Umoya School and a new hour-long role-play, Bosveld Citrus (10,573 words, five speakers, one not asked, its answer key checked by an independent subagent), spoken by Kokoro v1.0 voices through sherpa-onnx 1.13.8, one voice per speaker, clean and hard mixes with exact timelines. The timelines are in git; the audio isn't.
- **The harness** (WP2; `spikes/transcription/`, `eval/transcription/`): pinned, hashed setup for whisper.cpp, Parakeet and sherpa-onnx's speakers; readers for each engine's output and the word-and-speaker combining in `src/workspace/transcription/`, shared with the app; a scorer for words, key terms, speakers and the downstream extraction, with a recorded run scored in CI.
- **The measurements** (WP3), on the user's laptop, from a launcher the user double-clicked, written up in `docs/research/TRANSCRIPTION.md` with every run record in git.

**Slice B: recording and transcription** (WP4 to WP8)

- **Workspace version 4** (WP4): recordings, transcripts made from them (naming the recordings by start and length, so they stay readable once deleted), unsure words below 0.8, the deleted recordings' lines, C11 for recordings, with a migration from version 3.
- **The server** (WP5): recordings written piece by piece at their offset and flushed, finished with their header, recovered after a crash; WAVs converted as they stream in; `npm run transcription:setup`, pinned and hashed with each licence; transcription jobs in the server, one heavy job at a time, with estimates from this computer's past speeds.
- **Recording** (WP6): the microphone and its level, the first-time lock confirmation, the recording on every page with Stop (Alt+S from anywhere), several recordings per session, "Not being saved" when pieces fail, and a warning when the microphone hears nothing.
- **Transcribing** (WP7): Transcribe… with the estimate and decision 18's options, progress and Cancel, the preview with speakers sorted by talk time and short labels grouped, "may be misheard", Play from here, and the C11 warning that follows the matching.
- **End to end on the laptop** (WP8): a role-play played aloud and recorded through the laptop's microphone, and an hour through the app (results below).

**Slice C: retention and what Phase 2 left** (WP9 to WP12, and three changes after WP8)

- **After WP8:**
  - `TRANSCRIPTION.md` corrected: the first try's AI stop was Windows hibernating the laptop for heat (Kernel-Power event 88), and the second try ran in OMEN's Balanced mode.
  - **A cooling pause** (decision 10, extended): before a transcription and before each part of an AI run on a local model, a GPU at 87 °C or more is left to cool under 75 °C, holding the heavy slot; the run says so, its time left doesn't run down, and Don't wait overrules it.
  - **A stopped run keeps its finished parts** unless a deletion or consent stopped it, reopening a closed client from disk, and the session keeps why it stopped (`aiStop`, **workspace version 5**).
- **Retention** (WP9, decisions 22 to 25): each recording says how long it is kept, or why its time is up, or that it is waiting for its transcript; **Recordings to deal with** on the clients list at start-up, with one action that deletes those past their time; the deleted recordings' lines in the session and the export; after a withdrawal, the offer to delete the recordings first, then the transcript; the same offer after an amendment that leaves recordings past their time.
- **Carried over** (WP10, decisions 27 to 29): the export's "Company knowledge" section; Add a fact… on the client's page; a session's times in its own zone, with the offset when it differs from the computer's.
- **Docs** (WP11): the guide, ARCHITECTURE §12, DOMAIN-MODEL, CONSENT ("Changes from Workspace Phase 3"), MVP, the roadmap (Phase 3 ✅), the README, and `docs/phase-4/NOTES-FOR-THE-BRIEF.md`.

## The measurements

All on the user's laptop (Intel Core i7-12700H, 16 GB; RTX 3060 Laptop, 6 GB), with synthetic speech, so every number is a lower bound on errors. Details and sources: `docs/research/TRANSCRIPTION.md`.

- **Chosen setup:** whisper.cpp large-v3-turbo (5-bit) on the GPU with `--max-context 0`, and sherpa-onnx's diarization with ERes2Net at 0.7. 1.7 minutes per hour of audio for the words, 2.3% word errors on clean audio and 2.5% on hard, 94.4% of words to the right speaker (TRANSCRIPTION.md, Follow-up measurements); extraction on its transcripts kept recall within decision 8's 10 points of the typed transcripts' (measured before `--max-context 0`).
- **Recorded in the room** (WP8): played through the laptop's speaker and recorded by its microphone, the words came through unchanged (1.2% errors, as the clean file), and words to the right speaker went from 95.9% to 94.4%.
- **An hour through the app** (WP8): 16.2 minutes from Transcribe to the transcript added (Whisper 3.6, speakers 12.5), and 20.9 more to the AI's proposals with qwen3:4b: **37 minutes**, in OMEN's Balanced mode, which held the GPU at about 30 W. WP3 expected about 32 in performance mode. The recording was gone in the same save that added the transcript.
- **Heat:** one AI run alone, in performance mode, took the GPU to 95 °C and Windows hibernated the laptop. Balanced kept it at 74 to 84 °C. The cooling pause stops the next step starting hot; it can't stop heat building within one long part.

## Decisions made during Phase 3

The brief's decisions 1 to 31 were followed, as changed at the WP3 check-ins (`TRANSCRIPTION.md`, "Decided at the check-in" and "After the follow-up measurements"). These were made along the way, with the user or the reviewer:

1. **One engine:** whisper.cpp's CUDA build. Without an NVIDIA GPU it can use, Transcribe isn't offered and the session says why. Parakeet on the CPU is a later item in the roadmap.
2. **Words are marked, not segments** ("may be misheard" on words below 0.8), and **`--max-context 0`** with no VAD.
3. **Short speaker labels are grouped, never hidden:** sorted by talk time, under 30 s in one collapsed group, each matchable by reading its words or from any of its segments.
4. **A cooling pause before heavy steps** (decision 10, extended after WP8), at 87 °C, until under 75 °C; with no reading, nothing waits. The user can overrule it in the run.
5. **A run that stops for an unknown reason keeps its finished parts,** added in one undoable step with the same checks, and the reason is kept on the session, which needed **workspace version 5**. A stop by a deletion or consent adds nothing.
6. **Waiting rows on the start-up list link to the session** (decision 22 put Transcribe and Delete on them); accepted at the WP9 check-in.
7. **An engagement's export lists only facts traceable to it,** through the finding or, once deleted, its sessions. A fact with neither left is left out rather than risk another engagement's knowledge.
8. **The export's company facts carry no times,** because a fact belongs to no session and decision 18 keeps UTC out of the file.
9. **Times on screen in the session's zone** apply to everything belonging to a session: its page, notes, recordings, transcript, consent record, the AI's stop, quoted notes and the engagement's list of sessions.
10. **The retention browser tests run last** (a Playwright project after the others), because "delete them all" covers every client in the test folder.

## What the reviews found

Each slice had an independent review, and the whole phase one at the end, by a subagent that hadn't seen how it was built. Everything they found was fixed, except one item accepted as it is.

- **Slice A:** the Whisper reader could end a word before it started and counted notes on sounds ("[no audio]") as speech; several statements in `TRANSCRIPTION.md` said more or less than the run records.
- **Slice B:** a transcription's working copy of the sound could outlive "deleted after transcription" (now deleted before the job says it has ended, and the job fails rather than offer its result if it can't be); a job whose transcript could no longer be added (session deleted, consent withdrawn, a recording deleted) wasn't cancelled; deleting a client didn't wait for its jobs; an added WAV was stored before consent was checked; a recovery refused because the file was just written wasn't tried again.
- **The whole phase:**
  - withdrawing consent while recording didn't offer to delete the recording, because the offer was decided before the withdrawal stopped it (now decided after, with the assertion added to the recording test);
  - the start-up list's delete action stopped at a client that opens read-only, leaving the list stale, and one damaged client could hide the whole list (read-only clients are now listed but left alone, each client is listed and deleted on its own, and only what is still past its time is deleted; with a browser test);
  - the session's Starts field showed the session's time but edited the computer's (both are now on the session's clock, with tests), and the consent attachment's time wasn't in the session's zone;
  - the export's company facts could call a deleted finding "a finding of this engagement".
- **Accepted as it is:** the start-up list's rows waiting for a transcript link to the session rather than carrying Transcribe and Delete themselves (decision 6 above).

## Tests

At the end of Slice C, on Windows:

- **Unit tests:** 765 passed, 1 skipped (a signal test that runs only on macOS and Linux), in 64 files. They include the readers of every engine's output, combining words and speakers, the resampler and WAV conversion, retention, the cooling pause, a recorded transcription run scored as in CI, and the export's snapshot.
- **Browser tests:** 171 passed, with 4 workers. With the default number of workers, the laptop's load made one long test time out at 30 s in some full runs (a different one each time, each passing on its own); CI's runs are the check. New in Phase 3: `recording.spec.ts`, `recording-silent.spec.ts`, `transcription.spec.ts`, `retention.spec.ts` (run after the others) and `times.spec.ts`, with accessibility scans of the new screens.
- **Checked as CI sees it:** the browser suite was also run with the browser in UTC, as CI's Linux runs it, since session times now carry an offset when the zones differ.
- **Type-check and format** are clean.

No test touches the network, a real engine, a real model or a real voice: transcription uses the fake engine (`server/transcription/fake/`), recording a fake microphone playing a generated tone, the GPU's temperature a file, and the AI `e2e/fakeOllama.ts`.

## Known limitations

- **Real speech is untested.** Every number comes from synthetic voices: no South African accents or code-switching, little crosstalk, no real hesitations, and only one real room (WP8's, with the laptop's own speaker). The first real meetings are the real test.
- **One engine, on Windows with an NVIDIA GPU.** Other computers can record and import transcripts, but not transcribe.
- **Meetings in the room only.** Online meetings come in through the platform's transcript.
- **WAV only** for added recordings.
- **Many speaker labels on long meetings** (34 for five people in the clean hour), most under 30 s, grouped but still work to match.
- **Heat on the user's laptop:** an hour's AI run in performance mode can make Windows hibernate it; Balanced is cooler and slower.
- **Decision 8's downstream check for `--max-context 0` isn't measured,** and 18 of 127 raw proposals failed the quote check on WP8's transcript (Phase 4 notes, questions 1 and 2).
- **The consent wording is still `draft-1`.** Real client use waits for the POPIA review.
- **The demo GIFs** still show the editor before the workspace.

## What Workspace Phase 4 starts with

The canvas in context: the StyleCode editor in each engagement, informed by the record (ADR-0007). The questions it inherits are in `docs/phase-4/NOTES-FOR-THE-BRIEF.md`: the extraction questions from `TRANSCRIPTION.md` (decision 8's downstream check, the quote check's 18 of 127, the part size), and the laptop's heat (Balanced mode, and whether the cooling pause is enough). None of them needs to block Phase 4, and any that needs a long run on the laptop starts from a launcher the user double-clicks.
