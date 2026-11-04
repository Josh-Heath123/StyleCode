# Phase 0: Foundations for the consulting workspace

> **For Claude Code.** Read `CLAUDE.md` and `docs/vision/PRODUCT-VISION.md` first. Work through the work packages in order. At every **⏸ Check-in**, stop, report and wait for the user.

## Where we are

- **This repo is StyleCode,** a local-first visual UI editor: canvas, auto layout and grids, code generation (HTML/CSS/React), and AI proposals through a local server (Ollama, the user's own key, or off). Phases 1–5 of its roadmap are complete (v0.5.0). See `README.md`, `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.
- **It is turning into an AI-assisted consulting workspace** (`docs/vision/PRODUCT-VISION.md`). The StyleCode editor becomes one part of it: where the interface is designed during a consultation.

## Decisions already made

Record these as ADRs in WP1. Don't reopen them.

1. **Same repo.** The workspace is built in this repository. The StyleCode editor keeps working and becomes a module of the product.
2. **Local-first.** Client data, recordings and files stay on the consultant's computer: no accounts, no hosted services, no running costs. AI stays optional: local models by default, the user's own API key if they choose, or none.
3. **Consent before recording.** Every session has a consent form that the consultant fills in. It records that consent was asked for and what was agreed. Recording can't start without it, and neither can importing or pasting a meeting transcript.
4. **Deterministic where it matters.** Costs, compatibility and constraint checks are calculated by code from sourced data. The AI interprets, proposes and explains.

## Goal

Phase 0 builds no user-facing features. It produces the foundations Phase 1 builds on:

- the spec of the first version (one end-to-end slice);
- the domain model, written up and as TypeScript types with tests;
- the architecture and storage decisions;
- the consent form spec;
- a roadmap for Phases 1–7 with acceptance criteria.

## Ground rules for this phase

- **Branch:** `phase-0-foundations`, from the base branch the user names. Commit per work package with clear messages. Open a PR at the end; don't merge.
- **Keep the editor working:** `npm run typecheck`, `npm test` and `npm run test:e2e` stay green after every commit.
- **No new runtime dependencies in the app.** Phase 0 has no spikes: the transcription and extraction tests open Phases 3 and 2 instead (see "Moved out of Phase 0" below).
- **Never commit** real client data, recordings of real people, or API keys. Use role-played material only, and keep audio out of git (`.gitignore`).
- **Research claims need sources:** link and date accessed. Performance figures are measured on the user's machine, not quoted.
- **Where this brief says the user decides,** present the options with a recommendation, then wait.

## Work packages

### WP0: Start clean

1. Run `git status` and `git branch -a`.
   - If the Phase 5 changes are still uncommitted, stop and ask the user to commit them, or for permission to commit them as "Phase 5".
   - Confirm the `.github` folder is present (it was delivered separately as a zip).
   - Ask which branch Phase 0 starts from.
2. Create the branch.
3. Run all tests to confirm a green baseline, and note the counts.

⏸ **Check-in:** report the baseline.

### WP1: Vision, rules and decision records

- `docs/vision/PRODUCT-VISION.md` is provided; don't edit its content.
- `CLAUDE.md` is provided. Check it against the repo and propose fixes if anything is wrong.
- Create `docs/decisions/` with `TEMPLATE.md` (Context · Decision · Options considered · Consequences · Status · Date), then:
  - ADR-0001: Build the workspace in the StyleCode repo
  - ADR-0002: Local-first; data, recordings and files stay on the consultant's computer
  - ADR-0003: Consent is recorded before any recording
  - ADR-0004: Deterministic engines for cost, compatibility and constraints; AI proposes and explains
  - Further ADRs come from WP4.

### WP2: First-version spec (`docs/spec/MVP.md`)

The first version is one end-to-end slice:

1. Create a company workspace (profile: name, industry, what they do, existing systems, notes).
2. Create an engagement (a project for that company) and a session (a meeting) within it.
3. Fill in the consent form for the session.
4. Import a meeting transcript (an export from Teams, Zoom or Google Meet, such as `.vtt` or `.docx`), or paste one. The consent form applies to imported transcripts too.
5. Take manual notes during the session, time-stamped.
6. Review the findings the AI proposes from the transcript and the session's notes (requirements, constraints, questions, risks…). Each is linked to the transcript passage or note it came from, and can be accepted, edited or rejected.
7. See the engagement's consolidated record: confirmed findings, assumptions and open questions.
8. Export a specification from the record (Markdown first).

The StyleCode canvas can be opened from an engagement, but isn't yet informed by the record.

Write user stories with acceptance criteria for each step, plus:
- an explicit out-of-scope list: recording and local transcription (Phase 3), live follow-up questions, the technology catalogue, the cost engine, a canvas informed by the record, and sync between devices;
- the open questions for the user.

⏸ **Check-in:** the user approves the slice.

### WP3: Domain model

Write `docs/spec/DOMAIN-MODEL.md` and draft the types in `src/workspace/model/`: types, validation and unit tests only, with no UI and no storage. Follow the conventions of StyleCode's model: flat maps keyed by id, validated, versioned.

| Entity | Notes |
| --- | --- |
| Company | Profile fields, plus accumulated company knowledge (facts with provenance) |
| Engagement | Belongs to a company; links to designs (StyleCode documents) |
| Session | Belongs to an engagement; date, participants, transcript (imported in Phase 2, recorded in Phase 3), audio file references (Phase 3) |
| ConsentRecord | One per session, with amendments (WP5) |
| Participant | Name, role, side (client or consultant), and the speaker label it maps to |
| TranscriptSegment | Speaker, start and end time, text, confidence (times and confidence only where the source provides them: a pasted transcript may have neither) |
| Note | Manual and time-stamped |
| FileRef | An uploaded document, attached to a company or an engagement |
| Finding | Kind, statement, status, provenance, evidence links, relations |

- **Finding kinds** come from vision §2: business requirement, functional, non-functional, expectation, objective, operational challenge, existing system, budget, performance, scalability, security, design preference, constraint, open question, risk, decision.
- **Two separate dimensions on every finding:**
  - *Status:* confirmed · suggested · assumption · unresolved (vision §2).
  - *Provenance:* said in a session (with segment ids) · entered by the consultant · verified technical information · calculated · AI-suggested (vision §7).
- **Relations between findings:** influences, depends on, conflicts with, refines. These let context such as "traffic peaks in December" attach to later scalability and cost findings.
- **Rules to encode and test:**
  - A finding said in a session cites at least one transcript segment from that engagement.
  - An AI-suggested finding only becomes confirmed through the consultant's action, recording who and when.
  - One company's data never references another company's ids.

### WP4: Architecture and storage

Add a new section to `docs/ARCHITECTURE.md`, plus an ADR for each decision. For each question, set out the options with a recommendation, and let the user decide:

1. **Runtime.**
   - *Options:* browser plus a local Node server (extending today's `server/` pattern), Electron, or Tauri.
   - *Weigh:* microphone and file-system access, installing on Windows, zero cost, and reuse of the current code.
   - *Evaluate first:* browser plus a local Node server, started with one command.
2. **Storage.** Where records, audio and files live.
   - *Evaluate first:* a workspace folder on disk, managed by the local server.
     - One folder per company, holding its own database file and its own files, so a client's data can be backed up, exported or deleted as a unit and can't leak into another's.
     - SQLite for records and full-text search: check the status of `node:sqlite` in the Node versions we support against using a library.
     - Plain files for audio and documents.
3. **Existing StyleCode projects** (stored in IndexedDB). How they relate to engagements: attached designs, migration, or coexistence.
4. **Local API security.** The same protections as the AI server today: loopback only, plus origin and header checks.
5. **Data protection basics.** Guidance on OS disk encryption, and whether app-level encryption is needed now or later.

⏸ **Check-in:** the user decides.

### WP5: Consent form (`docs/spec/CONSENT.md`)

The consultant fills in this form for each session, before recording or importing a transcript. Spec the form, its rules and its UI (a sketch is enough). Implementation comes in Phase 1 (the form), Phase 2 (transcript import is blocked without it) and Phase 3 (recording is blocked without it).

**Fields:**

- Session, date and time (filled in automatically)
- Client representatives asked: name, role, organisation
- Asked by: the consultant's name
- How consent was asked: verbally at the start of the meeting, in writing beforehand, or other (described)
- What the client was told, as checkboxes with the wording shown:
  - the meeting will be recorded;
  - it will be transcribed;
  - notes and findings will be extracted with AI;
  - where that processing happens: on this computer only, or with an external AI provider (named);
  - how long recordings are kept;
  - that they can ask for recording to stop, or for the recording to be deleted.
- Consent given, yes or no for each: audio recording · transcription · AI processing on this computer · AI processing by an external provider (named)
- Retention of audio: kept for N days, until the engagement ends, or deleted after transcription
- Outcome: consent given · given with limits (described) · declined
- The consultant's confirmation ("I asked for consent as recorded above"), with a timestamp
- Optional attachment: a signed form or an email

**Rules (enforced in code and tested):**

- Recording and audio import are unavailable until the session has a consent record with recording = yes.
- Importing or pasting a transcript is unavailable until the session has a consent record that covers it (the exact rule is settled in WP5).
- If external AI processing = no, only local models may process that session's data. The app refuses external providers for it.
- If consent is declined, the session can only have manual notes.
- Once recording starts, or a transcript is imported, the record is locked. Later changes are added as dated amendments, never overwrites.
- A withdrawal is recorded as a dated entry, and the app offers to delete the audio and transcript.
- Consent records are included in the engagement's export.

Add a note that the wording shown to the client should be reviewed by someone qualified in POPIA before real use. Don't present the form as legal compliance.

### WP6 and WP7: moved out of Phase 0

The transcription test (old WP6) and the extraction test with the evaluation harness (old WP7) are not part of Phase 0. Don't start them. They now open Phases 3 and 2 of the roadmap. Their original briefs are kept under "Moved out of Phase 0" at the end of this document.

### WP8: Roadmap (`docs/ROADMAP.md`)

Add a "Consulting workspace" part with Phases 1–7. Give each one its scope, acceptance criteria the user can check, and what it depends on:

1. **Workspace spine:** companies, engagements, sessions, the consent form, files, notes, and the structured record entered by hand.
2. **Extraction:** the AI proposes findings, to accept or reject, from session notes and from imported meeting transcripts (Teams, Zoom and Google Meet exports such as `.vtt` and `.docx`, or pasted text), each linked to the passage or note it came from. It opens with the extraction test and evaluation harness (old WP7), using typed role-play transcripts; the evaluation set runs in CI where feasible.
   - Straight after extraction (before or within Phase 3; WP8 places it): **promote an accepted finding to company knowledge**, so what is learned about a company carries into its next engagement (vision §3; MVP Q3).
3. **Capture:** recording and local transcription with speakers. It opens with the transcription test (old WP6).
4. **Canvas in context:** the StyleCode editor in each engagement, informed by the record.
5. **Technology catalogue and rules engine.**
6. **Cost engine,** with sourced, dated pricing.
7. **Specification export and live follow-up questions.**

### WP9: Review and hand-back

1. Run an independent review: a subagent that hasn't seen your reasoning checks every Phase 0 document and type against the vision for contradictions, gaps, and anything decided that the user didn't decide.
2. Fix what it finds.
3. Write `docs/phase-0/HANDOVER.md`: what was produced, the decisions made (with ADR numbers), the open questions, and what Phase 1 starts with.
4. Open the PR.

## Definition of done

- [ ] ADR-0001 to ADR-0004, plus the WP4 ADRs, written and accepted by the user
- [ ] MVP spec, domain model and consent spec approved by the user
- [ ] Domain types in `src/workspace/model/` with passing unit tests; existing tests still green
- [ ] Roadmap Phases 1–7 with acceptance criteria
- [ ] Handover written; PR open, not merged

## Moved out of Phase 0

Kept for the phases they now open. Not part of Phase 0.

### Old WP6, opens Phase 3: transcription and speakers (`spikes/transcription/`)

**Question:** can the user's machine transcribe a consultation locally, at no cost, accurately enough, and tell who is speaking, live or soon after?

1. **Research the candidates,** with sources: for example whisper.cpp, faster-whisper, Whisper in the browser (transformers.js), sherpa-onnx and pyannote. Check that each licence allows this use for free, plus Windows support and model sizes.
2. **Test material** (the user provides it):
   - two role-played consultations of about 10 minutes each, with consent noted;
   - a hand-corrected transcript of a 2–3 minute excerpt from each, with speaker turns.
3. **Measure** the best 2–3 candidates, at 2 model sizes each: real-time factor, word error rate on the corrected excerpts, speaker-attribution accuracy, CPU and RAM use, and the setup steps on Windows.
4. **Try one live mode,** transcribing chunks while recording, and report the latency.
5. **Write `docs/research/TRANSCRIPTION.md`:** a results table, a recommendation, what "live" can realistically mean on this hardware, and the risks.

⏸ **Check-in** (in that phase).

### Old WP7, opens Phase 2: extraction quality and the evaluation harness (`eval/`, `spikes/extraction/`)

**Question:** how well does a local model extract findings from a transcript, and how do we measure that from now on?

1. **Dataset format** in `eval/consultations/<id>/`:
   - `transcript.json` (the segments);
   - `answer-key.json` (the expected findings, with kind, status and supporting segment ids);
   - `README.md` (the scenario and a consent note).
   - Audio is git-ignored.
2. **Answer keys.** Draft them from typed role-play transcripts (written as Teams, Zoom or Google Meet exports would be), then the user reviews and corrects them. They are the ground truth, so a draft is never final.
3. **Extraction prompt and JSON schema,** built from the domain model types (as StyleCode builds its AI schema from the property registry). Run them through the existing local AI server and providers where possible.
4. **Scorer.** A script that:
   1. checks automatically that every cited segment exists and that the quoted words appear in it (invented evidence counts as a failure);
   2. matches extracted findings to the answer key, writing a CSV in which the user settles unclear matches.

   It reports precision, recall and the invented-evidence rate, per finding kind.
5. **Run 2–3 local models** that fit the machine, through Ollama. Optionally add one hosted model, if the user supplies a key, to see the gap.
6. **Write `docs/research/EXTRACTION.md`:** results, a recommendation (model, chunking, prompt), what accuracy the product can promise, and how the interface should present uncertain findings.

⏸ **Check-in** (in that phase).
