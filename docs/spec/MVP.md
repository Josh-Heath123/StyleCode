# First version (MVP) of the consulting workspace

- **Status:** Approved by the user, 2026-11-04 (Phase 0, WP2), with the decisions on Q1–Q16 below
- **Date:** 2026-11-04
- **Sources:** `docs/vision/PRODUCT-VISION.md`, `docs/phase-0/PHASE-0-BRIEF.md`, ADR-0001 to ADR-0004

## The slice

The first version is one end-to-end path through a consultation, for one consultant on one computer:

1. Create a company workspace.
2. Create an engagement (a project for that company) and a session (a meeting) within it.
3. Fill in the consent form for the session.
4. Import a meeting transcript (an export from Teams, Zoom or Google Meet, such as `.vtt` or `.docx`), or paste one.
5. Take manual notes during the session, time-stamped.
6. Review the findings the AI proposes from the transcript and the session's notes. Each is linked to the transcript passage or note it came from, and can be accepted, edited or rejected.
7. See the engagement's consolidated record: confirmed findings, assumptions and open questions.
8. Export a specification from the record (Markdown first).

The StyleCode canvas can be opened from an engagement, but isn't yet informed by the record.

**How it maps to the roadmap.** Steps 1–3, 5 and 7 (with findings entered by hand), the Markdown export in step 8, and opening the canvas are Phase 1, "Workspace spine". Steps 4 and 6 are Phase 2, "Extraction", which also adds evidence quotes to the export (Q1). Recording and local transcription come in Phase 3, "Capture".

**What the first version proves:** that a consultant can turn a real meeting into a reviewed, sourced record of what the client needs, without the AI's suggestions ever being confused with what the client said or what the consultant confirmed.

## Rules that apply to every story

These come from `CLAUDE.md` and ADR-0001 to ADR-0004, and are part of every story's acceptance criteria.

- **AI off.** Every step except 6 works fully with AI turned off. With AI off, the consultant can still add findings to the record by hand (story 6.4).
- **Local only.** Nothing is sent off the computer, except to an external AI provider the consultant has configured, for a session whose consent allows it.
- **Companies are separate.** Nothing in one company's workspace shows, links to or exports anything from another's.
- **Status and provenance are always visible** on a finding, and are never merged into one label.
- **AI output is a proposal.** Accepting, editing and rejecting are undoable.
- **No placeholder controls.** A feature that isn't available is not shown, except where a real feature is blocked by a rule (for example, import before consent). There the control says why and what to do.
- **Accessible.** Every story can be completed from the keyboard, passes `e2e/accessibility.spec.ts` (axe), and uses plain interface text with WCAG AA contrast.
- **Tested.** Every story has a browser test in `e2e/`. Every rule has unit tests in `src/workspace/`.

## User stories

Each story is written for the consultant ("I"). "Given / when / then" is used only where the order matters.

### 1. Company workspace

**1.1 Create a company.** As a consultant, I want to create a workspace for a client company, so that everything about that client is kept in one place.

- I can create a company with a name (required), industry, what they do, existing systems, and notes.
- The name can't be empty or only spaces. A name that matches an existing company's, ignoring case, is refused (Q4).
- The new company opens straight away, showing its profile and an empty list of engagements.
- It survives closing and reopening the app.

**1.2 Find and open a company.** As a consultant, I want to see my companies and open one, so that I can move between clients quickly.

- A list shows every company, by name, with its industry and when it was last changed.
- Opening a company shows its profile and its engagements. Nothing from other companies is visible inside it.
- With no companies yet, the list says what to do next ("Create a company to start").

**1.3 Edit the profile.** As a consultant, I want to update a company's profile as I learn more about it.

- Every profile field can be edited. Changes are saved without a separate save step, and can be undone.
- When the profile was last changed is shown.

**1.4 Delete a company.** As a consultant, I want to delete a client's workspace entirely, for example when an engagement is over and the data mustn't be kept (Q6).

