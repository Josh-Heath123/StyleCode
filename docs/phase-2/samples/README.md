# Sample transcripts for Workspace Phase 2

These replace "the user provides role-played sample exports" (MVP Q7). The user asked the reviewer (Claude) to produce them, so they are **reconstructions**, not downloads. They were built from each platform's documented or publicly shown export layout, on 2026-11-10. There are no real people, companies or meetings in them.

`karoo-freight-kickoff/` is one made-up consultation (4 min 40 s, four speakers), exported in every layout below. The meeting itself is in `meeting.json` (turns T1 to T31). Every file holds the same words, so a test can import each one and compare it with `meeting.json`.

## The meeting

- **Sam Naidoo:** the consultant.
- **Thandi Mokoena:** operations manager, Karoo Freight. Asked for consent.
- **Pieter van Wyk:** Bloemfontein depot manager. Asked for consent.
- **Lerato Dlamini:** IT contractor. Joins late (T20) and **was not asked for consent**, so the C11 check must list her. Teams labels her `Lerato Dlamini (Guest)`, which doesn't equal a participant's name, so she isn't matched automatically.

It covers most finding kinds:
- requirements and constraints (offline use);
- scale (peak days);
- existing systems;
- budget;
- a risk (load-shedding);
- open questions;
- future considerations;
- a decision.

`answer-key.draft.json` lists the findings a careful consultant would record, with the turns that support each. It is a draft for the evaluation set: the user hasn't reviewed it.

## The files, and how sure we are of each layout

| File | Platform and route | Layout | Confidence |
| --- | --- | --- | --- |
| `teams-transcript.vtt` | Teams, meeting → Recap or Transcript → Download → `.vtt` | Cue ids `<uuid>/<utterance>-<part>`. `<v Name>…</v>` voice spans. Long turns split across parts. Another speaker's cue can sit between two parts of one turn (T22 and T23), and cues overlap in time (T19 and T20). | High: sources 1 and 2 describe real files |
| `teams-graph-transcript.vtt` | Teams, through Microsoft Graph (what tools and admins export) | No cue ids. Voice spans. Each cue's timing line and text in separate blocks, with a blank line between. | High for voice spans (source 3). The split blocks come from an anonymised real Graph file (source 4). |
| `teams-transcript.docx` | Teams, Download → `.docx`, current layout | Title, date and length lines. "Name started transcription". Then per turn: a `Name<tab>0:03` line (time from the start, `m:ss`, or `h:mm:ss` after the first hour), the words, and a blank paragraph. | Medium: another project's test fixture (source 5). Spaces instead of the tab are also seen. |
| `teams-transcript-older-layout.docx` | Teams `.docx`, older layout | One paragraph per cue: `0:0:3.100 --> 0:0:6.24`, then the name, then the words, separated by line breaks inside the paragraph. **Milliseconds aren't padded:** `6.24` is 6 s 24 ms, not 6.24 s, as the real file's `5.300` and `2.90` show. | High: a real `.docx` in source 6 |
| `zoom-recording-transcript.vtt` | Zoom cloud recording, audio transcript | Numbered cues from 1, one line each, `Name: words`. Long turns split into several cues, each with the name. | High: sources 3 and 2 |
| `zoom-saved-transcript.txt` | Zoom "Save transcript" | `[Name] 10:00:03` (time of day, not time from the start), then the words, then a blank line. Windows line endings. | Medium: source 5 |
| `google-meet-transcript.docx` and `.txt` | Google Meet. The transcript is a Google Doc in the organiser's Drive, downloaded as Word or plain text. | A title line `<meeting> (2026-11-05 10:00 GMT+2) - Transcript`. `Attendees` and the list. `Transcript`. Time lines `00:00:00` (Meet adds one about every five minutes; this short meeting has one). `Name: words` paragraphs. `Meeting ended after 00:04:40 👋`. A disclaimer. The `.txt` starts with a byte-order mark. | High for the layout: a real Meet transcript published in W3C meeting minutes (source 7), and the doc title in source 8. The byte-order mark is likely but unconfirmed. |
| `google-meet-gemini-notes.docx` | Google Meet with Gemini: "Notes by Gemini", downloaded as Word | Gemini's **AI-written** summary (📝 Notes), then the transcript (📖 Transcript). **Only the transcript is what was said;** the notes must never be imported as segments. | Low for the details: source 8 confirms the two tabs and their titles; the layout inside them is reconstructed. |
| `pasted-transcript.txt` | Pasted by the consultant (MVP 4.2) | `Name: words` lines, some starting with `[mm:ss]`. One line without a speaker. | Matches the spec |

## What every importer has to allow for

These come from the sources, not from guesses:
- **Encodings.** Files may be UTF-8 with or without a byte-order mark, or UTF-16 with one (source 2's fixtures). Decode by the byte-order mark; otherwise read as UTF-8.
- **Line endings.** Both `\n` and `\r\n`.
- **Speakers.** Teams: `<v Name>`, which may carry classes (`<v.loud Name>`) and HTML entities (`O&#39;Brien`). Zoom: a `Name:` prefix. Inline tags such as `<i>` or `<c>` are removed from the words.
- **Turns split across cues.** Teams marks the parts with ids, and they can be interleaved and out of time order. Files without ids give no such grouping.

## When a real export differs

These layouts can change without notice. When the consultant imports a real export that StyleCode refuses, its message names the problem, and nothing is changed (MVP 4.1). The fix is then to:
1. type a new made-up sample in the layout that failed;
2. add it here;
3. support it.

Never add the real file.

## Sources (accessed 2026-11-10)

1. [warnov/vttcleaner, README](https://github.com/warnov/vttcleaner): an example of a Teams `.vtt` with `<uuid>/<n>-<m>` ids.
2. [gcapnias/yt-transcript, issue 15](https://github.com/gcapnias/yt-transcript/issues/15): notes on two real 30-minute Teams exports (ids, split and interleaved utterances, overlaps, order). [GreenJesterAt/webvtt-to-markdown](https://github.com/GreenJesterAt/webvtt-to-markdown): Teams and Zoom variants, and encoding fixtures.
3. [onyx-dot-app/onyx, pull request 14861](https://github.com/onyx-dot-app/onyx/pull/14861), `test_webvtt.py`: "a real Zoom audio_transcript.vtt shape", and the shape Microsoft Graph exports for Teams.
4. [GreenJesterAt/webvtt-to-markdown, issue 1](https://github.com/GreenJesterAt/webvtt-to-markdown/issues/1): split timing and voice blocks in a Graph Teams transcript.
5. [Prathyush-KKK/meeting-desk, pull request 35](https://github.com/Prathyush-KKK/meeting-desk/pull/35): Teams `.docx` and Zoom `.txt` layouts in its tests.
6. [endjin/TeamsTranscript](https://github.com/endjin/TeamsTranscript): a real Teams `.docx` transcript (`Artefacts/Transcripts/transcript-01.docx`).
7. [W3C Credentials Community Group minutes, 2026-08-04](https://lists.w3.org/Archives/Public/public-credentials/2026Aug/0005.html): a real Google Meet transcript (its layout only was used).
8. [dslh/gcal-transcripts](https://github.com/dslh/gcal-transcripts): Meet transcript doc titles, and the "Notes by Gemini" tabs.
9. [Google Meet Help: Use transcripts with Google Meet](https://support.google.com/meet/answer/12849897): transcripts are saved in the organiser's Drive.
