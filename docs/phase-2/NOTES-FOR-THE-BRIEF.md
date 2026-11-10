# Notes for the Workspace Phase 2 brief

Written at the end of Workspace Phase 1 (`docs/phase-1/HANDOVER.md`). Phase 2 is extraction: transcript import, AI proposals and their review, then company knowledge (`docs/ROADMAP.md`). These are the questions it inherits. None of them is decided; each needs the user.

## Deferred by the Phase 1 brief

These were Phase 0's open questions, kept out of Phase 1 on purpose (Phase 1 brief, "Deferred to the Phase 2 brief").

1. **AI context beyond a session's own transcript and notes** (Phase 0 open question 1). Rule C5 covers a session's transcript and notes. Extraction may also want the engagement's other findings, and later company facts and designs, which draw on other sessions. *The reviewer's recommendation in Phase 0:* check every finding, fact or design in an AI call against the sessions it draws on, leave out what fails, and say so.
2. **A status on company facts** (open question 3). An assumption can be promoted and then read as a fact. Options: copy the finding's status onto the fact (recommended in Phase 0), or promote only confirmed findings.
3. **Provenance when evidence changes** (open question 5). MVP 6.4 says attaching a transcript segment makes a finding "said in a session". Phase 1 sets provenance when a finding is created (`createFinding`) and never changes it. Derive provenance from the evidence, or make it an edited field with history?
4. **Statuses offered when accepting a proposal** (open question 6). MVP 6.2 offers confirmed, assumption or unresolved; the AI may propose "suggested", which the record now shows as a fourth group (decision 8).

## Left open by Phase 1

5. **Amending a locked record.** Importing a transcript locks the consent record (C4), so Phase 2 is the first time "Amend…" is needed. The model already takes amendments, including statements newly told (decision 3). One gap from the Slice B review: the model doesn't check that an amendment changing how long audio is kept was told the new retention words. The form handles this by unticking the statement.
6. **After a withdrawal** (C8): offer to delete the transcript, then list the findings and company facts that keep a statement from the session. `removeTranscript` does the deleting; the interface doesn't exist yet.
7. **The consent attachment** (a signed form or an email). Files exist now, but the consent form has no attachment control. It needs a decision on whether attaching counts as changing the record (C3 says it doesn't).
8. **Speaker labels on participants** (MVP 4.3). Participants named as asked on a locked record can't change their name, role or organisation. Matching speaker labels doesn't touch those, so it can stay allowed; confirm.
9. **AI proposals that quote a note.** Editing or deleting such a note is refused while the proposal is under review ("Review it first", `notes.ts`). The review interface should make that one step away.
10. **Deleting a finding.** No story asks for it, so Phase 1 doesn't offer it (undo covers a finding added by mistake). Rejected proposals are kept hidden (MVP Q11). Decide whether accepted or hand-entered findings can be deleted.
11. **Evidence links** open the quoted note's session, not the note itself. With transcripts, a link should land on the passage.
12. **Time zone in the export.** The export writes times in UTC, so it gives the same file every time, but a 10:00 meeting in South Africa shows as 08:00 UTC. Phase 2 should store a time zone in the workspace, so the export can use local time and still give the same file every time.

## Still open from earlier

- **Sample exports** from Teams, Zoom and Google Meet, from the user, at the start of Phase 2 (MVP Q7).
- **The POPIA review** of the consent wording (`docs/spec/CONSENT.md`). It stays `draft-1` until then.
- **The demo GIFs** in `docs/media` still show "Projects"; re-recording them needs ffmpeg (`npm run demos`).
