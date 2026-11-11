# The test meetings as audio

Workspace Phase 3 measures transcription on synthetic speech made on this computer (`docs/phase-3/PHASE-3-BRIEF.md`, decisions 1 to 3). Every typed role-play in `eval/consultations/` becomes audio with one synthetic voice per speaker. The script and the speaker turns are then known exactly, so word errors and speaker attribution are measured without hand correction.

**The results are a lower bound on errors.** Synthetic voices are cleaner and more distinct than people. They have no South African accents or code-switching, no talking over each other beyond what the mixer adds, no real hesitations, and no real room or laptop microphone.

## Making it

```bash
npm run eval:audio:setup                        # once: sherpa-onnx 1.13.8 and Kokoro v1.0, into ~/.stylecode/transcription/voices/
npm run eval:audio                              # every meeting in voices.json
npm run eval:audio -- karoo-freight-kickoff     # one meeting
```

The setup downloads two archives, checks their SHA-256 (`tools.ts`), unpacks them with the system's `tar`, and writes each one's licence beside it. It stops if the drive has under 5 GB free.

- **The voices:** Kokoro v1.0 (weights Apache-2.0), run by sherpa-onnx v1.13.8 (Apache-2.0). It must be 1.13.x: from 2.0.0, sherpa-onnx dropped espeak-ng, and Kokoro skips any word missing from its word list, which would silently drop names such as Mokoena and Bloemfontein. Kokoro's package carries espeak-ng's data (GPL-3.0). It is used here only to make test audio, and nothing of it ships with StyleCode.
- **Who speaks with which voice:** `voices.json`, by each meeting's speaker label. Each meeting mixes men and women and both accents, and has one pair of the same sex and accent (listed under `sameSexAndAccent`), the hardest case for telling speakers apart. A voice replaced after the check below is recorded under `swaps`.
- **What each meeting adds in the hard version:** `<id>.json` lists the short turns that overlap the turn before them, and, for the hour-long meeting, a two-minute pause.

## What it makes

- **Two versions of each meeting**, as 16 kHz mono 16-bit WAV, the format StyleCode records, in `eval/audio/out/` (never in git):
  - `<id>.clean.wav`: the turns in order, with seeded gaps of 0.3 to 1.2 seconds;
  - `<id>.hard.wav`: the same, plus a short room echo, pink noise about 15 dB below the speech throughout, marked interjections overlapping the turn before by up to half a second, and, in the hour-long meeting, two minutes of noise only after the marked turn (someone fetching a document), to catch an engine writing words into silence.

  The noise and the echo are made by code from a seed, so there are no recorded noise files and nothing else to license.
- **`<id>.timeline.json`** (in git): for each version, every turn's speaker, segment ids, words, and exact start and end. It is the reference every transcription measurement is scored against.

The same meeting always gives the same timeline and the same samples. Each turn's speech is cached in `out/cache/`, so a second run only speaks what changed.

**Checks.** A mix fails if the voice tool reports a skipped or unknown word, or if a turn comes out too short for its words (faster than about seven words a second), because the timeline would then hold words the audio doesn't. Typographic quotes, dashes and ellipses are turned into plain ones before speaking, so none is dropped.

**Checking the voices.** Nobody listens to them. After the first mix, each voice's turns are transcribed with the best candidate (WP3), and a voice whose turns come back with more than 30% of words wrong is replaced and recorded under `swaps` in `voices.json`.

## The code

- `wav.ts`: reading and writing WAV files;
- `dsp.ts`: resampling, the seeded source, noise and echo;
- `speech.ts`: from a transcript's segments to turns, the text as spoken, and the length checks;
- `timeline.ts`: placing the turns, mixing, and the hard room;
- `tools.ts` and `setup.ts`: the pinned voice tool;
- `make.ts`: `npm run eval:audio`.

All but the last two are pure and tested in `audio.test.ts`.
