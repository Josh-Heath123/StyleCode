# Workspace Phase 3: Capture

> **For Claude Code.** Read these first:
> - `CLAUDE.md`;
> - `docs/phase-2/HANDOVER.md` and `docs/phase-3/NOTES-FOR-THE-BRIEF.md`;
> - `docs/spec/CONSENT.md` (C1, C4, C8, C10, C11 and decision 4), `docs/spec/MVP.md` and `docs/spec/DOMAIN-MODEL.md`;
> - "Old WP6" at the end of `docs/phase-0/PHASE-0-BRIEF.md`;
> - `docs/ARCHITECTURE.md` §12, `docs/research/EXTRACTION.md` and `eval/README.md`.
>
> Phase 3 is built in three slices, each on its own branch with its own pull request. At every **⏸ Check-in**, stop, report and wait.

## Goal

At the end of Phase 3, the consultant can:
- record a meeting in the room with StyleCode, once the client has agreed to recording, and stop whenever the client asks;
- have it transcribed on this computer, with who spoke when, and nothing sent elsewhere;
- match the speakers to participants and go on to the AI's proposals, as with an imported transcript;
- rely on the recording being kept only as long as the client was told: deleted in the same step that adds the transcript when that was the promise, and listed for deletion when its time is up.

Phase 3 is "Workspace Phase 3: Capture" in `docs/ROADMAP.md`. It opens with the transcription test (old WP6). Its acceptance criteria are the roadmap's, with the changes below.

## How decisions were made for this phase

The user asked the reviewer (Claude, in the planning Project) to settle what it could, because they don't have time for check-ins on detail. The decisions below are the reviewer's, made on the user's behalf on 2026-11-11, each following the specs, the roadmap and `docs/phase-3/NOTES-FOR-THE-BRIEF.md`. The reviewer researched the engines, voices and licences on 2026-11-11; the sources are at the end. Check them again when you pin versions in WP2. Raise any decision that looks wrong at the WP0 check-in. After that, don't reopen them, except where a decision says the WP3 measurements settle it.

**Check-ins in this phase are short:** screenshots, numbers and a recommendation. The user may pass a check-in to the reviewer and paste back its answer. Treat that answer as the user's.

## Decisions made for this phase

### Test audio

1. **The test meetings are synthetic speech, made on this computer.** This replaces old WP6's "the user provides it": the user won't record role-plays. Every typed role-play in the evaluation set (Karoo Freight, Veldt Vets, Umoya School, and the hour-long one of decision 4) becomes audio with one synthetic voice per speaker. The script and the speaker turns are then known exactly, so word errors and speaker attribution are measured with no hand correction.

   **Wherever results appear, say plainly that they are a lower bound on errors.** Synthetic voices are cleaner and more distinct than people. They have no South African accents or code-switching, no talking over each other beyond what the mixer adds, no real hesitations, and no real room or laptop microphone (except in WP8). If the user later records a short real role-play (two people, five minutes), measure it too; nothing waits for it.

2. **The voices: Kokoro v1.0, run by sherpa-onnx.** Kokoro's weights are Apache-2.0, with 28 English voices in American and British accents, and sherpa-onnx (Apache-2.0) runs it from a Windows build, with no Python. sherpa-onnx is also the speaker candidate of decision 6, so one download serves both. Kokoro's package carries espeak-ng's data, which is GPL-3.0; it's used here only as a tool to make test audio, and none of it ships with StyleCode.
   - **Use sherpa-onnx 1.13.x for the voices** (v1.13.8, or the latest 1.13 release with a Windows build), not 2.x. sherpa-onnx 2.0.0 removed espeak-ng, and from then on Kokoro looks words up in its word list only and skips any word it doesn't find ("OOV word skipped"), which would silently drop most South African names from the audio while the reference keeps them. 1.13.x falls back to espeak-ng for those words. The speaker and Parakeet candidates use the current 2.x release. *(Added 2026-11-11, after WP0.)*
   - **Not Piper:** the maintained Piper moved to GPL-3.0 in 2025, and each Piper voice carries its own dataset's licence. Keep it as the fallback if Kokoro can't be made to work.
   - **Not the Windows voices:** there are few English ones, and their terms for making audio files weren't checked.
   - **One voice per speaker,** fixed in `eval/audio/voices.json`. Mix men and women and both accents. Give every meeting at least one pair of speakers of the same sex and accent, the hardest case for telling speakers apart.
   - **You can't listen to the voices,** so check them another way: after the first mix, transcribe each voice's turns with the best candidate. Replace a voice whose turns come back with more than 30% of words wrong, and record the swap.