- Deleting a company deletes everything in it: its engagements, sessions, consent records, transcripts, notes, findings, files and designs.
- I must type the company's name to confirm. Until it matches, the delete button stays unavailable. The confirmation says what will be deleted.
- Deletion can't be undone, and the confirmation says so.

### 2. Engagements and sessions

**2.1 Create an engagement.** As a consultant, I want to create an engagement for a company, so that each project has its own record.

- I can create an engagement inside a company with a name (required), a short description of the goal, and a status: active, or ended with the date it ended (Q5).
- An engagement always belongs to exactly one company, and can't be moved to another.
- The company page lists its engagements, newest first.

**2.2 Create a session.** As a consultant, I want to create a session for each meeting, so that what was said is tied to when and with whom.

- I can create a session inside an engagement with a title, date and time (defaulting to now) and its participants.
- Each participant has a name, a role, and a side (client or consultant). At least one client participant is needed before the consent form can be filled in.
- The engagement page lists its sessions by date, with the state of each one's consent (not filled in, given, given with limits, declined).

**2.3 Delete an engagement or a session.** As a consultant, I want to remove an engagement or a session I no longer need (Q6).

- Deleting asks for confirmation, naming the engagement or session and what will be deleted with it. It can't be undone, and the confirmation says so.
- Deleting a session removes its consent record, transcript, notes and the findings whose only evidence is in it.

### 3. Consent form

The form, its fields and its rules are specified in `docs/spec/CONSENT.md` (WP5). This story covers how it fits the slice.

**3.1 Record consent.** As a consultant, I want to record that I asked the client for consent and what they agreed to, before I bring in what they said.

- Given a session without a consent record, when I open it, then importing or pasting a transcript is unavailable, and the session says the consent form must be filled in first, with a way to open it.
- Given I've filled in the form and confirmed it, then the session shows the outcome (given, given with limits, declined) and what was agreed.
- Given consent was declined, then the session can only have manual notes: transcript import stays unavailable.
- Given external AI processing wasn't agreed, then the app refuses to send that session's data to an external provider, and says why, even if one is configured.
- Given a transcript has been imported, then the consent record is locked. Changes and withdrawals are added as dated amendments.

### 4. Import a transcript

**4.1 Import a file.** As a consultant, I want to import the transcript my meeting platform produced, so that I don't have to type up what was said.

- I can import a `.vtt` file or a `.docx` file exported from Teams, Zoom or Google Meet (the exact variants are confirmed against role-played sample exports the user provides at the start of Phase 2; Q7).
- The import is read on the computer, by code, without AI.
- The transcript is shown as segments, each with its speaker label, its text, and its start and end times where the file has them.
- A file the app can't read is refused with a message that names the problem, and nothing is changed.
- Importing is only possible when the session's consent allows it (story 3.1).

**4.2 Paste a transcript.** As a consultant, I want to paste a transcript as text, for platforms or meetings that don't give me a file.

- I can paste plain text. Lines in the form "Name: what they said" become segments with that speaker. Other lines become segments with no speaker.
- A time stamp at the start of a line (such as `00:12:34` or `[12:34]`) becomes that segment's start time. Otherwise segments from pasted text have no times (Q8).

**4.3 Match speakers to participants.** As a consultant, I want to say which participant each speaker label is, so that findings show who said what.

- After an import, every distinct speaker label is listed, and I can match each one to a session participant, or leave it unmatched.
- Labels that equal a participant's name are matched automatically. I can change any match.
- The transcript shows the participant's name and side where a label is matched.

**4.4 Keep the transcript as imported.** As a consultant, I want the transcript to stay exactly as imported, so that findings always point at what was really said.

- The segments' text can't be edited in the first version (Q9).
- A session has one transcript. Replacing it is only possible while no accepted finding cites it (Q10).

### 5. Notes

**5.1 Take notes during the session.** As a consultant, I want to write notes while the meeting happens, so that I capture what I notice that a transcript won't.

- I can add notes to a session at any time, including when consent was declined.
- Each note records when it was written, shown as a time of day and as the time since the session started.
- Notes are listed in time order and can be edited or deleted. Editing keeps the original time and records when it was last changed.
- Typing a note doesn't need the mouse. A keyboard shortcut starts a new note.

