# Extraction: what local models can do on the user's laptop

Phase 2, WP6. Measured on 11 November 2026 with `npm run eval:run` and `npm run eval:score` (see `eval/README.md`), on the three role-played consultations of the evaluation set. Every run used StyleCode's own extraction code: prompt version 2, the JSON schema, chunking, and the AI server's Ollama adapter.

## The computer

| | |
| --- | --- |
| CPU | Intel Core i7-12700H |
| RAM | 16 GB (2 to 3 GB free while the runs went, with the usual apps open) |
| GPU | NVIDIA GeForce RTX 3060 Laptop, 6 GB, plus the Intel Iris Xe |
| Disk | C: 475 GB, 4 to 12 GB free during the runs |
| Ollama | 0.40.16 |
| Models | `qwen3:4b` (359d7dd4bcda, 2.5 GB), `qwen3:8b` (500a1f067a9f, 5.2 GB), `gemma3:4b` (68ceab7e468a, 3.4 GB), all Ollama's default 4-bit builds |

**The GPU is held back.** Under load it runs at about 250 MHz of its 2,100 MHz, drawing about 30 W at 77 to 81 °C. NVIDIA reports the software power cap and thermal slowdown as the reasons (`clocks_event_reasons` 0x24). qwen3:4b, entirely on the GPU, writes about 10.6 tokens a second and reads about 180. On the CPU alone (`num_gpu` 0) it writes 8.8 and reads 38. So the GPU still reads a transcript about five times faster than the CPU. After an idle hour the GPU ran faster for about a minute, then slowed again. That makes single times noisy, by up to about 3× between meetings of similar length. Over an hour-long meeting, the slowed speed is the one that counts.

## Results

Each row covers all three consultations: 31, 59 and 59 turns, 70 findings in the keys, 25 minutes of meeting in all. **Minutes per hour** is processing time over meeting time.

| Model | Thinking | Context (parts) | Proposed | Precision | Recall | Invented evidence | Minutes per hour of meeting |
| --- | --- | --- | --: | --: | --: | --: | --: |
| qwen3:4b | off | 8192 (1 each) | 57 | 96% | 61% | 0% | 24 |
| **qwen3:4b** | **off** | **6144 (1, 2, 2)** | **59** | **98%** | **69%** | **2%** | **25** |
| qwen3:4b | off | 4096 (3, 6, 7) | 81 | 84% | 71% | 1% | 15 * |
| qwen3:8b | off | 8192 (1 each) | 49 | 90% | 56% | 10% | 41 |
| gemma3:4b | (none) | 8192 (1 each) | 52 | 69% | 41% | 23% | 18 |

\* The GPU was cool at the start of this run: Karoo Freight took 28 s and the school portal 50 s, then the vets' meeting took 293 s. With the GPU slowed throughout, expect about 30.

**Thinking on** (Karoo Freight only, 4.6 minutes, 20 findings):

| Model | Thinking | Reply limit | Precision | Recall | Time | Minutes per hour |
| --- | --- | --: | --: | --: | --: | --: |
| qwen3:8b | off | 3000 | 91% | 50% | 183 s | 39 |
| qwen3:8b | on | 12000, context 16384 | 100% | 55% | 285 s | 61 |
| qwen3:4b | on | 3000 (the app's) | none | none | reply cut off | – |
| qwen3:4b | on | 12000, context 16384 | – | – | unfinished after 14 min | over 180 |

- With the app's 3,000-token reply limit, qwen3:4b spent every token reasoning, and the reply was cut off before any finding.
- With room to think, qwen3:4b no longer fit on the GPU (21% on the CPU). It hadn't finished the 4.6-minute meeting after 14 minutes, when the run was stopped to free memory.
- qwen3:8b with thinking was slightly more accurate on one meeting (one more finding), and took 1.6 times as long. That is longer than the meeting itself.

**What the columns mean.**
- **Precision** is the share of proposals that match a finding in the key.
- **Recall** is the share of the key that some proposal matches.
- **Invented evidence** counts proposals citing words that aren't in the cited passage. StyleCode drops these before the consultant sees them.

A subagent that hadn't seen the scores settled the unclear pairs (132 of them) with one written rule. The rule and its hard cases are in the `*.matches.csv` files under `eval/runs/`.

## Is local extraction practical on this laptop?

**Yes, with qwen3:4b and thinking off.** It takes about 25 minutes per hour of meeting: faster than the meeting itself, so a consultant can run it straight after the meeting and have proposals in under half an hour. For a real hour-long meeting, expect somewhat more than these 5 to 15 minute meetings show, because an hour takes 6 to 7 parts, each repeating the end of the one before.

**Some combinations take longer than the meeting:**
- qwen3:8b comes close at about 40 minutes per hour, and is less accurate here. At 5.2 GB it doesn't fit in the 6 GB GPU with its context, so a third of it runs on the CPU.
- Any Qwen model with thinking on takes longer than the meeting.
- With the CPU alone, the transcript is read about five times more slowly.

**What would help, most first:**
1. **Let the GPU run at full speed.** Set the laptop's vendor app (or Windows' power mode) to its performance setting, plugged in, and check the cooling (vents and fans). At its normal clocks this GPU should be several times faster. That has not been measured here, so measure it again after the change.
2. **Stay with a model that fits in the GPU's 6 GB:** a 4B model at 4-bit, context 8192 or less.
3. **Keep thinking off for extraction.** The app already sends `think: false` to Ollama.
4. **Leave memory free.** With 16 GB, the runs left 1 to 3 GB free, and Claude Code once stopped them for low memory. Close the browser and WSL during a long run.
5. **Leave room on C:.** A model download filled the disk once.

