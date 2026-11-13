# Transcription: what this laptop can do

Workspace Phase 3, WP3 (`docs/phase-3/PHASE-3-BRIEF.md`, decisions 5 to 11). Measured on 12 and 13 November 2026 with the spike in `spikes/transcription/` (see its README) and scored by `npm run eval:transcription` and `npm run eval:score`.

> **These numbers are a lower bound on errors.** Every meeting here is synthetic speech (Kokoro, one voice per speaker), made on this computer from a typed role-play. Synthetic voices are cleaner and more distinct than people. They have no South African accents or code-switching, no real hesitations, no talking over each other beyond what the mixer adds, and no real room or laptop microphone. Expect real meetings to come out worse, by an amount these tests can't tell.

## The computer

| | |
| --- | --- |
| CPU | Intel Core i7-12700H |
| RAM | 16 GB |
| GPU | NVIDIA GeForce RTX 3060 Laptop, 6 GB, driver 610.91 |
| Ollama | 0.40.16, `qwen3:4b` for extraction (the app's settings: think off, parts of 6144 tokens) |
| Power | Plugged in, HP OMEN performance mode, Windows best performance; from 13 November also lid open |

**The GPU overheats under long jobs.** See [Heat](#heat) below: it held 90 to 94 °C at a 210 MHz clock through the longest runs, and on 13 November the laptop cut out during the heaviest one.

## The candidates

| Candidate | Version | Licence |
| --- | --- | --- |
| whisper.cpp, Windows x64 with CUDA 12.4, and the CPU-only build | `b5454`, the Windows builds of v1.9.5 (commit `d1be6fd`) | MIT; the CUDA libraries in the zip are under NVIDIA's CUDA licence |
| Whisper large-v3-turbo (5-bit, 547 MiB) and small | `ggerganov/whisper.cpp` at `5359861` | MIT |
| sherpa-onnx, Windows x64 | v2.0.1 | Apache-2.0 |
| NVIDIA Parakeet TDT 0.6B v2, int8, on the CPU | sherpa-onnx's `asr-models` release | CC-BY-4.0 (attribution required) |
| Silero VAD (cuts audio for Parakeet) | sherpa-onnx's `asr-models` release | MIT |
| pyannote segmentation-3.0, as ONNX | sherpa-onnx's `speaker-segmentation-models` release | MIT |
| 3D-Speaker CAM++ and ERes2Net, English (VoxCeleb) | sherpa-onnx's `speaker-recongition-models` release (sic) | Apache-2.0 |

Each file is pinned by version and SHA-256 in `spikes/transcription/files.ts`, with its licence written beside it when installed. The licences were checked by the reviewer on 2026-11-11 (sources in the brief's "Sources" section): [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and its [`b5454` release](https://github.com/ggml-org/whisper.cpp/releases/tag/b5454), [sherpa-onnx v2.0.1](https://github.com/k2-fsa/sherpa-onnx/blob/v2.0.1/LICENSE), [Parakeet TDT 0.6B v2](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) and [its int8 build](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8), [Silero VAD](https://pypi.org/project/silero-vad/), [pyannote segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0), [3D-Speaker](https://github.com/modelscope/3D-Speaker).

Not measured (decisions 5 and 6): faster-whisper and pyannote community-1, which need Python, and Whisper in the browser. sherpa-onnx's diarization met decision 8's bar, so pyannote community-1 isn't needed.

## Setup on Windows

1. An NVIDIA driver that supports CUDA 12.4 (`nvidia-smi` shows the highest CUDA version it supports), for the GPU build of whisper.cpp. Without one, only the CPU build and Parakeet run.
2. `node --experimental-strip-types spikes/transcription/setup.ts`: about 1.9 GB of downloads into `~/.stylecode/transcription/spike/`, outside the repository and the data folder. It checks every SHA-256, unpacks with Windows' own `tar.exe` (Git's `tar` can't open zip files and reads `C:` as a remote host), and stops if C: would have under 5 GB free.
3. No Python, PyTorch or npm package. The engines are programs, started with argument lists, never through a shell.

The app's own setup (WP5) will fetch only the chosen engine and models.

## Words

Word errors are after the normaliser (case, punctuation, fillers, numbers, British and American spelling); "raw" is before it. Key terms are the names, places and numbers in the scripts: 1,201 in the four meetings. The numbers include every "one", which the normaliser writes as 1 even as a pronoun ("the one we use"), so some key terms are ordinary words; every candidate is scored the same way. Each figure is the mean over the four meetings (three short ones of 5 to 11 minutes, and the hour-long one), except key terms, which are pooled.

| Candidate | Clean: errors (raw) | Hard: errors (raw) | Key terms found, clean / hard | Minutes per hour of meeting | Peak memory, hour meeting |
| --- | --: | --: | --: | --: | --- |
| **whisper.cpp large-v3-turbo, GPU** | **2.4% (3.8%)** | 6.0% (7.6%) | 88.5% / 85.9% | **2.6** | 1.2 GB RAM, 1.0 GB GPU |
| … with the names hint | 3.2% (4.9%) | 3.9% (5.5%) | 86.9% / 87.0% | 3.1 | |
| whisper.cpp small, GPU | 3.3% (4.9%) | 3.6% (5.4%) | 86.8% / 86.3% | 3.7 | 1.1 GB RAM, 1.0 GB GPU |
| Parakeet TDT 0.6B v2, CPU | 2.9% (3.6%) | 3.6% (5.2%) | 86.8% / 85.9% | 11.2 | 3.0 GB RAM, no GPU |
| whisper.cpp large-v3-turbo, CPU only | 2.5% (4.0%) | 4.2% (5.8%) | 88.3% / 87.8% | 49.1 | 1.5 GB RAM, no GPU |

**Whisper writes words into noise.** On the hard hour-long meeting (background noise, echo, and two minutes of noise with no speech), large-v3-turbo inserted 837 words that weren't said on the GPU (13.1% errors) and 635 on the CPU (9.2%), against 62 and 68 on the clean audio. Small inserted 136, Parakeet 75. On the short meetings the hard version costs large-v3-turbo nothing on Karoo Freight (1.5% both), 1.6 points on Umoya (3.4%), and 4.3 on Veldt Vets (5.9%, against 1.6%), mostly words dropped (40).

In the two-minute pause alone (1,899 to 2,020 s), large-v3-turbo wrote 410 words on the GPU and 560 on the CPU: "It's in the file on my desk", the last sentence before the pause, over and over. Small wrote 20 "[no audio]" markers, and Parakeet nothing. (The reader counted those markers as words then; it now leaves Whisper's notes on sounds out.) The repeated sentence is real words from the meeting, so a quote of it would pass StyleCode's evidence check. Whisper is conditioning on its own previous text. The fix is in [Follow-up measurements](#follow-up-measurements).

**Names the voices mangle.** The most-missed key terms are South African names: Marietjie (17 times, written as "mariachi", "marietje"…), Sipho ("sifo"), Ruan ("juan"), and product names (WeighMate, OptiSort). Part of this is Kokoro's pronunciation, which reads these names with American or British rules, so these misses say as much about the voices as the engines.

**Parakeet's time** includes about 2.4 seconds of start-up for each call of 8 pieces (151 s of the hour meeting's 575 s).

### The names hint (decision 9)

Whisper given a prompt of the meeting's title and participants, against without:

| | Clean | Hard |
| --- | --- | --- |
| Word errors | 3.2%, worse than 2.4% | 3.9%, better than 6.0% |
| Key terms found | 86.9%, worse than 88.5% | 87.0%, better than 85.9% |
| Extraction recall (three short meetings, settled) | 64%, against 61% | 50%, against 61% |

It helped words only on the hard hour-long meeting, where it cut the invented words from 837 to 517. On clean audio it hurt names and the rest. On the Veldt Vets meeting it dropped 44 words (4.9% errors, against 1.6%). Extraction found 3 points more on its clean transcripts, within a run's spread of about 6 points, and 11 points less on its hard ones. Decision 9 adopts it only if it helps names and doesn't hurt the rest, **so it isn't adopted.**

## Speakers

pyannote segmentation with each embedding model, given the number of people ("count") or clustering at a threshold. Means over the four meetings. "Wrong speaker" is the share of speech given the wrong person after the best matching of labels to people. "Minutes per hour" gives the clean and hard means; single meetings ranged more widely (19 to 24 at 0.7).

| Setup | Clean: wrong speaker | Clean: labels per person | Hard: wrong speaker | Hard: labels per person | Minutes per hour |
| --- | --: | --: | --: | --: | --: |
| ERes2Net, count | 17.8% | 0.74 | 16.7% | 0.83 | 15 to 17 |
| ERes2Net, 0.5 | 5.3% | 4.83 | 4.8% | 9.6 | 18 to 19 |
| **ERes2Net, 0.7** | **5.1%** | **2.85** | **5.0%** | **4.4** | **20 to 21** |
| ERes2Net, 0.8 (reported, not picked) | 10.4% | 2.07 | 5.4% | 3.1 | 9 * |
| ERes2Net, 0.9 | 15.8% | 1.47 | 9.7% | 2.2 | 19 to 20 |
| CAM++, count | 47.6% | 0.94 | 54.1% | 1.0 | 10 |
| CAM++, 0.5 | 25.3% | 5.43 | 25.8% | 6.5 | 10 to 11 |
| CAM++, 0.7 | 35.4% | 2.83 | 34.3% | 3.2 | 10 to 11 |
| CAM++, 0.9 | 38.9% | 1.72 | 41.7% | 1.9 | 11 to 12 |

The speaker setup was picked by rule before the downstream test: the lowest wrong-speaker share on the four clean meetings, fewer labels per person breaking ties. **ERes2Net at 0.7** won.

- **Giving the count makes it worse.** It merges people: Veldt Vets' three speakers became two, with 29% of speech under the wrong person.
- **Long meetings get many labels.** At 0.7, the hour-long meeting's 5 people got 34 labels (53 on the hard version), each person split into several. At 0.8 it was 23, with the same share of words given the right speaker (94.4%). The consultant matches every label to a participant (decision 20), so this is work. On the short meetings 0.8 put twice as much speech under the wrong person (10.4%), which is why it wasn't picked.
- **CPU time varies.** Speakers run on the CPU (ERes2Net uses no GPU). The same hour-long meeting took 540 s at 0.8 on the morning of 13 November and 811 to 1,211 s in the other runs. The clustering threshold shouldn't change the time much, and the cause wasn't found, so treat 9 to 21 minutes per hour as the range (the \* in the table).

### Words given the right speaker

Each word given the speaker whose turn it falls in (decision 19), with ERes2Net at 0.7. Decision 8's bar is 90% on the clean meetings.

| Words | Clean (four meetings) | Hard |
| --- | --: | --: |
| whisper.cpp large-v3-turbo, GPU | 94.3% | 94.4% |
| … with the names hint | 94.4% | 94.6% |
| whisper.cpp small, GPU | 93.3% | 92.7% |
| Parakeet | 95.0% | 95.0% |
| whisper.cpp large-v3-turbo, CPU | 93.6% | 94.5% |

Every candidate passes.

## Confidence (decision 19's threshold)

For large-v3-turbo on the GPU, clean, the mean over the four meetings. "Marked" is the share of words below the threshold; "caught" is the share of all wrong words that were marked.

| Threshold | Marked | Wrong among marked | Wrong among the rest | Wrong words caught |
| --: | --: | --: | --: | --: |
| 0.5 | 2.3% | 25.5% | 1.4% | 29% |
| 0.6 | 4.2% | 18.2% | 1.3% | 35% |
| **0.7** | **6.9%** | **14.2%** | **1.1%** | **46%** |
| 0.8 | 10.2% | 11.0% | 0.9% | 56% |
| 0.9 | 14.8% | 9.8% | 0.6% | 72% |

At 0.7 a marked word is about 13 times as likely to be wrong as an unmarked one, and about one word in 15 is marked. These are word confidences. Decision 19 marks segments, so WP4 has to decide how a segment's confidence comes from its words (its lowest word, or the share below the threshold). Parakeet's probabilities are on a different scale, so the threshold belongs to the engine.

## Extraction on the engines' transcripts (the downstream test)

Phase 2's extraction (qwen3:4b at 6144) on each candidate's transcripts of the three short meetings, after matching each speaker label to its participant, with citations translated to the key's turns by time. The three meetings have 70 findings in their keys. The typed transcripts were run before and after, in the same session.

| Transcripts | Clean: precision | Clean: recall | Hard: precision | Hard: recall |
| --- | --: | --: | --: | --: |
| Typed, before | 89% | 57% | | |
| Typed, after | 90% | 63% | | |
| **whisper.cpp large-v3-turbo, GPU** | **88%** | **61%** | 91% | 61% |
| … with the names hint | 86% | 64% | 79% | 50% |
| whisper.cpp small, GPU | 89% | 51% | 72% | 57% |
| Parakeet | 97% | 63% | 84% | 60% |
| whisper.cpp large-v3-turbo, CPU | 80% | 56% | 88% | 49% |

The typed runs differ by 6 points of recall with the same settings: Phase 2 saw the same spread (`EXTRACTION.md`).

**Against decision 8's bar** (recall within 10 points of the typed transcripts'): large-v3-turbo on the GPU (61%), Parakeet (63%), the names hint (64%) and large-v3-turbo on the CPU (56%) pass. **Small is on the line:** 51% is 12 points under the second typed run (63%) and 6 under the first (57%), so whether it passes depends on which run is the reference. It isn't recommended either way: large-v3-turbo is faster on the GPU and finds more. On these meetings, large-v3-turbo's transcripts cost extraction nothing measurable.

### How the scores were settled

The scorer lists "unclear pairs", where a proposal may match a key finding (`eval/README.md`), and counts any pair nobody has settled as no match. Phase 3's 27 extraction runs had 1,231 of them. All are settled, by independent subagents as in Phase 2, on 13 November 2026:
- **Blind:** each pair was shown with only its two statements and kinds, with no run name, transcript or score, in shuffled order, split across nine subagents in two rounds.
- **The rule** was Phase 2's, written out again from its 151 settled pairs, since only the answers had been kept. Answer yes when both make the same main point, so a consultant would treat one as a record of the other, whatever their kinds. Answer no when they only share a topic or passage, when the finding is a side detail of the proposal, or when the proposal's main point is something else. In doubt, no.
- **Checked against Phase 2:** 30 of Phase 2's settled pairs were hidden in each round. The subagents agreed with Phase 2's answers on 28 of 30 both times (93%; Cohen's κ 0.86 and 0.83).
- **Checked against each other:** a second subagent settled a random 10% again (50 pairs, then 73). They agreed on 92% and 90% (κ 0.80 and 0.81). In the second round, 6 of the 7 disagreements were the second subagent saying yes, so the settled scores lean, if anything, slightly strict.
- **The hard cases** were proposals stating one half of a two-part finding (two go-live dates, for example), and a problem set against the feature that solves it ("we lose 100 bins a year" against "track the co-op's bins"). Subagents split on the second kind.

The answers are in the runs' `*.matches.csv` files.

## The hour-long meeting

### Part sizes (Phase 2's question 2)

Extraction of the hour-long meeting (96 findings in its key) at three part sizes:

| Transcript | Parts of | Proposed | Precision | Recall | Time |
| --- | --: | --: | --: | --: | --: |
| Typed | 4096 | 240 | 61% | **82%** | 1,329 s |
| Typed | 6144 | 132 | 73% | 70% | 821 s |
| Typed | 8192 | 121 | 79% | 58% | 732 s |
| large-v3-turbo + ERes2Net 0.7 | 4096 | 235 | 65% | **83%** | 1,305 s |
| large-v3-turbo + ERes2Net 0.7 | 6144 | 120 | 76% | 65% | 861 s |
| large-v3-turbo + ERes2Net 0.7 | 8192 | 129 | 71% | 54% | 731 s |

**6144 doesn't find the most on an hour-long meeting: 4096 does,** by 12 to 18 points. It costs 11 to 12 points of precision, about twice the proposals for the consultant to review (235 to 240, against 120 to 132), and about 1.6 times as long (22 minutes, against 14). Settling the scores widened the gap rather than closing it. Phase 2 chose 6144 on short meetings, where it was within 2 points of 4096 at far higher precision. Each size was run once, and single runs vary by about 6 points.

### End to end

The minutes from the end of the meeting to the proposals, with ERes2Net at 0.7 and extraction at 6144:

| Words | Order | Words | Speakers | Extraction | Total |
| --- | --- | --: | --: | --: | --: |
| **large-v3-turbo, GPU** | **one after the other** | **2.8 min** | **17.8 min** | **11.6 min** | **32.2 min** |
| large-v3-turbo, GPU | words and speakers at once | 18.0 min (both) | | 12.8 min | 30.7 min |
| Parakeet ‡ | one after the other | 11.9 min | 13.5 min | 13.3 min | 38.7 min |
| Parakeet ‡ | words and speakers at once | 17.3 min (both) | | 11.5 min | 28.8 min |

‡ Measured at 90 °C or more (see [Heat](#heat)).

Speakers take most of the time, and their time varies (9 to 21 minutes per hour of meeting). So expect **about 25 to 35 minutes** from the end of an hour-long meeting to the proposals, and longer when the GPU is already hot. Extraction alone took 786 s one night and 1,130 s at 90 to 93 °C the next morning, on the same input. Running words and speakers at once saved 1.5 minutes with Whisper.

Extraction on these end-to-end transcripts found 60% to 68% of the 96 findings, at 64% to 76% precision, against 66% to 72% in three runs on the typed transcript at 6144.

### Sharing the GPU (decision 10)

Each candidate alone, then started 10 seconds after an extraction run of the typed hour-long meeting began:

| Words | Alone | During extraction | Extraction alone | Extraction alongside | Peak GPU memory together |
| --- | --: | --: | --: | --: | --: |
| large-v3-turbo, GPU | 160 s | 896 s (5.6×) | 786 s | 1,438 s (+83%) | 4.5 of 6 GB |
| small, GPU | 175 s | 792 s (4.5×) | 786 s | 1,223 s (+56%) | 4.5 of 6 GB |
| large-v3-turbo, CPU ‡ | 3,129 s | 3,380 s (+8%) | 786 s | 808 s (+3%) | 3.6 of 6 GB |
| Parakeet, CPU | 563 s | **not measured** | 1,130 s ‡ | not measured | |

- **On the GPU, sharing costs more than waiting.** Transcription ran 4.5 to 5.6 times slower, and extraction up to 83% slower. One after the other, the pair would take 160 + 786 = 946 s; together, the extraction by itself took 1,438 s. They fit in the GPU's memory together, so unloading Ollama first isn't needed for memory.
- **On the CPU, sharing costs little in time** (+8% and +3%), but it held the GPU at 90 to 93 °C for about 9 minutes.
- **Parakeet during extraction wasn't measured.** The laptop cut out six minutes into that run, at 94 °C (below). It isn't run again. Waiting for the GPU to cool before a step can't stop heat building during it, and the CPU pair above already shows CPU transcription alongside GPU extraction.

## Live (decision 11)

The first 20 minutes of the hour-long clean meeting, fed in 30-second pieces at real-time pace. Each piece is transcribed when it's complete. "Lag" is from the end of a piece to its text; "word delay" is from a word being spoken to its text, which includes waiting for the piece to end.

| Engine | Ollama | Lag, median | Lag, 90th percentile | Lag, worst | Word delay, mean | Word errors |
| --- | --- | --: | --: | --: | --: | --: |
| large-v3-turbo, GPU | idle | 2.5 s | 2.6 s | 5.6 s | 18.0 s | 4.4% |
| large-v3-turbo, GPU | extracting | 11.6 s | 23.7 s | 25.1 s | 27.8 s | 4.4% |
| Parakeet, CPU | idle | 4.6 s | 4.8 s | 5.6 s | 19.9 s | 3.8% |
| Parakeet, CPU ‡ | extracting | 6.6 s | 9.9 s | 12.0 s | 22.3 s | 3.8% |

No piece failed. Whisper's live word errors are a little high: in some 30-second pieces whisper.cpp wrote a segment's tokens with ends before their start, and the reader of the time split their words ("P reci ous" for "Precious"). The reader is fixed and tested; the live records hold the words, not whisper.cpp's output, so they can't be read again. With Ollama extracting, Whisper's lag grew through the run, to 24 s per 30-second piece by the end: close to falling behind for good.

**What "live" can mean on this laptop:** text about 20 seconds behind the speaker, with nothing else running, and **without speakers**. Speakers need the whole recording, and take 9 to 21 minutes per hour after it ends. Live words would let the consultant glance at what was said. The transcript that's added, with speakers and confidence, still comes after the meeting. Under the one-heavy-job rule below, live transcription and extraction never run together.

## Heat

**The laptop cut out on 13 November at 12:55.** Windows logged the unexpected shutdown (Kernel-Power event 41, EventLog 6008) with no bugcheck, no power-button press and no restart request before it (no event 1074). In other words, the power was cut. It happened six minutes into Parakeet's transcription during an extraction run. The GPU had been at 90 to 94 °C, its clock mostly held at 210 MHz, since Parakeet's end-to-end runs began about 100 minutes earlier. A heat cut-out is the likely cause; the event log can't confirm it.

- **Extraction alone held the GPU at 90 to 93 °C,** with its clock at 210 MHz, for 19 minutes (73 of 75 samples at 90 °C or more, 74 at 210 MHz).
- **Heat costs time as well:** the same extraction took 786 s one night and 1,130 s (44% longer) the next morning, at 90 to 93 °C.
- **The heaviest combined step cut the power.** Two GPU-hungry jobs at once, on a GPU already at 90 °C, is more than this laptop's cooling handles.

**Recommendation: StyleCode runs one heavy job at a time on this laptop,** whether it runs on the CPU or the GPU (decision 10). A transcription, a speakers run or an extraction run waits for the one before to finish, and says so.

From 13 November, every heavy step of the measurements first waits for the GPU to be under 70 °C (`coolGpu` in `spikes/transcription/steps.ts`), and logs the wait. This gives the laptop room to breathe and starts every timing from the same temperature. It was added after the cut-out, so every result in this document was measured without it.

### Results measured at 90 °C or more (‡)

| Result | GPU at 90 °C or more |
| --- | --- |
| Parakeet end to end, one after the other | 10 min of 39, peak 94 °C |
| Parakeet end to end, words and speakers at once | 4 min of 29, peak 91 °C |
| Extraction alone, before Parakeet's GPU-sharing pair | 18 of 19 min, peak 93 °C |
| large-v3-turbo on the CPU during extraction | 9 of 56 min, peak 93 °C |
| Live, Parakeet, Ollama extracting | about 15 of 20 min, peak 93 °C |
| Briefly (one to twelve 15-second samples): large-v3-turbo end to end, both orders, and its extraction alone; live Whisper with Ollama extracting; the names hint on one meeting | peak 90 °C |

The downstream extraction runs record no temperature. The rest of the words and speakers batches stayed at 60 to 89 °C.

## Follow-up measurements

Asked for at the check-in and run on 13 November 2026, from 14:29 to 15:38, with every step first waiting for the GPU to be under 70 °C (23 of the 26 waited, none for more than 105 s).

### Whisper writing into the pause: VAD, or no previous text

large-v3-turbo on the GPU, on all four meetings, clean and hard:
- **with VAD:** whisper.cpp's `--vad`, with Silero VAD v6.2.0 converted to ggml (`ggml-org/whisper-vad` at `9ffd54a`, MIT, pinned by SHA-256 in `spikes/transcription/files.ts`). Only the stretches it finds speech in are transcribed;
- **with no previous text:** `--max-context 0`, without VAD. Whisper no longer conditions each window on the text it wrote before.

| large-v3-turbo, GPU | Clean: errors | Hard: errors | Words in the hard hour's pause | Key terms, clean / hard | Minutes per hour |
| --- | --: | --: | --: | --: | --: |
| As measured above | 2.4% | 6.0% | 410 | 88.5% / 85.9% | 2.6 |
| With VAD | 3.2% | 4.3% | 3 | 86.0% / 86.0% | 2.0 |
| **With no previous text** | **2.3%** | **2.5%** | 8 | 87.5% / 87.5% | **1.7** |

- **VAD stops the pause, but costs 0.8 points on clean audio,** over the 0.5 allowed. Most of it is the clean hour-long meeting, where VAD cut real speech: 361 words missing, against 158.
- **No previous text stops it too, and costs nothing:** 8 words in the pause ("Thank you. Thank you. Thank you. There he…"), errors slightly lower on clean audio and less than half on hard. It also stopped plain Whisper dropping 158 words of the clean hour (27 now), and is the fastest.
- Words given the right speaker are unchanged (94.4% clean with ERes2Net at 0.7, against 94.3%).
- Extraction wasn't run again on these transcripts.

**One thing this changes:** with no previous text, Whisper is surer of itself. At 0.7 it marks 5.3% of clean words and catches 38% of the wrong ones, against 6.9% and 46% before. At 0.8 it marks 7.8% and catches 49%. A mark on a segment's lowest word would still cover 59% to 61% of segments.

With VAD on, whisper.cpp v1.9.5 maps each segment's times back to the whole audio, but leaves its tokens' times on the clock of the speech alone. The reader (`src/workspace/transcription/whisper.ts`) puts them back with `{ vad: true }`, tested in `readers.test.ts`.

### Speaker fragments

ERes2Net at 0.7, dropping speech shorter than 1 s or 2 s (`--min-duration-on`; sherpa-onnx's default is 0.3 s). Means over the four clean meetings, then the hour-long meeting:

| Shortest speech kept | Labels per person | Wrong speaker | Speech with no speaker | Words to the right speaker | Hour, clean: labels | Hour, hard: labels |
| --- | --: | --: | --: | --: | --: | --: |
| 0.3 s (as measured above) | 2.85 | 5.1% | 1.8% | 94.3% | 34 | 53 |
| 1 s | 2.65 | 4.8% | 2.6% | 94.1% | 30 | 44 |
| 2 s | 2.20 | 3.9% | 5.6% | 93.4% | 21 | 34 |

- **2 s removes the most labels** (34 to 21 in the clean hour) and lowers the wrong-speaker share. But it leaves more speech with no speaker: 5.9% of the clean hour, and 11.2% of Veldt Vets, against 0.5% and 5.4%. Words in that speech get no speaker, and the share of words given the right speaker falls (92.7% in the clean hour, against 94.5%).
- **1 s changes little:** 30 labels in the clean hour.
- **Short labels hold little talk.** At 0.3 s, 26 of the clean hour's 34 labels hold under 30 s each, 148 s in all (4.6% of the talk); at 2 s, 13 of 21, 103 s (3.4%). In the hard hour at 0.3 s, 42 of 53, 224 s (7.1%).
- **Merging a turn under 3 s into its neighbours, when both are the same label,** removes few labels and puts more speech under the wrong person: in the clean hour at 0.3 s, 34 labels become 26, and the wrong-speaker share rises from 5.7% to 8.2%; at 2 s, 21 become 20 (4.0% to 5.1%). The short turns between two of someone's turns are often another person's interjection. It isn't worth doing.
- **Hiding short labels would hide people.** In Karoo Freight, Lerato Dlamini, a guest who wasn't asked for consent, speaks for 13 s in all, under one label holding 11 s at every setting; Pieter van Wyk's only label holds 28 s. A rule hiding labels under 30 s would drop both from the C11 warning. Ruan du Toit, the hour's late guest, keeps a label of 184 s or more at every setting.
- **The CPU timing again:** these runs took 8 to 10 minutes per hour of meeting, against 19 to 21 for the same setup the night before. The setting doesn't explain it: the 0.8 run made the same morning took 9.

## Recommendation

Decision 8's rule: the fastest setup whose transcripts keep extraction's recall within 10 points of the typed transcripts', and give at least 90% of words the right speaker on the clean meetings.

- **Engine and model: whisper.cpp with large-v3-turbo (5-bit), on the GPU.** It's the fastest that passes: 2.6 minutes per hour, 2.4% word errors on clean audio, 94% of words to the right speaker, and extraction recall of 61% on its transcripts, between the two typed runs' 57% and 63%. Without an NVIDIA GPU, **Parakeet on the CPU** (11 minutes per hour, and no burst of invented words in noise) is the fallback, not Whisper on the CPU (49 minutes per hour).
- **Speakers: sherpa-onnx with ERes2Net at threshold 0.7, without the count.** Giving the count merges people.
- **The names hint: no.** It hurt clean audio.
- **The GPU order: one heavy job at a time,** CPU or GPU, the second waiting and saying so. The measured cost of sharing (5.6× slower transcription, 83% slower extraction) and the cut-out both point the same way. Unloading Ollama before a transcription isn't needed for memory (they fit together), only if a model is still loaded when a transcription starts.
- **Confidence threshold: 0.7** on Whisper's word confidence. It marks about 7% of words and catches about half the wrong ones. (With `--max-context 0`, decided later, the same balance is at 0.8.)
- **From the end of an hour-long meeting to the proposals: about 25 to 35 minutes,** most of it speakers, one step after another.

## Decided at the check-in

The reviewer's answers at the WP3 check-in, 13 November 2026, on the user's behalf.

**Accepted:**
- whisper.cpp with large-v3-turbo-q5_0 on the GPU, without the names prompt.
- ERes2Net without the count. Its threshold waits for the speaker-fragment measurements below.
- One heavy job at a time, CPU or GPU, and no Ollama unload.
- About 32 minutes from the end of an hour's meeting to the proposals.
- **Slice B supports this one engine only.** Without an NVIDIA GPU that whisper.cpp's CUDA build can use, Transcribe isn't offered, and the session says why. Parakeet on the CPU is in `docs/ROADMAP.md` as the later fallback for computers without one.

**Confidence: words are marked, not segments** (this changes decision 19). At 0.7, a mark on a segment's lowest word would cover 60% of segments on clean audio and 64% on hard (large-v3-turbo with ERes2Net 0.7, the four meetings, 662 and 691 segments of about 20 words). A mark on everything gets ignored. A mark on the segment's mean probability goes the other way: under 2% of segments, hiding most doubtful words. So in WP4:
- a segment keeps its confidence (the mean word probability) and the character ranges of its words below 0.7;
- the transcript shows those words with a dotted underline, and "may be misheard" on hover, on focus and for screen readers.

**Part sizes:** 6144 stays for now. The choice waits for the settled scores (decided below).

**Speakers' CPU time** (9 to 21 minutes per hour for the same work) isn't chased. Estimates use the slower figure, as the 32 minutes above does. Slice B's estimate of how long a transcription will take uses the computer's own past speeds.

**The extraction scorer** writes `matches.csv` with LF line endings, as git stores them, so scoring again can't rewrite Phase 2's settled files.

**The records:** every run record cited here is in the repository: `eval/transcription/runs/`, `endtoend/`, `live/` and `extraction/`, and `eval/runs/p3-*`. They hold role-played text, times and resources, no audio and no paths.

### After the follow-up measurements

The reviewer's answers at the short check-in, 13 November 2026, on the user's behalf.

**Whisper runs with `--max-context 0`, and VAD stays off.** It stops the repetition (8 words in the pause, against 410), has fewer word errors on clean and hard audio, and is faster. Slice B uses it. Extraction wasn't run on its transcripts, so decision 8's downstream bar was met by the setting without it (61%); with fewer word errors, it is expected to do as well, but that isn't measured.

**The confidence threshold is 0.8** with `--max-context 0`: it marks 7.8% of words and catches 49% of the wrong ones, the balance 0.7 gave before. Words are marked, not segments, as decided above; the character ranges a segment keeps are of its words below 0.8.

**Speakers: ERes2Net at 0.7, with sherpa-onnx's default shortest speech (0.3 s).** 1 s and 2 s remove few labels and leave more speech with no speaker (2.6% and 5.6% on average, 11.2% of Veldt Vets at 2 s), and speech nobody is given can't be matched or warned about. Slice B handles the many labels in the interface, never by hiding them:
- the speaker list is sorted by talk time and shows each label's time;
- labels under 30 s sit in one group, collapsed under a summary line ("26 short labels, 2 min 28 s in all"), and each shows its own words so it can be matched by reading;
- a label can be matched from any of its segments in the transcript, as well as from the list;
- C11 never drops a label: the warning names the unmatched main labels and sums up the short ones by count and time, with a link to them;
- in the preview (decision 18), before the transcript is added and while the recording can still be played, the consultant can already match speakers and play a label's longest segment. Matches made there are kept when it's added.

This is shown at WP7's screens check-in.

**Part size: 6144 stays.** 4096 finds more on the hour-long meeting (82% to 83%, against 65% to 70%), but with about twice the proposals to review, lower precision and 1.6 times the time. On Phase 2's short meetings it gained 2 points of recall for 14 of precision. The likely cause: at 4096 a part holds about 500 tokens of transcript, against 2,036 at 6144, so it may be the transcript per part that matters, not the context size. And 8192 didn't test bigger parts: `PART_CONTEXT` (`src/workspace/extraction/prompt.ts`) caps a part's context at 6144, so 8192 made the same 13 parts. Both are open questions below.

## Open questions

For WP11 to carry into the Phase 4 notes:
- **Transcript per part.** Recall on the hour-long meeting may depend on how much transcript a part holds rather than on the context size: 500 tokens at 4096 found 82% to 83%, 2,036 at 6144 found 65% to 70%. A tuning question, for example 6144 with about 1,000 tokens of transcript per part, measured for recall, precision, proposals per hour and time.
- **The part cap.** `PART_CONTEXT` caps parts at 6144, so a larger context setting doesn't make larger parts. Any test of bigger parts has to raise the cap.

## Risks

- **Real speech is harder** (decision 1). Accents, names, crosstalk and a laptop microphone will raise every error rate here. WP8's re-recorded meeting is the first real-room check.
- **Whisper repeats itself into long pauses** (410 words in the hard hour's two-minute pause), and the repetition passes the evidence check. `--max-context 0` brings it down to 8 words at no cost to accuracy ([Follow-up measurements](#follow-up-measurements)). It's still worth the "may be misheard" marking and the consultant checking a finding against the audio (decision 21).
- **Many speaker labels on long meetings:** 34 for 5 people in the clean hour, 53 in the hard one, most of them holding under 30 s. Matching them is real work for the consultant. Dropping speech under 2 s brings it to 21 and 34, but leaves more speech with no speaker. Hiding short labels isn't safe: an unasked guest may speak for only seconds. Slice B groups them instead (decided above).
- **Heat:** sustained jobs hold the GPU at 90 °C or more and slow it by up to 44%. Two at once cut the power. Better cooling (a raised back, clean vents, a cooling pad) would help every time here.
- **The extraction scores rest on subagents' judgement** of 1,231 unclear pairs, and they split on a few kinds of pair (see "How the scores were settled"). Their agreement with Phase 2's answers and with each other (90% to 93%) puts that uncertainty at a few points of recall, smaller than one run's spread.
- **Speakers' CPU time varied two-fold** for the same work, for a reason not found.
