# Presentation: StyleCode's front door

> **For Claude Code.** Read these first:
> - `CLAUDE.md`;
> - this brief;
> - `README.md`, `docs/GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` and `CONTRIBUTING.md`;
> - `docs/research/EXTRACTION.md` and `docs/research/TRANSCRIPTION.md`;
> - `e2e/demos/`, and `scripts/build-site.ts` with `scripts/markdown.ts`;
> - `src/styles/app.css`.
>
> **When:** after the repository work (`docs/repository/REPOSITORY-BRIEF.md`) is merged and switched on, and **before Workspace Phase 4's Slice C**. One branch, `presentation`, with signed commits and one pull request. At every **⏸ Check-in**, stop, report and wait.

## Why

StyleCode's repository is linked from the owner's CV. Someone who has never seen it should be able to tell, within a minute:
- what StyleCode is and what problem it solves;
- what it looks like;
- what was hard about building it;
- how it's built and tested;
- what is finished, what is in progress, and what is planned;
- where the deeper documents are.

This is a presentation phase. It changes what people read and see, not what StyleCode does.

## What's there today (the reviewer's assessment, 18 November 2026)

**Keep:**
- **The product's own look.** Midnight surfaces, electric blue for what the user does, melon for what the AI proposes, Inter, and the small logo mark (`public/favicon.svg`). The screenshots in this style are clean and credible.
- **`docs/editor.png`:** shows the idea "the canvas is the prompt" in one image: a note pinned to a card, the AI's suggestions, and the code beside the canvas.
- **The honesty:**
  - "the reply in this recording comes from a scripted stand-in model";
  - measured numbers with their caveats;
  - the plain-English licence summary.
- **`npm run demos`:** the repeatable recordings, so media can be regenerated rather than hand-made.
- **The deep documents:** the guide, `ARCHITECTURE.md`, the ADRs, the specs and the research write-ups. They are the evidence; the README should point to them, not repeat them.

**Fix:**
1. **The identity is split.** The first line says "a local-first visual UI editor"; the consulting workspace, now most of the work and the most distinctive part, starts halfway down. A reader can't tell what StyleCode *is*.
2. **It's out of date and contradicts itself.** "All five phases of the roadmap are complete (version 0.5.0)" sits next to a workspace whose Phase 4 is in progress. The three GIFs and `docs/editor.png` show the editor before the workspace; its top bar still says "Projects".
3. **It's a manual, not a landing page.** 239 lines:
   - two long shortcut tables;
   - AI provider setup;
   - a scripts table;
   - the project tree;
   - ten workspace bullets in one block;
   - a twenty-item feature list.

   The valuable content belongs in the guide and in `CONTRIBUTING.md`, one link away.
4. **The engineering is invisible.** Nothing up front shows:
   - the randomised layout-parity test against the browser;
   - the AI's changes as validated, undoable operations;
   - consent rules enforced in a versioned domain model;
   - quotes checked in code before a finding is shown;
   - transcription and speakers measured on the owner's laptop;
   - about 800 unit and 200 browser tests, with an accessibility check.
5. **No picture of the system.** There is no architecture or flow diagram.
6. **`docs/workspace.png` shows the least interesting screen.** It's a notes form. The record with its evidence, the review of AI proposals, the transcript with speakers, and the Record panel beside the canvas are all built and not shown.
7. **The repository's "About" panel and link preview** probably don't say what StyleCode is now. Check them in WP0.

## Decisions

The reviewer made these on the owner's behalf. Raise any that look wrong at the WP0 check-in.

### Identity

P1. **The identity is StyleCode's own interface, and its colours carry meaning.**

| Token | Value | Means |
| --- | --- | --- |
| Midnight to surface | `#05070c` to `#1f2532` | The ground |
| Text | `#f3f5fa` / `#a7afbf` | Content / secondary |
| **Electric blue** | `#2f7bff` | What the consultant does, and what code guarantees (checks, validated operations, consent gates) |
| **Melon** | `#ffa05c` | What the AI proposes |
| Green | the saved dot | Done, saved |
| Red | `#ff6b78` | Only for danger |