3. **How a typed meeting becomes audio** (`eval/audio/`, TypeScript run by Node, no new dependency, with unit tests on the mixing and the timeline):
   - Each turn is spoken in its speaker's voice. The turns are placed in order with gaps of 0.3 to 1.2 seconds, seeded, so the result is the same every time.
   - **The output** is a 16 kHz mono 16-bit WAV, the format StyleCode records (decision 12), and a **timeline** (`<id>.timeline.json`) with each turn's speaker and exact start and end. The timeline is the reference for every measurement.
   - **Two versions of each meeting:**
     - *clean*;
     - *hard*: background noise about 15 dB below the speech, a short room echo, interjections ("Mm.", "Ja.") overlapping the turn before them by up to half a second where `eval/audio/<id>.json` marks them, and, in the hour-long meeting, two minutes with no speech and only the noise (someone fetching a document), to catch an engine writing words into silence.

     The noise and echo are generated by code, so there are no recorded noise files and no more licences to check.
   - **In git:** the scripts, `voices.json`, the per-meeting files and the timelines (role-played text and times, no sound).
   - **Never in git:** the audio. It goes to `eval/audio/out/`. `.gitignore` already ignores `*.wav`; add the folder too.

4. **An hour-long role-play,** written by you, as a fourth consultation in the evaluation set. Type it as a Teams `.vtt` export, as Karoo Freight is, so `npm run eval:build` reads it.
   - Long enough for about an hour of audio: roughly 8,500 words. Check the length after the first mix, and add or trim turns.
   - Another industry, four or five speakers, one of whom joins late and wasn't asked for consent.
   - Write real-sounding speech into it: false starts, "uh", someone correcting a number they gave earlier, a question left open.
   - Draft its answer key. An independent subagent checks it against the transcript before it's used, as in Phase 2 (decision 19). The user may correct it; nothing waits for that.

   It answers Phase 2's carried-over question 2, an hour-long measurement (decision 8).

### Engines

5. **The transcription candidates.** Old WP6 asked for the best 2 or 3, at two model sizes each:
   - **whisper.cpp** (MIT; Whisper's weights are MIT too), from a release's Windows CUDA build, with `large-v3-turbo-q5_0` (547 MiB) and one smaller model: `small`, or `medium-q5_0` if small's errors are much higher.
   - **whisper.cpp on the CPU only,** with `large-v3-turbo-q5_0`: what a consultant without an NVIDIA GPU gets, and what's left while Ollama has the GPU.
   - **NVIDIA Parakeet TDT 0.6B v2** (CC-BY-4.0, English only), int8, run by sherpa-onnx on the CPU, with Silero VAD (MIT) cutting long audio into pieces, as sherpa-onnx's examples do. If it's fast enough on the CPU, the GPU stays free for extraction (decision 10).

   **Not measured:**
   - **faster-whisper** runs the same Whisper models, but needs Python plus NVIDIA's cuBLAS and cuDNN 9 libraries, installed separately on Windows.
   - **Whisper in the browser** would run inside the page the consultant is working in.
   - **No Python or PyTorch on this laptop at all:** C: is nearly full, and none of the candidates needs them.

   Use the latest whisper.cpp release that publishes a Windows CUDA build. v1.9.5's builds are published under its build tag `b5454`, the same commit (`d1be6fd`); record both names. v1.8.2 published `whisper-cublas-12.4.0-bin-x64.zip` (457 MB); check that the driver supports its CUDA version (`nvidia-smi`). If no recent release has one, ask before building from source.

6. **The speaker candidates.**
   - **sherpa-onnx's offline speaker diarization:** pyannote's segmentation-3.0 model (MIT) and a 3D-Speaker embedding model (Apache-2.0), preferably one trained on English (VoxCeleb). Both come from sherpa-onnx's releases on GitHub, so no account is needed. Measure two embedding models, each with and without the number of speakers given (the session's participant count).
   - **pyannote.audio's community-1 pipeline** (CC-BY-4.0) is the stronger open model, but it needs a Hugging Face account, accepting pyannote's conditions (which ask for contact details), an access token, Python and PyTorch. Use it only if sherpa-onnx fails decision 8's bar. Then ask the user whether he wants to set up the account: it's his decision.
   - **Not whisper.cpp's tinydiarize:** it marks where the speaker changes, not who speaks, needs a special small English model, and is experimental.
   - **Any other model:** check its licence before using it, and record it.

7. **The engines are programs StyleCode runs, not npm packages.** `CLAUDE.md` asks before any new runtime dependency. The reviewer approves this one on the user's behalf, as follows:
   - **A setup command** downloads the chosen programs and models into `~/.stylecode/transcription/`, outside the repository and the data folder. Each is pinned by version and SHA-256, and its licence is kept beside it. The spike's setup (WP2) fetches every candidate; the app's (WP5) only the chosen ones.
   - **StyleCode itself never downloads anything.** The app reads what the setup installed, and says what to run when nothing is there.
   - **The local server spawns the programs** with argument arrays, never through a shell, and never logs what they print, because that is the client's words (ADR-0009).
   - **Disk:** check free space on C: before downloading. Stop and ask under 5 GB.

