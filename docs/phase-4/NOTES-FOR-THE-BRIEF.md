# Notes for the Workspace Phase 4 brief

Written at the end of Workspace Phase 3 (`docs/phase-3/HANDOVER.md`). Phase 4 is the canvas in context: the StyleCode editor in each engagement, informed by the record (`docs/ROADMAP.md`, ADR-0007). These are the questions it inherits. None of them is decided; each needs the user, or the reviewer on the user's behalf. Most are about extraction and transcription, which Phase 4 doesn't change, so they can wait for a phase that does, or a short measurement slice.

## Extraction on transcripts made here

From `docs/research/TRANSCRIPTION.md`, "Open questions".

1. **Decision 8's downstream check for `--max-context 0`.** Phase 3 transcribes with whisper.cpp's `--max-context 0`, chosen after WP3 because it stops Whisper repeating itself into pauses and has fewer word errors. Extraction was never scored on its transcripts the way WP3 scored the others: raw proposals, each speaker matched to a person first, against the typed transcripts' recall, which must be within 10 points. WP8's 56% doesn't answer it: it scored what the app showed after its checks, with the speakers unmatched. It is expected to pass, but isn't measured.

   *An option:* run WP3's harness on the four synthetic meetings' `--max-context 0` transcripts, as WP3 did, from a launcher the user double-clicks (`CLAUDE.md`: long runs start from a committed launcher). About an hour of GPU time; with the cooling pause between parts.

2. **The quote check on transcripts.** In WP8's hour, 18 of the AI's 127 raw proposals failed the quote check (their quoted words aren't in the passage they cite). Is that more than on typed notes and transcripts, and why: words the AI tidied from a transcript's spoken form ("um", repeats), the "may be misheard" words, or segment boundaries cutting a quote? The WP8 record (`eval/runs/p3-wp8-hour/`) keeps only the 88 proposals shown, not the 18 that failed, so answering it needs the raw proposals: WP3's harness run on the WP8 transcript and on a typed one, counting failures by cause. That is a long run, so it starts from a launcher the user double-clicks.

3. **The extraction part size.** Two findings point the same way:
   - **Transcript per part.** On the hour-long meeting, parts at 4096 tokens held about 500 tokens of transcript and found 82% to 83%; at 6144 they held 2,036 and found 65% to 70%, with about half the proposals to review. Recall may depend on how much transcript a part holds rather than on the context size. A tuning question: for example 6144 with about 1,000 tokens of transcript per part, measured for recall, precision, proposals per hour and time.
   - **The part cap.** `PART_CONTEXT` (`src/workspace/extraction/prompt.ts`) caps a part at 6144 tokens, so a larger context setting doesn't make larger parts. Any test of bigger parts has to raise the cap.

## The laptop's heat

4. **Balanced or performance mode.** On 17 November one AI run alone, in OMEN's performance mode, took the GPU to 94 to 95 °C, and Windows hibernated the laptop for a critical thermal event (Kernel-Power event 88). The second try, in OMEN's Balanced mode, stayed at 74 to 84 °C, but Balanced held the GPU at about 30 W and the AI part took 20.9 minutes, against 14.4 in WP3: about 37 minutes from the end of an hour's meeting to the proposals, against about 32. The laptop is still in Balanced.
   - *The question:* should the guide recommend Balanced for long AI runs, and should the measurements be repeated in Balanced so the estimates match how the laptop is used?
   - *What Phase 3 added:* the cooling pause (decision 10, extended after WP8). Before a transcription and before each part of an AI run on a local model, a GPU at 87 °C or more waits until it is under 75 °C. It doesn't stop heat building during one long part, as on 17 November, only the next part starting hot. Whether it is enough in performance mode is unmeasured.
   - *Cheaper than either:* better cooling (a raised back, clean vents, a cooling pad) helps every time.

   Any measurement here is a long run, so it starts from a launcher the user double-clicks, and keeps the cooling wait.

## From Phase 3's interface

5. **Recordings waiting for a transcript on the start-up list.** Decision 22 put Transcribe and Delete on those rows. Phase 3 links to the session instead, where both are (accepted at the WP9 check-in). Revisit if consultants find the extra step a nuisance.
6. **A company fact that can't be traced to an engagement.** The export lists the facts promoted from an engagement's findings, found through the finding, or through its sessions once the finding is deleted. A fact whose finding and sessions are all gone is left out, rather than risk printing another engagement's knowledge. Recording the engagement's id on the fact's source would close the gap, at the cost of a model version.
7. **AI context beyond one session** (decision 26). Still one session's transcript and notes. Phase 4 offers the record to the canvas's AI as context (roadmap), which is a related question: each finding would have to be checked against the consent of the sessions it came from (C5).

## Still open from earlier

- **The POPIA review** of the consent wording (`docs/spec/CONSENT.md`). It stays `draft-1`, and real client use waits for it. Phase 3's transcription is local, so it adds no transfer outside South Africa.
- **Real speech.** Every transcription number comes from synthetic voices (decision 1), a lower bound on errors. A short real role-play (two people, five minutes) would show how far off they are, when the user can spare it.
- **Later items in the roadmap:** transcription on the CPU (Parakeet), recording the computer's sound for online meetings (decision 14), and adding recordings in formats other than WAV (decision 15).
- **The demo GIFs** in `docs/media` still show the editor before the workspace; re-recording them needs ffmpeg (`npm run demos`).
- **The answer keys** of the evaluation set were drafted by Claude and checked by a subagent; the user may still correct them (`eval/README.md`).
- **A browser test that timed out under load once:** `e2e/large-document.spec.ts` failed in one full local run during Slice C and passed on its own. Watch it, as the `images.spec.ts` flake was watched.
