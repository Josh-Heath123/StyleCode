# Scoring transcription

How well an engine transcribed a test meeting and told its speakers apart (Phase 3 brief, decision 8), against the meeting's timeline (`eval/audio/<id>.timeline.json`). The speech is synthetic, so **every number here is a lower bound on errors** (`eval/audio/README.md`).

```bash
npm run eval:transcription                                               # every recorded run in runs/
npm run eval:transcripts -- whisper-turbo-gpu speakers-campplus-count clean   # the downstream test's transcripts
npm run eval:run -- --model qwen3:4b --context 6144 --transcripts eval/transcription/extraction/whisper-turbo-gpu+speakers-campplus-count.clean --label <name>
npm run eval:score -- <name>
```

**What it measures:**
- **Word errors** (`align.ts`, `normalise.ts`): substitutions, deletions and insertions over the script's words, after a normaliser that is the same for every engine. It ignores case, punctuation and fillers, writes numbers as digits however they were said, and makes British and American spellings the same. An engine's words are normalised together, so "a / hundred / and / twenty" over four words is still 120. The raw rate (lower case, no punctuation, nothing else) is given too. The alignment is the exact edit distance, computed with Hirschberg's method, so an hour of words needs no 10,000 × 10,000 table.
- **Key terms** (`terms.ts`): every number in the script, and every word it capitalises in the middle of a sentence (names, places, products), found or not. Kokoro's pronunciation of South African names is part of why some are missed.
- **Speakers** (`speakers.ts`): each engine label is matched to the person it overlaps most, as the consultant would match it. Then: how many labels against how many people; of the time one person speaks and the engine names someone, the share it names the wrong person; the time missed; speech where nobody spoke; and, with a words run, the share of the script's words given the right person.
- **Confidence** (`score.ts`): for thresholds from 0.2 to 0.9, the share of words below it, how many of those are wrong against the rest, and the share of all wrong words a "may be misheard" mark would catch (decision 19).
- **The downstream test** (`downstream.ts`, `build.ts`): the engine's words and speakers are put together as the app will put them (`src/workspace/transcription/combine.ts`), each speaker matched to a person, and the answer key's turns are translated to the engine's segments by their time in the timeline. Phase 2's extraction and scorer then run on that, unchanged.

**In CI**, `transcription.test.ts` tests each part, and `recorded.test.ts` scores one recorded run (`recorded/`), so the harness can't silently break. No engine runs in CI.