### 6. Findings

**6.1 Ask the AI for findings.** As a consultant, I want the AI to propose findings from the transcript and my notes, so that I don't miss requirements, constraints, questions and risks.

- With AI on and allowed by the session's consent, I can ask for findings for a session.
- Each proposed finding has a kind (from the list in vision §2), a statement, a proposed status, and evidence: one or more transcript segments or notes, each with the words quoted from it.
- Before a proposal is shown, code checks that every cited segment or note exists in that engagement, and that every quoted passage appears in it. Proposals that fail the check are not shown, and the number dropped is reported.
- Proposals are clearly marked as proposed by the AI, and are not part of the record until accepted.
- With AI off, or not allowed for this session, the action isn't offered, and the session says why.

**6.2 Review a proposal.** As a consultant, I want to accept, edit or reject each proposal, so that only what I've checked enters the record.

- Selecting a proposal shows its evidence in the transcript or notes, highlighted.
- Accept adds it to the record, recording who accepted it and when. I choose its status (confirmed, assumption or unresolved) as I accept it; the AI's proposed status is preselected.
- Edit lets me change the kind, statement, status or evidence before accepting.
- Reject removes it from the proposals. It is kept, hidden, with who rejected it and when, so the AI doesn't propose it again (Q11).
- Every accept, edit and reject can be undone.
- The AI can't mark a finding as confirmed or verified. Only my action does.

**6.3 Review quickly.** As a consultant, I want to go through proposals from the keyboard, so that reviewing a long meeting is fast.

- I can move between proposals and accept, edit or reject each one with the keyboard alone.

**6.4 Add a finding by hand.** As a consultant, I want to add findings myself, with or without the AI.

- I can add a finding with a kind, statement and status. Its provenance is "entered by the consultant", unless I attach transcript segments as evidence, in which case it is "said in a session".
- This works with AI off.

### 7. The engagement's record

**7.1 See the record.** As a consultant, I want one view of everything established for an engagement, so that I know what is agreed and what isn't.

- The record lists every accepted finding from all of the engagement's sessions, grouped into confirmed (status confirmed), assumptions (status assumption) and open (status unresolved, or kind open question whatever its status) (Q12).
- Each finding shows its kind, statement, status, provenance and, where it has evidence, a link to the passage or note, which opens it in its session.
- I can filter the record by kind and by session.
- I can change a finding's status, statement or kind from the record. Every change is undoable, and records who changed it and when.

**7.2 Relate findings.** As a consultant, I want to link findings that affect each other, so that context like "traffic peaks in December" stays attached to later scalability and cost findings.

- I can link two findings in the same engagement as "influences", "depends on", "conflicts with" or "refines".
- A finding shows its links, and I can follow them.
- Findings in different engagements can't be linked in the first version, and links never cross companies (Q13).

### 8. Export

**8.1 Export a specification.** As a consultant, I want to export the engagement's record as a document, so that I can share it with the client or my team.

- I can export an engagement as one Markdown file.
- It contains: the company and engagement details; the sessions with dates and participants; the findings grouped as in the record, each with its kind, status and provenance and, for evidence, the quoted words and their session; the links between findings; and every session's consent record with its amendments.
- It contains nothing from other engagements or companies.
- Rejected proposals are not included.
- The same record always produces the same file.

### 9. Designs

**9.1 Open the canvas from an engagement.** As a consultant, I want to sketch the client's interface from within the engagement, so that designs live with the project they belong to.

- From an engagement, I can create a design, which opens in the StyleCode editor.
- The engagement lists its designs, and opening one opens the editor on it. I can get back to the engagement in one step.
- The editor works exactly as today. It doesn't yet use the record.
- How designs are stored, and how existing StyleCode projects relate to engagements, is decided in WP4.

## Out of scope for the first version

