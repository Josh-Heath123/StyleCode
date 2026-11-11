# StyleCode roadmap

Each phase leaves the app working and builds on the previous one without restructuring it. Phases are ordered by technical dependency.

## The first genuinely useful version (MVP)

> Sketch a screen on the canvas → tidy it into auto-layout → export clean HTML/CSS or React → select part of it and ask a local or hosted AI to change it, with a preview you accept or reject.

That is the smallest version that proves the core idea: visual input and AI working on the same structure, with real code at the end. It was reached at the end of Phase 4, and Phase 5 refined it for other people to use.

## Changed from the original brief

**Design-to-code (now Phase 3) comes before AI (now Phase 4).** The AI's most valuable edits, such as "make this responsive", "turn this into a navigation bar" or "align these as a row", are expressed in terms of auto-layout and semantic roles. Those concepts have to exist in the model first. Shipping code export first also makes the no-AI mode properly useful, which the brief requires anyway.

**Undo/redo moved into Phase 1.** It is not a feature on top of the model; it falls out of the operation system that the AI will also use, so it belongs in the foundation.

## Phase 1: Foundation ✅

- Vite + React + TypeScript project, minimal dependencies
- Design system: midnight surfaces, electric blue for selection, cantaloupe for drop targets (and, from Phase 4, AI)
- Framework-independent document model, property registry and validation
- Invertible operations, transactions, gestures, undo/redo
- DOM canvas with screen-space overlay; pan (wheel, Space-drag, Hand tool, two-finger touch) and zoom (Ctrl/⌘+wheel, pinch, menu)
- Drawing tools: frame, rectangle, ellipse, text
- Select, multi-select, marquee, move, resize (Shift for aspect, Alt from centre), rotate (Shift snaps)
- Nesting: drawing into frames, re-parenting by dragging in or out of frames
- Layers panel: tree, selection, rename, hide, lock, drag to reorder or re-parent
- Contextual properties panel: position, size, rotation, opacity, radius, fill, stroke, typography, frame presets, align and distribute
- Group/ungroup, duplicate, copy/paste (also between tabs), z-order, nudge, context menu, keyboard shortcuts
- Local persistence: IndexedDB autosave, multiple projects, open/save `.stylecode.json` files, schema versioning and repair
- Example project; 48 unit tests including a property test of operation inverses

## Phase 2: Editor depth and layout ✅

The goal: an editor that is genuinely useful without AI and whose structure produces good code.

- **Auto-layout frames**: row or column, gap, padding per side, distribution (start, centre, end, space between), alignment, and fixed, hug or fill sizing; children can opt out of the flow. Resolved by an engine in the model and written back as positions, so undo, snapping and the future AI all see one geometry
- **Layout parity test**: a randomised browser test lays out 150 nested trees per run with the engine and with real CSS flexbox and checks they agree to half a pixel
- **Tidy into auto layout** (<kbd>Shift</kbd>+<kbd>A</kbd>): recursive XY-cut infers nested rows and columns, gaps, alignment and space-between clusters from rough geometry, centres single centred layers, and tidies nested frames in the same step; wrapping a selection and removing auto layout as well
- Reordering inside auto layout by dragging (with an insertion line) or with the arrow keys; the layers panel lists auto-layout children in reading order
- **Semantic roles** on layers (button, navigation, header, footer, section, card, list, heading, paragraph, label, link, image, input…), shown in the layers panel
- **Smart guides**: moving, resizing and drawing snap to the edges and centres of siblings and the parent frame, with guide lines; <kbd>Ctrl</kbd>/<kbd>⌘</kbd> turns snapping off
- **Images** stored locally in IndexedDB (content-addressed, so each picture is stored once) and embedded in saved project files; insert with the dock, the Insert tab, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>, drag-and-drop or paste; fit (cover, contain, fill) and replace
- **Effects**: drop shadows, linear gradients and background blur
- **Blocks**: button, secondary button, badge, text field, card, navigation bar and hero section, in light and dark, built from auto-layout frames with roles set
- Layer list virtualisation for very large documents
- **End-to-end tests** (Playwright) for drawing, selection, resize and rotate, text, properties, undo, reload, auto layout, tidy, reordering, snapping, blocks, the layers list, and images through save and open, alongside 73 unit tests
- Project file format version 2 (version 1 files open unchanged)

