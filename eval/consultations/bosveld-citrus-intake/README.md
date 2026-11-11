# Bosveld Citrus Co-operative: grower system, first consultation

Bosveld Citrus Co-operative, a made-up citrus packing co-operative in Letsitele near Tzaneen (Limpopo), wants to replace handwritten weighbridge tickets, a typed-up spreadsheet and a lever arch file with a system for intake, bin tracking and a grower portal. The hour-long meeting covers the weighbridge and the grader (WeighMate and the Optisort, with an uncertain export), Sipho's payment spreadsheet and LedgerOne, POPIA and who sees what, offline intake at the gate, volumes (with a corrected peak), the board's budget (fetched and corrected mid-meeting), a 1 March 2027 deadline, spray records for export, training and support, fruit sizes and tare weights, the holding area and degreening rooms, the export agent's weekly report, shared phones, a parallel run, and several questions left open.

It is the hour-long meeting of the Phase 3 brief, decision 4: it is turned into synthetic speech, one voice per speaker, to measure transcription and speaker attribution on a long meeting.

## Who is who

- **Ayesha Patel:** the consultant (consultant's side). Woman.
- **Johan Steenkamp:** general manager, Bosveld Citrus Co-operative (client). Man.
- **Precious Maluleke:** packhouse manager (client). Woman.
- **Sipho Ngobeni:** finance and grower accounts (client). Man.
- **Ruan du Toit:** the co-op's IT contractor (client), joins late as a guest. Man.

**The deliberately similar pair:** Johan Steenkamp and Sipho Ngobeni, both men, who often speak back to back (the budget correction at T275 to T283, the member count at T234 to T236). Ruan is a third man, so other male pairs exist too, and Ayesha and Precious are both women.

## Consent

This is a role-played meeting written for testing. There are no real people, companies or recordings in it, and the products named (WeighMate, Optisort, LedgerOne) are made up. In the story, Ayesha asks at the start (T1), and Johan, Precious and Sipho agree to the transcript and to the AI on her own computer (T2 to T4). Ruan du Toit joins late (T83), appears in the export as "Ruan du Toit (Guest)", and is never asked, as Lerato is in Karoo Freight.

## The file

`teams-transcript.vtt` is typed as a Microsoft Teams `.vtt` export, in the layout of Karoo Freight's: `WEBVTT`, then cues with ids `<uuid>/<utterance>-<part>`, timing lines and `<v Name>…</v>`, each turn split into parts of one to three sentences. Times start at 00:00:03.100 and end at 01:16:13; speech runs at about 160 words a minute, with gaps of 0.25 to 1 second between turns and the two-minute wait after T278.

- **Turns:** 555 (T1 to T555, as `eval/dataset.ts` counts them). No speaker has two utterances in a row, so each Teams utterance is one turn.
- **Words of speech:** 10,573. The first mix ran 47.6 minutes (Kokoro speaks about 175 words a minute), so 119 turns (T371 to T489, about 2,170 words) were added after T370; every turn from the old T371 on moved up by 119.
- **Interjections** (one or two words, by someone other than the person speaking, in the middle of their longer exchange, which continues after it): T10, T19, T29, T38, T49, T91, T101, T128, T135, T212, T261, T281, T318, T369, T374, T405, T443 (17).
- **The pause:** T278, "Let me grab the resolution, one sec, it's in the file on my desk." Sipho leaves, the others wait, and he is back at T280. The audio adds two minutes of silence after T278.
- **Corrections:** the peak of 1,800 bins a day (T221) becomes 2,400 at T228; "a hundred and forty" growers (T11, T234) becomes 162 members at T235; the budget of R650,000 (T275) becomes R580,000 excluding VAT at T282. In the added turns, tare weights updated "every month" become every season (T396), and the agent's report "every Friday" becomes Monday by nine (T430).

## The key

`answer-key.json` is the answer key (96 findings, 7 notFindings), written with the meeting by a subagent (Claude). All of it, including B77 to B96 and the notFinding on T457 to T460 from the added turns, was checked against the transcript by an independent subagent on 2026-11-11 (its `notes` list the changes). None of it has been reviewed by the user. It has more findings than the short meetings' keys because the meeting is about ten times as long.
