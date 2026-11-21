# The canvas AI with the record: a live check on the user's laptop

Workspace Phase 4, decision 24 (WP9 and WP10). The check asks qwen3:4b in Ollama for 8 design changes on two role-played engagements, Harbour Bakery and Karoo Freight. Each request is made twice through StyleCode itself: once with the engagement's record of confirmed findings, and once without it. The runner is `spikes/canvas-ai/live.ts`, the engagements, designs and the key of relevant findings are in `spikes/canvas-ai/records.ts`, and the launcher is `spikes/canvas-ai/start-live-check.cmd`.

**What this is and isn't.**
- Every company, person and finding is role-played.
- Each request was made once with the record and once without, in a single run. One run of 16 replies at temperature 0.2 can't support a general claim about the model, the record or the prompt.
- There is no pass mark (decision 24). The numbers below describe this run.

There were two runs. The first, on 20 November 2026, got no reply at all, because qwen3:4b was left to think. It is reported below, as a finding. The second, on 21 November 2026, is the one the results come from.

| | |
| --- | --- |
| Computer | Intel Core i7-12700H, 16 GB RAM, NVIDIA RTX 3060 Laptop 6 GB (as in `EXTRACTION.md`) |
| Ollama | 0.40.16 |
| Model | `qwen3:4b` (359d7dd4bcda), context 8192, `think: false` |
| Power | Plugged in, OMEN Balanced mode, lid open (recorded by the launcher). The GPU's clocks and temperature weren't logged. |
| StyleCode | `ac58b9a`, run with `npm start` (port 4173) and a data folder of the check's own |
| Records | Harbour Bakery, 20 confirmed findings; Karoo Freight, 18, of which 2 are left out because their session's consent didn't tell the client the AI may help sketch screens |
| Results | `eval/canvas-ai/runs/2026-11-21T07-29-27-726Z/results.json` (second run), `eval/canvas-ai/runs/2026-11-20T14-04-32-082Z/results.json` (first run) |

## The second run (21 November 2026)

### Per request

**Validated** means the reply became a proposal to review. **Repair** means the first reply didn't fit the design and StyleCode asked the model once more with the problems listed. It doesn't mean the second reply fitted. **Model time** runs from the first request to the model to the end. **Total** adds the wait before it (the heavy slot and the cooling pause, with the record only).

| Request | Record | Validated | Repair asked | No changes | Cited | Every cited offered | Cited a relevant one | Ids not offered | Model time | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --: | --: | --: |
| harbour-pay | with | no | yes | no | none | – | no | 0 | 11.5 s | 11.8 s |
| harbour-pay | without | no | yes | no | none | – | – | 0 | 7.9 s | 7.9 s |
| harbour-date | with | no | yes | no | none | – | no | 0 | 7.9 s | 8.0 s |
| harbour-date | without | no | yes | no | none | – | – | 0 | 8.1 s | 8.1 s |
| harbour-collect | with | **yes**, after repair | yes | no | hf_hours, hf_mondays | yes | **yes** (hf_hours) | 0 | 44.9 s | 45.1 s |
| harbour-collect | without | no | yes | no | none | – | – | 0 | 144.0 s | 144.0 s |
| harbour-message | with | no | yes | no | none | – | no | 0 | 38.3 s | 38.4 s |
| harbour-message | without | no | yes | no | none | – | – | 0 | 46.9 s | 46.9 s |
| karoo-card | with | no | yes | no | none | – | no | 0 | 90.2 s | 90.3 s |
| karoo-card | without | no | yes | no | none | – | – | 0 | 49.3 s | 49.3 s |
| karoo-done | with | no | yes | no | none | – | no | 0 | 89.5 s | 89.5 s |
| karoo-done | without | no | yes | no | none | – | – | 0 | 41.2 s | 41.2 s |
| karoo-offline | with | **yes**, after repair | yes | no | kf_sun, kf_large_text | yes | no | 0 | 67.4 s | 67.5 s |
| karoo-offline | without | **yes** | no | no | none | – | – | 0 | 24.6 s | 24.6 s |
| karoo-sun | with | **yes** | no | no | kf_sun | yes | **yes** | 0 | 11.9 s | 12.1 s |
| karoo-sun | without | no | yes | no | none | – | – | 0 | 17.8 s | 17.8 s |

Every request with the record offered the whole record: 20 findings for Harbour Bakery, 16 for Karoo Freight. Nothing was cut for the budget. Every request offered both or all of the key's relevant findings for it (2, or 3 for karoo-done).

### Summary