8. **What WP3 measures, and how the default is chosen.**
   - **For each candidate, on each meeting, clean and hard:**
     - **word errors,** after a normaliser (case, punctuation, fillers, numbers as words or digits, British and American spelling), the same for every candidate; the raw rate too;
     - **key terms:** the names, places and numbers in the script, found or not. Kokoro's pronunciation of South African names is part of why some are missed; say so;
     - **speakers:** how many were found against how many there were, the share of speech given the wrong speaker after the best matching, and the share of words given the right speaker;
     - **confidence:** the share of wrong words in segments the engine was unsure of, against the rest, to set decision 19's threshold;
     - **time and load:** minutes per hour of meeting for transcription, speakers and putting them together; peak RAM and GPU memory; the GPU's clock and temperature every 15 seconds, as `EXTRACTION.md` logged them.
   - **The downstream test:** run Phase 2's extraction (qwen3:4b, the app's settings) on each candidate's transcripts of the three short meetings, and score them against the same answer keys. Match each speaker label to its participant first, by the best matching, as the consultant would. Translate citations to the key's turns by their time overlap with the timeline. Run extraction on the typed transcripts again in the same session, so the comparison isn't spoilt by a hotter or cooler GPU.
   - **The hour-long meeting, end to end:** transcription, speakers and extraction, one after the other and at the same time (decision 10). Also run extraction with parts of 4096 and 8192 tokens against 6144, to check that 6144 still finds the most (Phase 2's question 2).
   - **The default** is the fastest setup whose transcripts keep extraction's recall within 10 points of the typed transcripts', and give at least 90% of words the right speaker on the clean meetings. If none passes, say so at the check-in, with the closest options.
   - **Measure plugged in and in performance mode,** as Phase 2 did, and record the hardware and anything else that was running.

9. **Names as a hint.** Whisper takes a short prompt that steers spelling. Measure with and without one made of the session's participant names, the company's name and the engagement's name, all already on this computer. Adopt it if it helps names and doesn't hurt the rest.

10. **Sharing the GPU.** The laptop's GPU has 6 GB and slows down with heat after about a minute (`EXTRACTION.md`). Two jobs at once probably share one slowed GPU rather than doing twice the work, and may not fit in its memory together.
    - **The working assumption:** StyleCode never runs a transcription and an extraction run at the same time. Whichever starts second waits, and says so.
    - **Before a transcription uses the GPU,** StyleCode asks a local Ollama to unload its model (`keep_alive: 0`), if WP3 shows they don't fit together.
    - **WP3 measures both ways** (decision 8), and its check-in settles this. If the chosen transcription runs on the CPU, the two may run together.

11. **Live transcription is measured, not built.** Old WP6 asked to try one live mode. Feed the hour-long clean meeting in 30-second pieces at real-time pace, and report how far the text falls behind the speaker, with Ollama idle and with an extraction run going. `TRANSCRIPTION.md` says what "live" can mean on this laptop. The interface waits for Phase 7.

### Recording

12. **How the browser records.** `getUserMedia` on `localhost` (a secure context), and an AudioWorklet that turns the microphone into 16 kHz mono 16-bit PCM, downsampled in code by a pure function with tests. The audio goes to the local server in pieces every few seconds and is written to the session's file as it arrives. So a crash or a closed tab loses at most the last few seconds, and the file is already what the engines read, with no decoder.
    - **Size:** an hour is about 115 MB. The server refuses to start a recording with under 1 GB free, and warns under 5 GB.
    - **Processing:** echo cancellation and noise suppression off, automatic gain on. In a room there's no far end to cancel, noise suppression can clip quiet speech, and the engines cope with noise. The settings used are recorded with the file. The user can change this at the WP6 check-in.
    - **The microphone:** the consultant chooses it and sees a level meter. If Windows blocks the microphone, the message says where to allow it (Settings, Privacy and security, Microphone, including desktop apps).
    - **Browsers:** Chromium browsers (Chrome, Edge) are tested and supported. Others may work.

13. **Recording and consent.**
    - **Record** is unavailable without consent to recording (C1), and says why, like Import transcript.
    - **Starting the first recording locks the consent record** (C4: "or starting a recording"). The first time, a confirmation says so, as the import preview does.
    - **Stop** is always one click or one key away: the client can ask to stop at any time (the *canStopOrDelete* statement).
    - **A recording carries on while the consultant takes notes and moves around StyleCode.** It lives outside React, as an extraction run does, holds the client open, shows on every page (time, level and Stop), and warns before the tab closes.
    - **A withdrawal stops a recording first** (C8). So does deleting the session or the client.
    - **A session can have several recordings,** stopped and started again; there's no pause. Each is a file of the session, at most 4 hours long, and stops itself at the limit with a message.
    - **Recordings can be played in StyleCode (decision 21), but not downloaded,** in Phase 3. A copy outside StyleCode would outlive what the client was told about retention. Deleting a recording is always possible, and permanent.

14. **Meetings in the room only.** With headphones, the microphone hears only the consultant. Capturing the computer's sound works only in Chromium browsers, only when sharing the whole screen, and only with an opt-in each time. So Phase 3 doesn't record the computer's sound. The guide says: record meetings in the room; for online meetings, import the platform's transcript (Phase 2). Add "recording the computer's sound for online meetings" to the roadmap as a later item.

15. **Adding a recording made elsewhere: WAV only.** Any sample rate, 16-bit or float, mono or stereo, up to 4 hours and 2 GB, converted by code to 16 kHz mono when it arrives. It needs the same consent as recording (C1) and locks the record in the same way. Other formats (M4A, MP3, MP4) are refused, with a message saying to convert to WAV first. Supporting them needs a decoder, which is a later question; add it to the roadmap. Adding a WAV also lets the measurements and tests feed the synthetic meetings through the app.

### Transcription

16. **Consent.** Transcribing needs consent to transcription (C1), as importing does, and not consent to AI: the *transcribed* statement already tells the client "on my computer", and nothing leaves it. Never after a withdrawal (C8). There is no external transcription in Phase 3.

17. **A transcription is a job in the local server,** so it carries on if the page closes.
    - **Its working files** (converted audio, the programs' output) go in the company's folder, never the system's temporary folder, and are deleted when the job ends. Leftovers are removed at start-up.
    - **Before starting,** an estimate, from the recordings' length and past speeds, as extraction does. **While running,** progress, and Cancel, which stops the programs and keeps nothing.
    - **The result** (segments, no audio) is kept in the company's folder until the page adds it or the consultant discards it. Consent is checked again when it's added.

18. **Adding the transcript.**
    - **A preview,** as for an import: the speakers found, the segments, the length, the engine and models, and what adding does. For "deleted after transcription", it says the recordings will be deleted, as the client was told (decision 22).
    - **Adding is one permanent step.** The transcript's source is the recordings (workspace version 4), naming the engine and models.
    - **A session still has one transcript** (MVP Q10). Transcribing a session that has one replaces it, under Phase 2's rules for replacing.
    - **When starting, the consultant can choose** "Add the transcript when it's ready" and, where consent allows the AI, "Then ask the AI for findings". The first option says what the preview would have said, including that the recordings will be deleted where that was the promise. With both, nobody needs to be at the keyboard between the end of the meeting and the proposals, as long as the page stays open.

19. **Segments.** Each of the engine's words is given the speaker whose turn it falls in, by time. A segment ends where the speaker changes, at the end of a sentence once it's 15 seconds long, or at 30 seconds, so a quoted passage stays short. Each segment keeps its confidence, and those below the threshold set at WP3 are marked "may be misheard", in words and not only colour. The text still can't be edited (MVP Q9). A mishearing is put right in the consultant's statement of a finding, and checked against the audio (decision 21).

20. **Speakers.** The labels are "Speaker 1", "Speaker 2"…, in the order they first speak, and are matched to participants as in Phase 2 (MVP 4.3). A person can have several labels when the engine split their voice.

    **C11 for recordings:** a machine's labels name nobody, so the warning lists every label not yet matched to a client participant who was asked, or to someone on the consultant's side, and it updates as labels are matched. An imported transcript keeps its warning as it was at import, as now.

21. **Play from here.** While a session's recordings exist, each segment of the transcript made from them can be played from its start. The audio is fetched with the workspace header and played in the page.

### Retention (C10)

22. **"Deleted after transcription" is kept by the step that adds the transcript.** The same permanent save adds the transcript and deletes the recordings it was made from, so there's no moment when the transcript is ready and the audio is still kept. If that save fails, neither happens, and it's retried. A recording under this promise that, a day after it was made, hasn't been transcribed, or whose transcript is ready but not added, is listed (decision 23), with Transcribe (or Add transcript) and Delete.

23. **Recordings past their time** (CONSENT.md decision 4). A pure function lists every recording whose time is up:
    - "N days": counted from when it was recorded;
    - "until the engagement ends": from the engagement's end date;
    - recording no longer agreed: an amendment turned it off, or consent was withdrawn;
    - and, listed separately, those of decision 22 still waiting for their transcript.

    When StyleCode opens, the clients list shows them, across all clients, with one action that deletes every recording past its time. It shows them each time until they're gone. Each session shows its recordings and when each is due ("kept until 12 Dec 2026"). StyleCode never deletes a recording on its own, except as decision 22 says.

24. **A record that the promise was kept.** When a recording is deleted, the session keeps a line: when it was recorded, how long it was, when it was deleted, by whom, and why (after transcription, its time was up, after a withdrawal, or by the consultant). The export prints these lines under the session, in the session's time zone, beside its consent record (C9). No sound and no words are kept.

25. **After a withdrawal** (C8, Phase 2 decision 11): a recording in progress stops, and a transcription job is cancelled and its result discarded. The flow first offers to delete the recordings, then the transcript, then lists what keeps a statement, as now.

### Carried over from Phase 2

26. **AI context beyond one session** (question 3): not in Phase 3. Extraction is unchanged. Revisit when the evaluation shows the need, and in Phase 7 for company knowledge.
27. **Company knowledge in the export** (question 4): the export lists the company facts promoted from this engagement's findings, with their status and source, in a section of their own. Nothing from other engagements, as now.
28. **Facts entered directly** (question 5): yes. "Add a fact…" on the client's page, with statement, kind and status. Its provenance is "entered by the consultant", with no source. An undoable step.
29. **Times on screen** (question 6): session pages show times in the session's own time zone. When that differs from the computer's, they add the offset as the export writes it, for example "10:00 (GMT+2)".
30. **A real export StyleCode refuses** (question 7): the process in `docs/phase-2/samples/README.md` stands. Nothing to build unless the user reports one.
31. **Real client use still waits for the POPIA review** of the consent wording. Transcription in Phase 3 is local only, so it adds no transfer outside South Africa, but the wording is still `draft-1`. The guide says so where it explains recording.

## Clarifications

- **Model versioning.** The model changes in WP4 raise the workspace version to 4, with a migration in `parseWorkspace` and tests (`DOMAIN-MODEL.md`, "Versioning"):
  - an audio file records when it was recorded, its length, its sample rate, how it came in (recorded or added), the recording settings, and when it was transcribed;
  - the transcript source gains `{ kind: 'recording', … }`, naming the recordings by start and length (so it stays valid once they're deleted), the engine and model, and the speaker models;
  - a session keeps its deleted recordings' lines (decision 24);
  - C11 for recordings (decision 20).

  Version 3 workspaces have no audio, so the migration only adds empty fields. Record the changes in `DOMAIN-MODEL.md`.
- **New model functions,** pure, with unit tests: starting a recording (C1, C4), finishing it, adding a WAV, adding a transcript from recordings (with decision 22's deletion), removing a recording, recordings past their time (decision 23), and C11 for recordings.
- **Routes** go through the shared request checks (ADR-0008):
  - **recording pieces** are appended at an offset, so a piece sent twice isn't written twice; the server checks the ids, the session and the size;
  - **finishing** writes the WAV's header. At start-up, a recording left unfinished by a crash is finished with what arrived, and the session says it was recovered;
  - **transcription:** status, jobs, progress, cancel and results.

  The 50 MB limit stays for documents. Audio has its own: 4 hours of 16 kHz mono for a recording, and decision 15's for an added WAV.
- **Putting words and speakers together,** and reading every format the engines produce, are pure functions in `src/workspace/transcription/`, with unit tests, shared by the server and the tests.
- **No engine and no network in tests.** Unit and browser tests use:
  - a fake engine: a small Node program that answers like the real ones, with recorded output;
  - a fake microphone: Chromium's `--use-fake-device-for-media-stream` and `--use-file-for-fake-audio-capture`, with a WAV the test generates (a tone, not speech).

  CI scores one recorded transcription run, as it does an extraction run, so the harness can't silently break.
- **Not the AI's colour.** A transcript made on this computer isn't an AI proposal, so it isn't cantaloupe. It says how it was made, as an import names its platform: for example "Transcribed on this computer by whisper.cpp (large-v3-turbo); speakers by sherpa-onnx".
- **PowerShell is denied to you on this laptop.** Measure with `nvidia-smi`, `tasklist` and Node, and play audio through a browser page.

## Ground rules

As in Phase 2 (`docs/phase-2/PHASE-2-BRIEF.md`, "Ground rules"), with these branches:
- `workspace-3a-transcription-test`
- `workspace-3b-capture`
- `workspace-3c-retention`

Also:
- **Measurements happen on the user's computer** (`CLAUDE.md`), plugged in and in performance mode, with the hardware recorded.
- **No real voices or real recordings, ever, and no audio in git.** The only sound StyleCode records in this phase is WP8's synthetic speech, played in the room.
- **Disk:** C: has about 16 GB free. Check before each download and each batch of audio; stop and ask under 5 GB.
- **The `images.spec.ts` flake** ("adds an image, saves it inside the project file…", ending "Test ended"): if it fails again, fix it in its own small pull request.

## Slice A: The transcription test (`workspace-3a-transcription-test`)

### WP0: Start clean

1. Update `main` (at `1894a62` or later), create `workspace-3a-transcription-test`, and run every check. Note the counts.
2. Commit this brief as the first commit.
3. Note what the laptop has: free space on C:, the NVIDIA driver and the CUDA version it supports (`nvidia-smi`), whether the Microsoft Visual C++ runtime is installed, and Ollama's models.

⏸ **Check-in:** the baseline and the laptop. Raise any decision above that looks wrong.

### WP1: The test meetings

1. Write the hour-long role-play and draft its answer key (decision 4). A subagent checks the key.
2. Build `eval/audio/` (decision 3): the voices, the mixer, the timelines, the noise and the echo.
3. Make the clean and hard audio of all four meetings on the laptop, then check the voices (decision 2).

### WP2: The harness

1. **`spikes/transcription/`:**
   - a setup that fetches every candidate of decisions 5 and 6, pinned and hashed, with their licences (decision 7);
   - a runner for each candidate that times it and logs memory and the GPU.
2. **`eval/transcription/`:** the scorer of decision 8, with:
   - the normaliser, word errors and key terms;
   - speakers and confidence;
   - citations translated to the key's turns, for the extraction scores;
   - unit tests, and one recorded run checked in CI.

### WP3: Measure, and write `docs/research/TRANSCRIPTION.md`

1. Run the measurements of decisions 8, 9 and 11.
2. Write `docs/research/TRANSCRIPTION.md`:
   - the candidates and their licences, with sources and dates;
   - the setup steps on Windows;
   - the results tables, with the hardware;
   - the GPU question, and the hour-long meeting end to end;
   - what "live" can mean on this laptop;
   - the recommended setup and the risks;
   - the lower-bound warning of decision 1, at the top.

⏸ **Check-in:** the results and the recommendation:
- the engine and model;
- speakers, and whether to give their number;
- the names hint;
- the GPU order (decision 10);
- the confidence threshold;
- the minutes from the end of an hour-long meeting to the proposals.

Then run an independent review subagent over the slice, fix what it finds, push, and open the pull request.

⏸ **Check-in:** the pull request link and the CI result. Wait for the merge.

## Slice B: Recording and transcription (`workspace-3b-capture`)

### WP4: Model changes (workspace version 4)

The model changes and functions in "Clarifications", with unit tests.

### WP5: The server

1. **Recordings:** pieces, finishing, recovery and free space (decision 12 and "Clarifications").
2. **Adding a WAV** (decision 15).
3. **`npm run transcription:setup`,** for the setup chosen at WP3 (decision 7).
4. **`server/transcription/`:**
   - settings in `~/.stylecode/transcription.json`;
   - status: what's installed, the versions, GPU or CPU;
   - jobs, progress, cancel and results (decision 17);
   - the GPU rule (decision 10);
   - the fake engine for tests.

### WP6: Recording

On the session page, following decisions 12 and 13:
- Record, or why not;
- the microphone and its level;
- the first-time lock confirmation;
- the indicator on every page;
- Stop, by click and by key;
- several recordings, deleting one, and the limits;
- recovery after a crash.

⏸ **Check-in: screens.** Screenshots at 2× of:
- Record unavailable without consent;
- the lock confirmation;
- a recording in progress, on the session page and on another page;
- the session's recordings after stopping.

### WP7: Transcribing

- **Settings:** transcription's status, and what to run when it isn't set up. Without it, Transcribe isn't offered, and the session says why.
- **Transcribe…,** with the estimate and decision 18's options; progress and Cancel; the waiting rule of decision 10.
- **The preview and adding** (decisions 18 and 22).
- **The transcript:** the line saying how it was made, "may be misheard", play from here, and speakers with C11 (decisions 19 to 21).
- **The keyboard,** with the new shortcuts in the shortcuts dialog.

⏸ **Check-in: screens.** Screenshots at 2× of:
- a transcription in progress;
- the preview, saying the recordings will be deleted;
- the transcript with speakers to match, a "may be misheard" segment and the C11 warning;
- play from here.

### WP8: End to end on the laptop

1. **The roadmap's "recorded role-play meeting".** Play Karoo Freight's clean audio through the laptop's speakers from one browser page, while StyleCode records it with the microphone in another (echo cancellation is off, decision 12; check the playing browser isn't muted). Then transcribe it, and report word errors and speakers against the clean file's results. Tell the user beforehand: the laptop will talk for about five minutes.
2. **An hour, through the app.** Add the hour-long meeting's clean WAV to a role-played session whose consent says "deleted after transcription", choose both of decision 18's options, and time it from Transcribe to the proposals. Check that the recording is gone and that the session's line says when.

Then run an independent review subagent over the slice, fix what it finds, push, and open the pull request.

⏸ **Check-in:** WP8's numbers, the pull request link and the CI result. Wait for the merge.

## Slice C: Retention and what Phase 2 left (`workspace-3c-retention`)

### WP9: Retention

- **Recordings past their time** on the clients list at start-up, with the one action (decision 23).
- **The session's recordings,** with their due dates, and those still waiting for their transcript (decision 22).
- **The deleted recordings' lines,** in the session and in the export (decision 24). Update the export's snapshot.
- **Withdrawal** (decision 25), and amendments that change the retention or turn recording off.

### WP10: Carried over

- Company knowledge in the export (decision 27), with the snapshot updated.
- Add a fact (decision 28).
- Times in the session's time zone (decision 29).

### WP11: Docs and roadmap

- **Guide:**
  - setting up transcription, and the licences of what it installs;
  - recording a meeting in the room, and why not online meetings;
  - transcribing, matching speakers, and "may be misheard";
  - what it can't do: real accents, people talking over each other, and that the measured numbers come from synthetic speech;
  - how long recordings are kept, and the list at start-up.
- **`ARCHITECTURE.md` §12, `DOMAIN-MODEL.md` and `CONSENT.md`:** updated to describe what was built. `CONSENT.md` gets C1, C4, C10 and C11 as built, and a "Changes from Workspace Phase 3" section.
- **`MVP.md`:** where it lists recording and local transcription as out of scope.
- **`ROADMAP.md`:** Phase 3 marked ✅, with decision 1 recorded, and the later items of decisions 14 and 15.
- **`docs/phase-4/NOTES-FOR-THE-BRIEF.md`:** the questions Phase 4 inherits.

### WP12: Review and hand-back

1. Run an independent review of the whole of Phase 3: a subagent that hasn't seen your reasoning checks the work against this brief, the specs and the roadmap's acceptance criteria.
2. Fix what it finds.
3. Write `docs/phase-3/HANDOVER.md`: what was built, the decisions, test counts, the measurements, known limitations, and what Phase 4 starts with.
4. Push, and open the pull request.

⏸ **Check-in:** the pull request link and the CI result.

## Acceptance criteria

The roadmap's, with this phase's decisions:
- Recording is unavailable without consent to recording, and says why.
- A recorded role-play meeting (WP8) is transcribed on this computer with speakers, and nothing is sent elsewhere.
- With "deleted after transcription", the recording is gone when the transcript is added, and the session says when it was deleted.
- Recordings past their time are listed when StyleCode opens, until they are deleted.
- A recording carries on while I take notes and move around StyleCode. Stopping keeps everything recorded, and closing the tab loses at most a few seconds.
- I can match a transcribed meeting's speakers to participants, and see which speakers aren't yet matched to anyone who was asked.
- `docs/research/TRANSCRIPTION.md` gives the measured accuracy, speed and recommended setup, and says the numbers come from synthetic speech.
- Everything works from the keyboard and passes the accessibility check. Typecheck and unit tests are green on Linux and Windows, and browser tests on Linux, as CI runs them.

## Definition of done

- [ ] The hour-long role-play, with its checked key; synthetic audio of four meetings, clean and hard; the timelines in git, the audio not
- [ ] The candidates measured on the user's computer; `docs/research/TRANSCRIPTION.md` written; the scorer tested, with a recorded run in CI
- [ ] Workspace version 4, with its migration and tests
- [ ] Recording, adding a WAV, transcribing, speakers and play from here, each with browser tests (fake microphone, fake engine)
- [ ] "Deleted after transcription" kept by the step that adds the transcript; the list at start-up; the deleted recordings' lines in the export
- [ ] WP8 run on the laptop: the re-recorded meeting, and an hour through the app
- [ ] Company knowledge in the export, facts added directly, and times in the session's zone
- [ ] Guide, architecture, specs and roadmap updated; Phase 4 notes written
- [ ] An independent review per slice and of the whole phase; handover written; three pull requests merged by the user

## Sources

Checked by the reviewer on 2026-11-11. Check them again when you pin versions in WP2.

- **Whisper's code and model weights:** MIT: [github.com/openai/whisper](https://github.com/openai/whisper).
- **whisper.cpp:** MIT; `whisper-cli`, Silero VAD support, tinydiarize marked experimental, and memory per model size: [github.com/ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp). Latest release v1.9.5: [releases](https://github.com/ggml-org/whisper.cpp/releases). The Windows assets of v1.8.2, including `whisper-cublas-12.4.0-bin-x64.zip` (457 MB): [SourceForge mirror](https://www.sourceforge.net/projects/whisper-cpp.mirror/files/v1.8.2/). `large-v3-turbo` (1.5 GiB) and `large-v3-turbo-q5_0` (547 MiB): [the commit adding them](https://huggingface.co/spaces/Xenobd/whisper.cpp/commit/f3283bae431fc2bb7325a10a4e738e07f4896e93). `-oj` and `-ojf` (JSON output): [CLI README](https://huggingface.co/spaces/natasa365/whisper.cpp/blob/main/examples/cli/README.md).
- **sherpa-onnx:** Apache-2.0 ([package licence](https://cloudsmith.com/navigator/pypi/sherpa-onnx)); latest release v1.13.6 ([releases](https://github.com/k2-fsa/sherpa-onnx/releases)); prebuilt Windows binaries ([docs](https://k2-fsa.github.io/sherpa/onnx/install/windows/download-pre-compiled.html)); speaker diarization with pyannote segmentation-3.0 converted to ONNX and 3D-Speaker or NeMo embeddings ([models](https://csukuangfj.github.io/sherpa/onnx/speaker-diarization/models.html)); Kokoro through sherpa-onnx ([example](https://csukuangfj.github.io/sherpa/onnx/javascript-api/examples/tts_kokoro_zh_en.html)); a Windows walk-through with `sherpa-onnx-offline-tts.exe` and `kokoro-int8-multi-lang-v1_0` ([LocalAIMaster](https://localaimaster.com/blog/best-local-tts-windows)).
- **sherpa-onnx 2.0.0 removed espeak-ng and piper-phonemize** ([CHANGELOG at v2.0.1](https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/CHANGELOG.md)); at v2.0.1 Kokoro's word-list lookup skips unknown words ([`offline-tts-kokoro-impl.h`](https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/sherpa-onnx/csrc/offline-tts-kokoro-impl.h)), while v1.13.8 hands them to espeak-ng ([`kokoro-multi-lang-lexicon.cc`](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/kokoro-multi-lang-lexicon.cc)). Read from the source on 2026-11-11.
- **whisper.cpp `b5454`:** a pre-release on commit `d1be6fd`, "bump version to 1.9.5", with 14 assets: [release page](https://github.com/ggml-org/whisper.cpp/releases/tag/b5454).
- **pyannote segmentation-3.0:** MIT, gated on Hugging Face with a request for contact details: [model card](https://huggingface.co/pyannote/segmentation-3.0).
- **pyannote community-1:** CC-BY-4.0, gated ([files page](https://huggingface.co/pyannote/speaker-diarization-community-1/tree/main)); needs the conditions accepted and an access token ([pyannote.audio 4.0 on PyPI](https://pypi.org/project/pyannote-audio/4.0.0/)).
- **3D-Speaker:** Apache-2.0: [github.com/modelscope/3D-Speaker](https://github.com/modelscope/3D-Speaker).
- **Parakeet TDT 0.6B v2:** CC-BY-4.0, English: [model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2); sherpa-onnx's int8 build, CC-BY-4.0: [model](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8).
- **Silero VAD:** MIT: [PyPI](https://pypi.org/project/silero-vad/), [mirror with licence](https://huggingface.co/safestack/silero-vad).
- **Kokoro-82M:** Apache-2.0 weights; espeak-ng, which it uses, is GPL-3.0 ([model card](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/README.md), [licences section](https://huggingface.co/hexgrad/Kokoro-82M/raw/refs%2Fpr%2F3/README.md)); 28 English voices, American and British ([an ONNX export's notes](https://huggingface.co/christopherthompson81/kokoro-82m-onnx)).
- **Piper:** the original repository archived in October 2025 under MIT, development continuing as GPL-3.0-or-later ([review](https://www.promptquorum.com/power-local-llm/piper-tts-review)); each voice under its dataset's licence ([list](https://huggingface.co/PYTHAI/voaice); LibriTTS-R, 904 speakers, CC BY 4.0: [model card copy](https://huggingface.co/OlegSkutte/sentis-piper-vits-libritts_r)).
- **faster-whisper:** GPU use needs cuBLAS for CUDA 12 and cuDNN 9: [PyPI](https://pypi.org/project/faster-whisper), [GitHub](https://github.com/SYSTRAN/faster-whisper).
- **The computer's sound in Chrome:** only on Windows and ChromeOS when sharing the entire screen, with the user opting in; tab audio when sharing a tab: [addpipe](https://blog.addpipe.com/screen-recording-with-system-sounds-in-chrome.md).
- **AudioWorklet** needs a secure context, and `http://localhost` counts: [Chrome for Developers](https://developer.chrome.com/blog/audio-worklet?hl=en).
- **A WAV file as Chromium's fake microphone** (`--use-file-for-fake-audio-capture`): [Chromium code review](https://codereview.chromium.org/734993002).
- **Unloading an Ollama model** with `keep_alive: 0`: [Ollama FAQ](https://ollama.readthedocs.io/en/faq/).