Moved to later phases, because nothing in the core loop depends on them yet:

- Per-corner radius, equal-spacing guides and distance labels (Phase 5)
- Wrapping rows (delivered in Phase 3) and grid layout (moved to Phase 5)

## Phase 3: Design to code ✅

- **HTML/CSS and React generators**, both pure functions of the document, sharing the canvas's CSS mapping
- **Semantic HTML from roles** (`nav`, `button`, `a`, `h1`–`h6` levelled by size, `ul`/`li`, `input`, `article`, `img`), kept valid; readable class names from layer names
- **Faithful at the design width**: a browser test renders exported pages and compares every layer with the canvas (within a pixel), in free layout and in auto layout
- **Responsive below the design width**: one media query per page lets rows wrap, fixed widths shrink, heights grow and large type and spacing scale; tested for sideways scrolling at phone and tablet widths. Free layout is flagged
- **React**: a TypeScript component and CSS module per screen; repeated structures extracted into components, with text, images and colours (as CSS variables) as props
- **Code panel** beside the canvas: HTML, CSS, React and CSS module for the screen, the selected layer's code highlighted, click a line to select its layer, copy
- **Code → design**: edit a layer's CSS in the code panel and it flows back into the design as one undoable step; anything that can't be represented is reported
- **Live preview** of the exported page in a sandboxed frame at the design width, 768px and 390px
- **Export as a ZIP**: a static website, or a Vite + React + TypeScript app that installs and builds as is; images and the Inter font included
- **Wrapping rows** in auto layout (`flex-wrap`), covered by the layout parity test
- Snapshot tests that pin generated code; a round-trip test that reads every layer's CSS back into the same design

Moved to later phases:

- Grid layout and minimum/maximum widths for responsive grids (Phase 5)
- Per-breakpoint design overrides, such as a different layout on mobile (Phase 5)

## Phase 4: AI collaboration ✅

The MVP: select part of a design, describe a change, review it on the canvas, accept or reject.

- **Providers**: Ollama (local, free), OpenAI-compatible APIs (OpenAI, LM Studio, OpenRouter, Groq, llama.cpp's server) and Anthropic, each with schema-constrained output (Ollama's `format`, `response_format` with fallbacks, a forced Anthropic tool)
- **Local AI server**: a Vite plugin mounts `/api/ai` on the dev and preview servers. It keeps settings and API keys in `~/.stylecode/ai.json` (mode 0600 on macOS and Linux) or reads them from environment variables, calls the provider and streams the reply. Keys never reach the browser and are only sent to the saved address (a saved key is forgotten when its address changes); the routes only answer StyleCode's own page, from this computer
- **AI settings**: off by default; provider, address, key (write-only), model picked from the provider's list, context size for Ollama; a connection check that lists the installed models
- **Context builder**: the screen as a compact tree with short ids, the layers that may change in full, ancestors, siblings and the rest summarised within a budget derived from the context window
- **Interpretation and policy**: short ids and new-layer refs resolved, operations validated like manual edits, changes kept to the selection (or the screen), locked layers and the screen protected (with a final before-and-after check of every locked layer), large deletions confirmed, one repair attempt with the problems explained to the model, cut-off replies reported
- **Assistant bar** above the tool dock (<kbd>/</kbd>): the explanation streams in while the model writes, the proposal appears on the canvas in cantaloupe (dashed where layers would be deleted), <kbd>Enter</kbd> accepts as one undo step and <kbd>Esc</kbd> rejects; Stop at any time; the design is read-only during review (undo rejects), and a reply waits for a drag or text edit in progress to finish
- **Suggestions** that fit the selection: text, images, shapes, empty or freely placed frames, several layers, or the whole screen
- Proposals are never autosaved or exported until accepted
- OpenAI's newer models (which take `max_completion_tokens` and no temperature) are detected from the error and retried
- Unit tests for the schema, instructions, context, interpretation, policy and proposal mode; server tests against fake providers for request formats, streaming, fallbacks, errors, key handling and the request checks; browser tests of the whole flow against a fake Ollama

## Phase 5: Refinement and presentation ✅