| | With the record | Without |
| --- | --: | --: |
| Requests | 8 | 8 |
| Validated | 3 | 1 |
| … of those, after a repair | 2 | 0 |
| Repair asked | 7 | 7 |
| Errors (still didn't fit after the repair) | 5 | 7 |
| Cut off for length | 0 | 0 |
| No changes | 0 | 0 |
| Cited at least one finding | 3 | – |
| Cited one the key marks relevant | 2 | – |
| Ids cited that weren't offered | 0 | – |
| Median model time | 41.6 s | 32.9 s |
| Longest model time | 90.2 s | 144.0 s |
| Model time, all 8 | 361.5 s | 339.9 s |

- **The median** is the mean of the two middle values of eight. `results.json`'s summary holds 44.9 s and 41.2 s instead, because the runner then took `times[length / 2]`, the upper middle value. It now averages the two (`spikes/canvas-ai/live.ts`); the file is left as recorded.
- **Compare times by model time only.** "Without the record" is made by giving the assistant no record (`setRecord(null)`), which also skips the heavy slot and the cooling pause. So total time isn't comparable between the two. In this run the wait added at most 0.26 s to any request with the record: no request waited for the graphics card to cool.
- **Model time includes the repair,** where there was one: 14 of the 16 replies are two requests to the model, and 2 are one. A pair's times therefore aren't like for like when only one of them was repaired.
- **The whole run** took 12 minutes (07:29:28 to 07:41:27 UTC), including starting StyleCode, seeding the two clients and loading the model. The 16 requests took 11.7 minutes of that.
- **No page errors,** and no reply was cut off for length. Every error was the same message: "The AI’s changes didn’t fit the design, so nothing was changed."

### What the replies got wrong

The 12 replies that still didn't fit after the repair broke three of the design's rules. Several broke more than one.

| Problem left after the repair | Replies (with / without the record) |
| --- | --: |
| Changed a layer that wasn't marked as changeable (`isn’t one of the layers you may change`) | 5 (2 / 3) |
| Put a new layer somewhere other than inside or next to a marked layer | 6 (2 / 4) |
| Set a property a rectangle doesn't have (`text`, `textResize`, padding, mobile text settings) | 4 (2 / 2) |

So most failures are about the design's structure, not the record, and they are as common without the record as with it.

### Reading it

- **The record didn't make replies validate less often** in this run: 3 of 8 with it, 1 of 8 without. With 8 a side, that difference is within what chance gives, so it shows only that the record didn't visibly hurt.
- **Every cited finding was one it was offered,** and no reply named an id it wasn't given. So the case decision 24 asks to report, with a recommendation such as a smaller share of the budget, didn't occur.
- **When a reply with the record validated, it cited findings,** 3 of 3. 2 of the 3 cited one the key marks relevant. The third, karoo-offline, cited the sunlight and large-text findings for an offline indicator rather than kf_offline or kf_sync_state.
- **qwen3:4b fails most canvas requests on these designs either way.** 12 of 16 replies didn't fit after a repair, and the repair rescued 2 of 14. That is the larger finding for Phase 5: the model's grip on which layers it may change, where new layers may go and which properties a layer has, not the record.
- **Times vary a lot from request to request,** from 8 s to 144 s, on the same model and settings. The GPU's clock wasn't logged, and `EXTRACTION.md` found single times on this laptop noisy by up to about 3×.

## The first run (20 November 2026): thinking left on

The first run, started at 14:04:32 UTC, got no reply for any of its 16 requests. Each ended after 120 s with "The model stopped responding (nothing for 2 minutes)." The run took 32 minutes.

**Why.** Canvas requests didn't yet send `think` to Ollama, so qwen3:4b, a thinking model, reasoned first. Ollama streams the reasoning in `message.thinking`, which never reaches the reply, so the page saw nothing for 2 minutes and gave up. Measured afterwards on the same laptop (Ollama 0.40.16, qwen3:4b entirely on the GPU), with one of the check's requests:
- with no `think`: 1,926 thinking chunks and no reply text in 90 s;
- with `think: false`: the first reply text at 0.45 s, the whole reply in 17 s, JSON matching the format.

**What changed.**
- Canvas requests to Ollama now send `think: false`, as extraction already did, on engagement designs and in the standalone editor alike (`5312b48`).
- A thinking model's reasoning now counts as activity, never as reply text: the AI server relays a `{"thinking":true}` line at most every 5 s, so a model that reasons is no longer mistaken for one that stopped (`6646f00`).
- The browser tests' fake Ollama now thinks first unless it's sent `think: false`, as qwen3 does, so the tests would have caught this. Before, it never thought, which is why the tests passed and the live check didn't.

Its `results.json` is committed beside the second run's.

## Sources

- The runs' results, above. The progress log and the console's output stay on the laptop, git-ignored.
- `docs/research/EXTRACTION.md`: the laptop, its GPU's clock, and thinking with extraction.
- Ollama's thinking documentation, <https://docs.ollama.com/capabilities/thinking>, read 21 November 2026.