- Every visual follows the same split as the product: blue for you and the deterministic parts, melon for the AI's proposals. One look at a diagram shows the product's central principle: AI proposes, you decide, code checks.
- The typeface is Inter, as in the product. Inside SVG images it is `Inter, system-ui, -apple-system, 'Segoe UI', sans-serif`, because GitHub doesn't load web fonts into images.
- The logo mark is `public/favicon.svg`.
- No emoji, and no badge wall: at most two badges, CI and licence, in the palette's colours, and none if they clash with the banner.

P2. **What StyleCode is, in one line.** Lead with the whole product, with the editor's idea as the second line. A starting point to sharpen at WP0, as long as every word stays true:

> **StyleCode** — a local-first workspace for software consultants: from a consented client conversation, to a requirements record you've reviewed, to the interface design.
> *The canvas is the prompt. AI proposes; you decide; nothing leaves your computer unless you choose.*

Check every clause against what's built. "Nothing leaves your computer" holds only with a local model, so say "unless you choose a provider" or similar.

### The README as the landing page

P3. **Order and purpose of each section.** The first screen on a 1080p laptop answers what it is, why it matters, and what it looks like.
1. **Banner** (SVG, P6): the mark, the name, the one-line value, and three short labels: *Local-first · Consent-first · AI proposes, you decide*.
2. **Two sentences and the links:** the problem it solves (a consultant's meeting turns into scattered notes and a guessed spec; StyleCode turns it into a reviewed, traceable record and a design linked to it), then *Live demo* (say it's the editor only) · *Guide* · *Architecture* · *Roadmap*.
3. **From conversation to interface:** one diagram (SVG) of the flow:
   - **Consent** → **Capture:** record or import, transcribed on the computer;
   - → **Record:** the AI proposes findings, quotes are checked, you review;
   - → **Design:** the canvas in context, layers linked to findings;
   - → **Code:** HTML/CSS and React.

   Blue for the consultant and code, melon for the AI's steps, and each stage marked *built* or *in progress*.
4. **A visual tour:** four screenshots and at most two GIFs (P5), each with a one-line caption that says what it lets the consultant do, not what the screen contains.
5. **Engineering highlights:** five or six entries. Each says what was built, why it was hard, and links to its evidence (a test, an ADR, a research write-up with its numbers and caveats). Candidates, all built:
   - one design document, changed only through validated, invertible operations, with code compiled from it deterministically;
   - a layout engine that matches the browser's flexbox and grid, checked by a randomised parity test;
   - AI output constrained by a schema generated from the property registry, applied as a proposal you accept or reject as one undoable step;
   - consent rules C1 to C11 enforced by a pure, versioned domain model with migrations, gating every capture and every AI run;
   - extraction whose quotes are checked in code against the transcript before a finding is shown (precision and recall from `EXTRACTION.md`, with its "three short meetings" caveat);
   - transcription and speaker separation on the consultant's own GPU, measured on the laptop (from `TRANSCRIPTION.md`, labelled synthetic speech and a lower bound on errors);
   - local servers that keep API keys from the browser, and one folder per client with atomic saves and a lock;
   - the test suite: unit and browser counts on `main`, accessibility with axe, performance budgets for 5,000 layers, and signed, gated merges.
6. **Architecture at a glance:**
   - one diagram (SVG): the browser app (editor and workspace), the local Node servers (workspace, AI, transcription), a folder per client, Ollama on this computer, whisper.cpp and sherpa-onnx, and an external AI provider drawn dashed and marked "only where the session's consent allows";
   - one link to `ARCHITECTURE.md`.
7. **Status:** a compact table:
   - the editor: built, v0.5.0;
   - workspace phases 0 to 3: built;
   - Phase 4: designs in the engagement and the record beside the canvas built, the AI with the record in progress;
   - Phases 5 to 7: planned, one line each;
   - one line saying plainly that StyleCode isn't yet used with real clients: the consent wording awaits a POPIA review, and transcription is measured on synthetic speech.
