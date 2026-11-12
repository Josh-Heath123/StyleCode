# The transcription test

Workspace Phase 3, WP2 and WP3 (`docs/phase-3/PHASE-3-BRIEF.md`, decisions 5 to 11): which engine transcribes a consultation on this laptop, and tells who spoke, well and fast enough. The results go in `docs/research/TRANSCRIPTION.md`.

This is a spike: nothing here is part of StyleCode, and `src/` never imports it. It needs no npm package. The engines are programs, downloaded by the setup into `~/.stylecode/transcription/spike/`, outside the repository and the data folder.

## Setup

```bash
node --experimental-strip-types spikes/transcription/setup.ts
```

It downloads every candidate in `files.ts`, checks each file's SHA-256, unpacks it with Windows' own `tar.exe` (Git's `tar` reads `C:` as a remote host and can't open zip files), deletes the archive, and writes the licence beside it. It stops if the drive would have under 5 GB free. About 1.9 GB of downloads.

| Candidate | Version | Licence |
| --- | --- | --- |
| whisper.cpp, Windows x64 with CUDA 12.4, and the CPU-only build | `b5454`, the Windows builds of v1.9.5 (commit `d1be6fd`) | MIT; the CUDA libraries in the zip are under NVIDIA's CUDA licence |
| Whisper large-v3-turbo, 5-bit, and small | `ggerganov/whisper.cpp` at `5359861` | MIT |
| sherpa-onnx, Windows x64 | v2.0.1 | Apache-2.0 |
| NVIDIA Parakeet TDT 0.6B v2, int8 | sherpa-onnx's `asr-models` release | CC-BY-4.0 |
| Silero VAD | sherpa-onnx's `asr-models` release | MIT |
| pyannote segmentation-3.0, as ONNX | sherpa-onnx's `speaker-segmentation-models` release | MIT |
| 3D-Speaker CAM++ and ERes2Net, English (VoxCeleb) | sherpa-onnx's `speaker-recongition-models` release (sic) | Apache-2.0 |

The voices that make the test audio are separate (`eval/audio/`, sherpa-onnx 1.13.8 and Kokoro).

## Running

```bash
STYLECODE_POWER="plugged in, performance mode" node --experimental-strip-types spikes/transcription/run.ts words whisper-turbo-gpu bosveld-citrus-intake clean
node --experimental-strip-types spikes/transcription/run.ts words whisper-turbo-gpu karoo-freight-kickoff clean --names
node --experimental-strip-types spikes/transcription/run.ts speakers campplus karoo-freight-kickoff hard --count
npm run eval:transcription      # scores every recorded run
```

- **Words:** `whisper-turbo-gpu`, `whisper-small-gpu`, `whisper-turbo-cpu` (the CPU-only build), `parakeet` (Silero VAD finds the speech, the audio is cut there into pieces of at most 30 seconds, and Parakeet reads all the pieces in one process, with each token's time and probability). `--names` gives Whisper a prompt of the meeting's title and participants (decision 9).
- **Speakers:** `campplus` or `eres2net`, with pyannote's segmentation; `--count` gives the number of people.
- Every program is started with an argument list, never through a shell. The runner records the wall time of each stage, the program's peak memory (`tasklist`, every second), and the GPU's clock, temperature, memory, use and power (`nvidia-smi`, every second, logged every 15 seconds). Run one at a time.

The result goes to `eval/transcription/runs/<run>/<meeting>.<version>.json`: the words (text, start, end, confidence) or speaker turns, and the times and resources. The scorer is in `eval/transcription/` (see its README).

## WP3's measurements

Each driver runs its steps one after another, logs each step's outcome to `~/.stylecode/transcription/spike/measure.log` (names, times and errors only), and carries on when a step fails. Set `STYLECODE_POWER` for all of them.

```bash
node --experimental-strip-types spikes/transcription/measure.ts words       # every words candidate on every meeting, clean and hard, and Whisper with the names hint
node --experimental-strip-types spikes/transcription/measure.ts speakers    # both speaker models: with the count, and at thresholds 0.5, 0.7 and 0.9
node --experimental-strip-types spikes/transcription/extraction.ts downstream <speakers run> <words run>...  # Phase 2's extraction on the engines' transcripts, and on the typed ones before and after
node --experimental-strip-types spikes/transcription/extraction.ts sizes <words run> <speakers run>         # the hour-long meeting at parts of 4096, 6144 and 8192 tokens
node --experimental-strip-types spikes/transcription/endtoend.ts <words> <speakers model> --count [<other words>...]  # end to end, and transcription during extraction
node --experimental-strip-types spikes/transcription/live.ts whisper-turbo-gpu [--busy]                      # 30-second pieces at real-time pace
```

- **Speaker thresholds:** `--threshold <x>` (without `--count`) sets sherpa-onnx's clustering threshold; its default is 0.5, and a larger one gives fewer speakers. `--label <name>` records any run under another name, so a repeat doesn't replace the batch's record.
- **Extraction** runs go to `eval/runs/p3-…/` and are scored by `npm run eval:score`. The engines' transcripts and translated keys they read are in `eval/transcription/extraction/`.
- **End to end** writes `eval/transcription/endtoend/<words>.json`: one after the other, words and speakers at once, and each words candidate alone and during an extraction run, with the GPU's memory.
- **Live** writes the lags to `eval/transcription/live/<engine>.<idle|busy>.json`, and the words as a run (`live-<engine>-<idle|busy>`), so the report scores them.
- `steps.ts` holds what the drivers share.
