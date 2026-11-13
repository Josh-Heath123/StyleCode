# The extraction evaluation set

How well the AI proposes findings from a meeting, measured the same way every time (Phase 2 brief, WP5; old WP7 in `docs/phase-0/PHASE-0-BRIEF.md`). The results are in `docs/research/EXTRACTION.md`.

Every meeting here is role-played: the people, companies and numbers are made up. No real client data and no audio go in this folder.

## The consultations

| Folder | Meeting | Exported as | Turns | Findings in the key |
| --- | --- | --- | --: | --: |
| `bosveld-citrus-intake` | A citrus co-op's intake and grower system, an hour long (Phase 3, decision 4) | Microsoft Teams `.vtt` | 555 | 96 |
| `karoo-freight-kickoff` | A freight company's dispatch app (the Phase 2 samples) | Microsoft Teams `.vtt` | 31 | 20 |
| `veldt-vets-booking` | Online booking for three vet clinics | Zoom saved transcript `.txt` | 59 | 25 |
| `umoya-school-portal` | A school's parent portal | Google Meet `.txt` | 59 | 25 |

Each folder has:
- `consultation.json`: the meeting's title, start and time zone, the export it comes from, and who is on which side;
- the export itself (Karoo Freight's is in `docs/phase-2/samples/`);
- `transcript.json`: the segments, as StyleCode's importer reads the export (`npm run eval:build` makes it);
- `answer-key.json`: the findings a careful consultant would record, each with its kind, status and the turns that support it;
- `README.md`: the scenario, and a note on consent.

**The keys.** The reviewer (Claude) drafted Karoo Freight's key, and a subagent drafted the other two. Then a subagent that hadn't seen how they were written checked all three against the transcripts. Bosveld Citrus's key (Phase 3) was drafted by a subagent and checked by another that hadn't seen how it was written, including the findings added when the meeting was lengthened (B77 to B96). The user may correct them at any time: edit `turns`, `kind`, `status` or `statement`, then run `npm run eval:build`, which fills in the segment ids. A key's `alsoAccept` lists other kinds a careful consultant could reasonably choose, and a match on any of them counts.

## Running and scoring

```bash
npm run eval:build                                  # transcripts and the keys' segment ids, after any change
npm run eval:run -- --model qwen3:4b                # runs extraction through a local Ollama, into eval/runs/qwen3-4b/
npm run eval:run -- --model qwen3:4b --context 4096 --label qwen3-4b-ctx4096   # the same with smaller parts
npm run eval:score                                  # scores every recorded run, then a summary with minutes per hour of meeting
```

`eval:run` also takes `--think on|off|default` (Ollama's `think`; the app sends `off`), `--max-tokens` (the reply limit per part; the app's is 3000, and a thinking model's reasoning counts against it), `--cpu` (keeps the model off the GPU) and `--hardware` (how the run describes the computer). It unloads the model first if it is loaded, then loads it before the clock starts. Run one at a time: two runs at once share the GPU and spoil each other's times. A re-run makes new proposals, so delete that folder's `*.matches.csv` first.

**Minutes per hour of meeting** is the time a run took over the meeting's length. A meeting exported without times (Google Meet) is timed from its words, at the speaking rate of those with times. These meetings are 5 to 15 minutes long and mostly fit in one part, so for an hour-long meeting, which takes several parts with overlap, expect somewhat more.

`eval:run` uses StyleCode's own extraction code (`src/workspace/extraction/`) and the AI server's Ollama adapter, so it measures what the app does. It never runs in CI.

**The scorer** (`eval/scorer.ts`):
1. Checks every proposal: each cited segment must exist, and the quoted words must appear in it. A proposal that cites a segment that doesn't exist, or quotes words that aren't there, has **invented evidence**. A proposal that fails any check counts against precision, whatever it says.
2. Matches the rest to the key. A proposal matches a key finding **automatically** when they cite a segment in common and its kind is one the key accepts.
3. Lists **unclear pairs** in `eval/runs/<model>/<consultation>.matches.csv`: a segment in common but another kind, or the same kind and similar words but no segment in common. Write `yes` or `no` in the last column, then score again. An unclear pair nobody has settled counts as no match.
4. Reports, per kind and in total:
   - **precision**: the share of proposals that match a key finding;
   - **recall**: the share of key findings that some proposal matches;
   - **invented evidence**: the share of proposals that cite it.

   A second proposal for a finding already matched is a **duplicate**. It counts as correct, and the duplicates are reported. The scorer reads the run’s raw proposals, before the app leaves out repeats (`checkProposals`), so "proposed" can be more than the consultant would see; the app’s own counts are in each run file’s `dropped` and `shown`. **Status agrees** counts matched proposals whose status is the key's, where the key's "confirmed" counts as the AI's "suggested", since only the consultant confirms.

**In CI**, `eval/scorer.test.ts` tests the scorer, and `eval/recorded.test.ts` checks that every transcript and key is up to date and that one recorded run still scores as it did.