8. **Quick start:** `npm install` and `npm start`, what opens, and links to the guide. No more than ten lines.
9. **Documentation:** a table of the main documents, one line each (guide, architecture, roadmap, decisions, specs, research, phase briefs, contributing).
10. **How it's built:** one short paragraph:
    - designed and directed by Joshua Heath;
    - implemented with Claude Code from written phase briefs;
    - each phase reviewed independently, every change tested, every merge gated and signed;
    - links to `docs/legal/AUTHORSHIP.md`, the decisions and the briefs.

    It's accurate, and it shows a disciplined process. Don't hide or play down the AI's part.
11. **Ownership and licence:** the short section the repository work added.

**Length:** about 150 lines of Markdown at most, readable in two minutes. Short paragraphs; tables where comparing helps.

P4. **Nothing useful is lost; it moves.**

| From the README | To |
| --- | --- |
| The editor's shortcut tables | `docs/GUIDE.md`, a "Shortcuts" section (next to "Keyboard and screen readers") |
| AI provider setup and where keys go | `docs/GUIDE.md`, "Working with the AI" |
| Code and export table | `docs/GUIDE.md`, "Code and export" |
| "Your data" | `docs/GUIDE.md`, "Where client data lives" / "Saving and getting work back" |
| Project structure, scripts, tech | `CONTRIBUTING.md` |
| The long feature list | The guide's sections, and the README's tour and highlights |

