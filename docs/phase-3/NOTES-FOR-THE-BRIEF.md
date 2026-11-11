# Notes for the Workspace Phase 3 brief

Written at the end of Workspace Phase 2 (`docs/phase-2/HANDOVER.md`). Phase 3 is capture: recording in the browser, local transcription with speakers, and audio retention (`docs/ROADMAP.md`). It opens with the transcription test (old WP6, in the appendix of `docs/phase-0/PHASE-0-BRIEF.md`). These are the questions it inherits. None of them is decided; each needs the user, or the reviewer on the user's behalf.

## Test audio

1. **Where the test recordings come from.** Old WP6 expects the user to record two role-played consultations of about 10 minutes each, and to hand-correct a 2 to 3 minute excerpt of each. The user won't have time for that.

   *An option:* make the audio on the computer with synthetic speech, one voice per speaker, from the typed role-plays that already exist: Karoo Freight (`docs/phase-2/samples/karoo-freight-kickoff/meeting.json`), Veldt Vets and Umoya School (`eval/consultations/`). Free local text-to-speech can do this, for example the voices built into Windows, or Piper (an open-source engine with many voices). The turns are mixed into one track with short pauses, and the transcript and speaker turns are then known exactly, so word error rate and speaker attribution can be measured with no hand correction. The licences of the engine and the voices must allow it; check them with sources.

   *What it can't show:* real accents (including South African English and code-switching), people talking over each other, hesitations and false starts, room noise and echo, a laptop microphone's quality, and how speaker separation copes with similar real voices. Synthetic voices are cleaner and more distinct than people, so they flatter both transcription and speaker attribution. Results from them are a lower bound on errors, not an estimate.

   *A middle way:* synthetic audio for the measurements and the CI tests, plus one short real role-play (two people, five minutes) when the user can spare it, to see how far the synthetic numbers are from real ones. Background noise could be mixed into some synthetic tracks to make them harder.

   Audio files stay git-ignored, synthetic ones too, unless a test needs a few seconds of one.

## Carried over from Phase 2

2. **Extraction speed on a real hour.** Extraction was measured on 5 to 15 minute role-plays (`docs/research/EXTRACTION.md`): about 25 minutes per hour of meeting with qwen3:4b on the user's laptop, and 9 minutes while the GPU stays cool. Measure the first real hour-long transcript, as the write-up says, including whether parts of 6144 tokens still find the most. Transcription will now run on the same computer before extraction, so the two together decide how long after a meeting the proposals are ready. Can they share the GPU, or should one wait for the other?
3. **AI context beyond one session** (Phase 0 open question 1). Phase 2 gives the AI one session's transcript and notes only (decision 7), and code drops repeats of what is already in the engagement. Giving it the engagement's findings, or company knowledge, might find more and repeat less, but each would have to be checked against the consent of the sessions it came from. Revisit only if the evaluation shows the need.
4. **Company knowledge in the export.** The Markdown export covers one engagement and leaves company facts out. Should it list the facts that came from this engagement, or all of the company's?
5. **Facts entered directly.** The model allows a company fact with no source (entered by the consultant), but there is no way to add one in the interface; facts come only from findings in the record. Is one needed?
6. **Times on screen.** The export writes each session's times in the session's own zone (decision 18). Most pages show times on the computer’s clock. A consultant travelling between zones might want the session's zone on screen too.
7. **A real export that StyleCode refuses.** The nine sample layouts are reconstructions (decision 1). The first real Teams, Zoom or Google Meet file that fails is the test of them: type a made-up sample in its layout, add it to `docs/phase-2/samples/`, and support it. Never add the real file.

## Still open from earlier

- **The POPIA review** of the consent wording (`docs/spec/CONSENT.md`). It stays `draft-1` until then, and real client use waits for it. External AI and, in Phase 3, any external transcription would send personal information outside South Africa (question 3).
- **The demo GIFs** in `docs/media` still show the editor before the workspace; re-recording them needs ffmpeg (`npm run demos`).
- **The answer keys** of the evaluation set were drafted by Claude and checked by a subagent; the user may still correct them (`eval/README.md`).