## Recommendations

- **Default model: `qwen3:4b`, thinking off.** It had the best precision and recall here, never invented evidence at 8192, and fits entirely on the GPU. gemma3:4b was faster, but missed most of the key and invented evidence in nearly a quarter of its proposals. That included a wrong number: it quoted "about a hundred and sixty a day" where the client said a hundred and twenty. StyleCode's checks caught it.
- **Part size: about 6144 tokens of context per part, whatever the context setting.** Smaller parts found more: the model seems to stop at around 20 findings a reply, however long the part. At 6144, recall rose 8 points over one part per meeting, at much the same precision and speed. At 4096 it rose 2 points more, but precision fell to 84%, because so many small parts repeated and split findings. This rests on three short meetings, so measure it again on the first real hour-long transcripts. **Not yet in the app:** parts are still sized from the context setting (default 8192). It needs your decision.
- **Prompt:** keep version 2 (`src/workspace/extraction/prompt.ts`).
- **Small fix to consider:** gemma3, and qwen3:8b once, ended otherwise exact quotes with "…", which fails the check. Removing a leading or trailing ellipsis before the check would keep the guarantee, because every remaining word must still appear in the passage. Not made: it changes what counts as evidence, so it needs your decision.

## What StyleCode can promise

On these role-played meetings, with qwen3:4b:
- **Every quote shown is real.** The cited passage exists and contains the quoted words, so StyleCode never shows invented evidence (WP6 checks). The **statement**, the AI's summary, is not checked against the quote, and can be wrong even when the quote is right.
- **Most proposals are right:** about 19 in 20 matched a finding a careful consultant would record. Read every one anyway.
- **About a third is missed:** it found about two thirds of the key. The AI is a first pass, not a record of the meeting. The consultant still reads the transcript, and their own findings stand beside the AI's.
- **Kinds and statuses are often debatable.** Most unclear pairs were the right finding under another kind (for example, "work offline" as a non-functional requirement rather than a constraint). The status agreed with the key for most matched proposals.

These numbers come from three role-played meetings with a written key, not from real clients. WP7's evaluation report will show what consultants accept, edit and reject in real use.

## How the interface should present uncertain findings

- **Quote first.** Show each proposal's quoted words, and on selection, its passage highlighted in the transcript. The quote is what's checked; the statement isn't.
- **Always marked as the AI's, never confirmed.** Proposals are separate from findings until accepted, with "AI-suggested" in words, not only colour. Only the consultant confirms (decision 8).
- **Assumptions and open questions stand out:** a status label on the card, and the client's hedging words in the quote ("I think", "probably").
- **Say what was dropped and why,** after each run: "2 proposals quoted words that aren't in the transcript".
- **Say what it can't do,** once, near the button: "The AI usually finds about two thirds of what was said. Read the transcript too."
- **Say how long it will take** before a run, from the transcript's length and the last run's speed. "About 25 minutes for an hour" is different from "about a minute", and the consultant may want to start it and come back.