- **Notes the AI reads** (the "mark up a printout" interaction): a `note` layer that lives on the canvas outside pages, can point at a layer with an arrow (pin it by clicking the layer with the note tool, or drag its connector), and is never exported. The AI's context lists the notes on the page, with what each points at, as instructions from the designer, and "Do what the note says" is offered first when there are any
- **Grid layout**: a third auto-layout direction with equal columns, column spans, rows as tall as their content, and placement within cells; exported as CSS grid; switching a row of cards to a grid keeps their order
- **Size limits**: minimum and maximum width and height for layers in auto layout, shared out with CSS's own freezing algorithm, including inside wrapping rows and grids
- **Per-breakpoint overrides**: hide on phones, full width, a different direction for rows and columns, grid columns, font size and alignment, emitted as one media query below 640px (or the page width, if narrower)
- The **layout parity test** now generates grids, spans and limits; each run lays out 200 random trees, and 1,600 across eight seeds were checked against Chromium during development, all within half a pixel
- **Editor polish**: equal-spacing guides and centring between neighbours (competing fairly with edge snapping), distances while <kbd>Alt</kbd> is held, independent corner radii (also read back from `border-radius` with up to four values)
- **Onboarding**: a welcome screen with the example project, a getting-started checklist that ticks itself off from what you do, a Help menu, and a searchable shortcut reference on <kbd>?</kbd>
- **Accessibility**: a keyboard-driven layer tree (`aria-activedescendant`), <kbd>Tab</kbd> through layers on the canvas without trapping focus, focus kept inside dialogs and returned after, a live region that announces the selection and messages, shortcuts that leave keyboard-focused controls alone, AA contrast for text and filled buttons, and an axe check of the editor, panels, dialogs and menus in the browser tests
- **Recovery**: damaged stored projects skipped on start-up and downloadable as raw data, failed saves retried with backoff and offering ways out, a warning before closing with unsaved changes, storage usage in Projects with a warning when nearly full, error boundaries per panel and a recovery screen for the editor, unexpected errors reported instead of failing silently, a stall timeout for AI replies
- **Performance** on a 5,000-layer document: off-screen pages skipped by the browser (`content-visibility`), the selection overlay on its own layer, compositing while panning and zooming, fewer document copies per drag frame, layer rows that ignore geometry, cached tree shapes and a larger text-measurement cache; budgets in unit tests and a browser test
- **Presentation**: a user guide, a contribution guide, demo GIFs recorded from the real editor (`npm run demos`), CI on every push and pull request, issue and pull request templates, and a documentation site with a live demo published to GitHub Pages

## Beyond Phase 5

Ideas that fit the core loop, not commitments:

- Components with variants, so a repeated card is one definition on the canvas as well as in the code
- Several screens linked into a clickable prototype in the preview
- Breakpoints beyond phones (a tablet override), and per-breakpoint spacing
- Importing an existing page's HTML and CSS as a starting design

## Consulting workspace

The editor phases above are complete (v0.5.0). StyleCode is now growing into a workspace for software consultants (`docs/vision/PRODUCT-VISION.md`). Its phases are numbered on their own, as **Workspace Phase 0 to 7**. Each one leaves the app working, keeps every non-negotiable in `CLAUDE.md`, and ends with a review, a handover and a pull request. The acceptance criteria are things the user can check in the app. Those for Phases 4 to 7 are first drafts, refined in each phase's brief.

### Workspace Phase 0: Foundations ✅

Decisions and specs, with no interface: ADR-0001 to ADR-0009, the first-version spec (`docs/spec/MVP.md`), the domain model with its rules and tests (`docs/spec/DOMAIN-MODEL.md`, `src/workspace/model/`), the consent form (`docs/spec/CONSENT.md`), and this roadmap. See `docs/phase-0/HANDOVER.md`.

### Workspace Phase 1: Workspace spine ✅