Every link and anchor into these sections (in the docs, the site and the app's own help links, if any) is updated. Add a **link check**: `scripts/check-links.ts`, with no new dependency. It checks relative links, images and `#anchors` in every tracked Markdown file. It runs in the quick-checks job and is a required check.

### Visual material

P5. **Screenshots and GIFs, made by `npm run demos`:**
- **The data:** role-played: Harbour Bakery and Karoo Freight, never anything real.
- **Size:** 2× (2880×1800 or a tighter crop), with no screenshot over about 600 KB.
- **The four screens:**
  1. the AI's proposals beside the highlighted transcript passage, in melon, with a quote checked;
  2. a transcript with speakers matched and "may be misheard" words marked;
  3. the editor on a client's design, with the Record panel open and a layer showing its linked findings;
  4. the editor with a note, an AI proposal and the code beside the canvas (today's `docs/editor.png`, re-recorded with the current top bar).
- **The GIFs:** at most two, re-recorded for the current interface: "sketch to layout to code" and "a note the AI follows". About 3 MB each at most; drop frames or shorten scenes before lowering quality.
- **ffmpeg** is needed for the GIFs (as today). Install it on the laptop with `winget` if it's missing. It's a tool on the laptop, not a dependency. If Windows asks for permission, tell the owner what to click.
- **Old media** that's no longer used is deleted in the same pull request.

P6. **The banner and diagrams are hand-written SVG** in `docs/media/`:
- small (about 30 KB each at most) and diffable;
- with their own dark rounded background, so one file looks deliberate on GitHub's light and dark themes alike, with no `<picture>` switching;
- system fonts, as in P1;
- full alt text describing what each shows;
- checked by rendering each at 1× and 2× in Chromium (a temporary script, not committed) and looking at the result.

No Mermaid and no diagram tools. Mermaid would look generic and wouldn't render on the docs site.

P7. **The docs site shows the same README.** `scripts/build-site.ts` renders the README as `index.html`, and `scripts/markdown.ts` escapes most raw HTML. So the README uses plain Markdown (images, tables, links, `<kbd>`), which renders the same on GitHub and on the site. If an HTML element is truly needed, add it to `markdown.ts`'s allowed list with a test. Update the site's title (`index.html`) to match P2. Check the built site in Chromium at desktop and phone widths.

P8. **The repository's About panel and link preview:**
- **Description:** P2's line.
- **Website:** the Pages demo.
- **Topics:** 8 to 12, each accurate. For example: `local-first`, `requirements-engineering`, `consulting`, `ui-editor`, `design-to-code`, `react`, `typescript`, `vite`, `whisper`, `ollama`, `playwright`, `accessibility`.
- **A social preview image:** 1280×640 PNG, `docs/media/social-preview.png`, made by `npm run demos` from an HTML page in the same style. This is what LinkedIn and messaging apps show when the link is shared.

Apply the description, website and topics with `gh repo edit` after the owner's yes (WP4). GitHub has no API for the social preview, so the owner uploads it: Settings → General → Social preview.

### Accuracy and upkeep

P9. **Accuracy rules:**
- Every number comes from a document in the repository and carries its caveat.
- No "production-ready", "enterprise-grade", "AI-powered" or similar.
- Built, in progress and planned are always marked.
- The live demo is said to be the editor only, with AI off.
- Screenshots use role-played data.
- If a highlight can't be backed by a test, an ADR or a measurement, leave it out.

P10. **It stays current:**
- `CLAUDE.md` gains a rule: each phase's docs work package updates the README's status table, tour and highlights when users would notice the change, and re-records media with `npm run demos`.
- Phase 4's Slice C does this for "the AI with the record".

P11. **No product changes.** This changes only:
- Markdown;
- `docs/media/`;
- `e2e/demos/`;
- the site builder and `markdown.ts`;
- the link checker;
- `CLAUDE.md`.

Every existing test stays green.

## Work packages

### WP0: Assess and propose

1. Update `main`, create `presentation`, and run every check.
2. Read the repository as a newcomer would. Read the About panel with `gh repo view --json description,homepageUrl,repositoryTopics`.
3. Extend the assessment above with anything it missed.
4. Write the draft `README.md` with the final headings, the one-line value (P2), and placeholders for images.
5. Make first drafts of the banner and the flow diagram as SVG.
6. Push the branch, so the owner can open the draft README on GitHub, rendered.

⏸ **Check-in:**
- the branch link to the rendered draft README;
- the banner and flow diagram at 2× as PNG (attach the files' paths);
- the one-line value;
- the screenshot list;
- anything in this brief that looks wrong.

### WP1: The visual material (P5, P6)

- The four screenshots, the two GIFs, the banner, both diagrams, and the social preview, all from `npm run demos` or hand-written SVG.
- Delete the old media.

### WP2: The words (P3, P4, P7, P9)

- The final README.
- The moves into the guide and `CONTRIBUTING.md`.
- The link checker in CI.
- The site builder updated, and the site checked at desktop and phone widths.

### WP3: Review and pull request

1. Run an independent review subagent. Ask it to:
   - read the README cold, as a recruiter and as an engineer, and say what it understood in 60 seconds, against "Why" above;
   - check every claim and number against the repository;
   - check that every link works;
   - check that nothing from the old README was lost.
2. Fix what it finds.
3. Push and open the pull request.

⏸ **Check-in:**
- the pull request link and CI;
- the link to the rendered README on the branch;
- the README's line count;
- the media sizes;
- the reviewer subagent's 60-second summary;
- the About-panel text and topics to apply.

### WP4: The About panel (P8)

After the owner's yes and the merge:
1. Apply the description, website and topics.
2. Read them back.
3. Tell the owner exactly how to upload the social preview image.

## Definition of done

- [ ] A newcomer can say within a minute what StyleCode is, what it looks like, what's impressive about it, and what's finished. The review's 60-second summary says so.
- [ ] The README is at most about 150 lines, in P3's order, in P1's identity, with every claim backed and its status marked.
- [ ] Four current screenshots, at most two current GIFs, the banner and two diagrams, all role-played or hand-written, within the size limits.
- [ ] Nothing useful lost: the guide and `CONTRIBUTING.md` hold what moved, and the link check passes in CI.
- [ ] The docs site renders the new README at desktop and phone widths.
- [ ] The About panel set and read back; the social preview image made, and the owner told how to upload it.
- [ ] No product code changed; every test green; signed commits; an independent review done; merged by the owner.