- Recording, audio import and local transcription with speakers (Phase 3).
- Live follow-up questions during a session.
- The technology catalogue and rules engine.
- The cost engine.
- A canvas informed by the record.
- Sync between devices, sharing, and more than one consultant.
- Accumulated company knowledge beyond the profile. Promoting an accepted finding to company knowledge comes in the roadmap phase straight after extraction (Q3).
- Export formats other than Markdown.

## Decisions on the open questions

The user accepted the recommendation for each question on 2026-11-04, with changes to Q3, Q6 and Q7 (marked).

- **Q1. Where does export (step 8) land?** The roadmap puts "Specification export" in Phase 7, but the first version includes a Markdown export. *Decided:* export the record as Markdown in Phase 1 (it is deterministic and makes the record useful immediately), with evidence quotes added in Phase 2. Phase 7 then turns it into a fuller specification document.
- **Q2. Files.** The roadmap's Phase 1 includes files (FileRef), but the slice doesn't mention them. *Decided:* include attaching, opening and removing files on a company or an engagement in Phase 1, without reading their content, and without the AI using them.
- **Q3. Company knowledge.** The domain model includes accumulated company knowledge (facts with provenance), but no step uses it. *Decided:* model it in WP3, but leave it out of the first version's interface. **Change:** the roadmap gets "promote an accepted finding to company knowledge" in the phase straight after extraction, so what is learned about a company carries into its next engagement (vision §3).
- **Q4. Duplicate company names.** *Decided:* refuse an exact duplicate (ignoring case), since the list is how the consultant tells clients apart.
- **Q5. Engagement fields.** Retention "until the engagement ends" (consent form) implies an engagement can end. *Decided:* name, goal, and status (active or ended, with the date it ended). Nothing else for now.
- **Q6. Deleting.** ADR-0002 says a company's data can be deleted as a unit. *Decided:* include deleting a company, an engagement and a session in the first version. No undo for deletion, so the confirmation is the safeguard. **Change:** deleting a company requires typing its name to confirm; engagements and sessions need a normal confirmation that names what will be deleted.
- **Q7. Transcript formats.** *Decided:* **change:** the user provides role-played sample exports (typed, no real people) at the start of Phase 2. Formats are supported from those samples. Reading `.docx` may need a dependency; I would ask before adding one.
- **Q8. Times for pasted text.** *Decided:* recognise common time stamps at the start of a line (such as `00:12:34` or `[12:34]`) and use them. Otherwise segments have no times.
- **Q9. Correcting the transcript.** Platforms make mistakes. *Decided:* no text editing in the first version, to keep evidence exact. Speaker matching (story 4.3) can be changed at any time.
- **Q10. Replacing a transcript.** *Decided:* one transcript per session, replaceable only while no accepted finding cites it.
- **Q11. Rejected proposals.** *Decided:* keep them, hidden, with who rejected them and when. That stops the AI proposing them again and helps measure extraction quality, and rejected proposals are never exported.
- **Q12. Grouping in the record.** The step names "confirmed findings, assumptions and open questions", but "open question" is a kind and "unresolved" is a status. *Decided:* three groups: confirmed (status confirmed), assumptions (status assumption), and open (status unresolved, or kind open question, whatever its status). Each group can be filtered by kind.
- **Q13. Links across engagements.** *Decided:* not in the first version. Links stay within one engagement, and never cross companies.
- **Q14. Provenance of AI-extracted findings.** The brief lists "said in a session" and "AI-suggested" as different provenances. When the AI extracts something the client said, with a quote, which is it? *Decided:* "said in a session", with the segments, plus a separate record that the AI proposed it and who accepted it. "AI-suggested" is kept for things the AI inferred that nobody said, such as a risk it spotted. WP3 models it this way.
- **Q15. Notes and consent.** *Decided:* the session's consent for AI processing applies to its notes too, because they describe the same meeting. A session with consent declined can have notes, but the AI doesn't process them.
- **Q16. Ollama on another computer.** The AI settings let Ollama point at any address. *Decided:* treat an Ollama address that isn't this computer as an external provider for the consent rules. WP5 writes it into the consent rules.