Built in three slices (pull requests #9 and #10 for Slice A, #11 for Slice B, and the Slice C pull request): the workspace server, clients, engagements, sessions and participants, the consent form, notes, the hand-entered record with links, files, and the Markdown export, all with AI off. Future considerations (vision §8) are a finding kind. See `docs/phase-1/HANDOVER.md`.

**Scope:** MVP steps 1 to 3 and 5, plus the hand-entered record and its export (stories 1, 2, 3, 5, 6.4, 7 and 8 of `docs/spec/MVP.md`).

- The workspace server (`server/workspace/`, ADR-0005, ADR-0006, ADR-0008): the `StyleCode Data` folder, one folder per company, atomic saves with retry, the revision check, files stored by id; the request checks shared with `/api/ai`; refusing to start inside a git repository; a warning for cloud-synced folders; `npm start`.
- Companies, engagements, sessions and participants: create, edit, delete (a company by typing its name).
- The consent form (rules C1 to C4, C7; the interface in `CONSENT.md`), amendments and withdrawal, with deletion of the transcript once Phase 2 imports one.
- Notes, time-stamped, during a session.
- Findings entered by hand, the engagement's record in four groups, links between findings, every change undoable with who and when.
- Specification export as Markdown, including every consent record (C9).
- The consultant's name, asked once in settings; the guide's "Protecting client data" section (ADR-0009).

**Acceptance criteria:**

- I can create a company, an engagement and a session, close StyleCode, start it with `npm start`, and find them again; the company is one folder under `StyleCode Data`.
- I can fill in, confirm and amend a consent form; a yes I didn't tell the client about can't be confirmed (C2).
- I can add notes during a session, see their time and the time since the start, and add findings by hand with a kind and status; the record shows them in four groups, and undo reverts each change.
- Deleting a company asks me to type its name and removes its folder.
- The Markdown export contains the findings, links and consent records.
- Starting StyleCode with the workspace folder inside a git repository is refused, with the reason; a folder inside OneDrive shows a warning.
- A workspace file with a problem opens read-only and lists the problem; it is never saved over.
- Everything works from the keyboard and passes the accessibility check; typecheck and unit tests are green on Linux and Windows, and browser tests on Linux (as CI runs them).

**Depends on:** Workspace Phase 0.

### Workspace Phase 2: Extraction ✅

Built in three slices (pull requests #15 and #16 for transcripts, #17 for extraction and review, and the Slice C pull request for company knowledge): transcript import from nine layouts, speaker matching, consent after an import, AI extraction measured on the user's laptop, review by keyboard with the evaluation report, company knowledge, and the export in each session's local time. See `docs/phase-2/HANDOVER.md`.

**Scope:** MVP steps 4 and 6 (stories 4 and 6). Opens with the extraction test and evaluation harness (old WP7, in the appendix of `docs/phase-0/PHASE-0-BRIEF.md`), on typed role-play transcripts. The sample exports from Teams, Zoom and Google Meet are the reviewer's, rebuilt from each platform's published layout, not the user's (Phase 2 brief, decision 1; MVP Q7): `docs/phase-2/samples/`.

- Transcript import from `.vtt`, `.docx` and `.txt` exports, and pasted text; blocked without consent (C1); the speaker check and its warning (C11); matching speaker labels to participants.
- AI extraction from the transcript and notes, only where consent allows it, locally or by the named external provider (C5, C6); every quote checked against its passage before a proposal is shown; review by keyboard: accept, edit or reject, keeping what the AI proposed.
- The evaluation set runs in CI where feasible, measuring what consultants edit and reject.

**Then, in the same phase: company knowledge.** Promote an accepted finding to company knowledge, so what is learned about a company carries into its next engagement (vision §3, MVP Q3). The model already supports it (`promoteToKnowledge`, copies that outlive their source). Placed here, straight after extraction and before capture, because it needs accepted findings and nothing in Phase 3.

**Acceptance criteria:**

- Importing a transcript without confirmed consent to transcription is unavailable, and says why.
- I can import every layout in `docs/phase-2/samples/` and see the meeting by speaker; speakers who weren't asked are listed and the warning stays on the transcript.
- With a local model, I can ask for findings and review each proposal with its quoted passage highlighted; a proposal with an invented quote is never shown, and the count dropped is reported.
- A session whose consent allows only local AI refuses an external provider, saying why.
- After a withdrawal, deleting the transcript removes its words everywhere and lists the findings and company facts that keep a statement from it.
- I can promote a finding to company knowledge and see it in the company's next engagement, with its source, or "source deleted".
- The evaluation report shows, per role-play transcript, the proposals accepted, edited and rejected.

**Depends on:** Workspace Phase 1.

### Workspace Phase 3: Capture

**Scope:** recording and local transcription with speakers. Opens with the transcription test (old WP6, in the appendix of the Phase 0 brief), measured on the user's computer.

- Recording in the browser (`getUserMedia` on `localhost`), blocked without consent to recording (C1); stopping on request; audio stored as session files.
- Local transcription with speaker labels and confidence, as a third transcript source.
- Audio retention (C10): "deleted after transcription" is a promise to the client, so the audio is deleted as part of finishing the transcription, not left to a reminder. For "N days" and "until the engagement ends", overdue audio is listed when StyleCode opens, with one action to delete it (CONSENT.md decision 4).

**Acceptance criteria:**

- Recording is unavailable without consent to recording, and says why.
- A recorded role-play meeting is transcribed on this computer with speakers, and nothing is sent elsewhere.
- With "deleted after transcription", the audio file is gone when the transcript is ready.
- Overdue audio is listed on start-up until it is deleted.

**Depends on:** Workspace Phase 2 (the transcript model, review and extraction are reused).

### Workspace Phase 4: Canvas in context

**Scope:** the StyleCode editor in each engagement, informed by the record (ADR-0007).

- Engagement designs stored in the company's folder; attach a new design or a copy of an existing project.
- The editor saves through the workspace API as well as IndexedDB.
- The record available to the design: findings shown beside the canvas, linked to layers, and offered to the AI as context.

**Acceptance criteria:**

- I can attach a copy of an existing project to an engagement; the original is unchanged, and the copy is in the company's folder.
- I can link a layer to a finding and see the link from both sides.
- The AI's suggestions for a screen can draw on the engagement's confirmed findings, and say which.

**Depends on:** Workspace Phase 1; better after Phase 2, when the record has extracted findings.

### Workspace Phase 5: Technology catalogue, rules engine and architecture

**Scope:** a catalogue of technologies with sourced, dated facts, and a deterministic engine that checks compatibility and constraints against the record (ADR-0004). **Then a coherent architecture, not just a list of compatible options** (vision §5): a proposed set of choices that work together across the parts of the system (front end, back end, data, hosting, integrations), each with the findings and rules behind it, and the trade-offs between alternatives.

**Acceptance criteria:**

- Every catalogue fact shows its source and the date it was checked; the AI can't mark anything as verified.
- Given the record's constraints, the engine lists compatible and incompatible options, with the rule behind each, and gives the same result every time.
- A proposed architecture names a choice for each part of the system, shows that the choices are compatible with each other and with the record, and links each choice to the findings and rules it rests on.

**Depends on:** Workspace Phase 2 (a record worth checking).

### Workspace Phase 6: Cost and capacity engine

**Scope:** cost estimates computed by code from sourced, dated pricing (ADR-0004). The AI never supplies a price. **Also capacity and performance calculations** (vision §7), from the record's numbers (such as "orders peak at five times the usual volume in December"), and **comparing alternatives on cost** (vision §6): the same needs priced on two or more architectures, side by side.

**Acceptance criteria:**

- Every price shows its source and date; an estimate shows how it was calculated, and the same inputs give the same total.
- Prices older than a set age are flagged.
- A capacity estimate shows the findings it starts from and each step of the calculation.
- Two alternatives can be compared on cost for the same needs, each total traceable to its prices.

**Depends on:** Workspace Phase 5.

### Workspace Phase 7: Specification export, live transcription and follow-up questions

**Scope:** a full specification export from the record, designs and analyses; **live transcription** during a meeting (vision §9.4), building on Phase 3's local transcription; and follow-up questions suggested during a meeting from what is still open, drawing on **company knowledge as AI context** (vision §3), what is already known about the client from earlier engagements, each fact checked against the consent of the sessions it came from.

**Acceptance criteria:**

- The export includes the record, designs, technology and cost analysis, each with status and provenance.
- With consent to recording and transcription, the transcript appears as the meeting goes, on this computer.
- During a session, open questions and gaps in the record are suggested as follow-ups, only with consent to AI processing.
- A follow-up that draws on company knowledge says which facts, and leaves out any whose sessions don't allow AI processing.

**Depends on:** Workspace Phases 3 to 6.
