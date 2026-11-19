# Identity and presentation: StyleCode's new look, and its front door

> **For Claude Code.** Read these first:
> - `CLAUDE.md`;
> - this brief;
> - `src/styles/app.css` and every component that draws app chrome;
> - `README.md`, `docs/GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` and `CONTRIBUTING.md`;
> - `docs/research/EXTRACTION.md` and `docs/research/TRANSCRIPTION.md`;
> - `e2e/demos/`, `scripts/build-site.ts` and `scripts/markdown.ts`.
>
> **When:** after the repository work (`docs/repository/REPOSITORY-BRIEF.md`) is merged and switched on, and **before Workspace Phase 4's Slice C**. Two parts, each on its own branch with signed commits and its own pull request:
> - **Part 1, `identity`:** the app takes the new look.
> - **Part 2, `presentation`:** the README and repository present it.
>
> At every **⏸ Check-in**, stop, report and wait.
>
> Revised 18 November 2026 (afternoon): the owner chose a new visual identity from a reference image, and asked for it to carry through to the README.

## Why

StyleCode's repository is linked from the owner's CV. Someone who has never seen it should be able to tell, within a minute:
- what StyleCode is and what problem it solves;
- what it looks like;
- what was hard about building it;
- how it's built and tested;
- what is finished, in progress and planned;
- where the deeper documents are.

The owner has also chosen a new look for the product itself. The README should show the product as it really looks, so the app changes first and the README follows.

This brief meets the same standard as the owner's other project, Culprit (its delivery plan of 18 November): real pictures only, a rendered hero, no badge wall or emoji, every claim checked, and depth moved into the guide. Each project keeps its own identity.

## The reference, and what is taken from it

The owner's reference image shows another company's brand. **It is someone else's work, and it isn't committed, copied or named** anywhere in the repository; nor is that brand's name, wordmark, logo or photography. Only three colours and three general ideas are taken from it:

| From the reference | Value |
| --- | --- |
| Charcoal | `#121212` |
| Warm white | `#FDF9EA` |
| Orange | `#FE5105` |

1. A near-monochrome ground with **one hot accent**.
2. **Heavy, slanted display type** for the name and the big moment on a screen.
3. **A construction grid:** hairline lines and a slanted guide, like letterforms drawn on a layout grid.

The third fits StyleCode well: a design canvas *is* a grid with guides.

## Decisions

The reviewer made these on the owner's behalf. Raise any that look wrong at Part 1's WP0 check-in. The owner can overrule any of them.

### Part 1: the identity in the app

I1. **The colours keep StyleCode's central meaning: you decide, the AI proposes.** Today blue is the consultant's and melon is the AI's (Phase 1's ground rules, Phase 4's clarifications). The new palette has one accent, so:

| Role | Value | Used for |
| --- | --- | --- |
| **The canvas** (ground) | Charcoal `#121212`, with surfaces by lightness alone: `#0B0B0B` wells, `#1A1A1A` and `#222222` raised, `#2B2B2B` the highest | Every surface |
| **You** | Warm white `#FDF9EA`, with muted `#B9B5A8` and subtle `#8F8C82` text | Text; primary buttons (warm-white fill, charcoal text); selection, handles, focus rings, links (underlined); the consultant's marks (confirmed status, layer links, the Record panel) |
| **The AI's proposal** | Orange `#FE5105`, with a soft fill at about 14% | Only what the AI proposes or does: the proposal on the canvas, the assistant's accent and sparkle, AI-proposed findings under review, "Drew on" |
| **Saved, done** | Green `#3DD68C` | The saved dot, success |
| **Danger** | Pink-red `#FF5C8A` | Delete, withdraw, errors |

In one line: **charcoal is the canvas, warm white is you, orange is the AI.** It's the same split as today, and it stays within the reference's palette.

I2. **Contrast and separation, measured by the reviewer.**

| Pair | Ratio |
| --- | --- |
| Warm white on charcoal | 17.8:1 |
| Orange on charcoal | 5.7:1 |
| Orange on `#222222` | 4.8:1 |
| Orange on `#2B2B2B` | 4.3:1 |
| Charcoal on orange | 5.7:1 |
| Warm white on orange | 3.1:1 |
| Orange on warm white | 3.1:1 |
| Muted `#B9B5A8` on charcoal | 9.1:1 |
| Subtle `#8F8C82` on charcoal | 5.6:1 |
| Danger on charcoal | 6.4:1 |

What follows from them:
- **Text on an orange fill is charcoal.** Warm white on orange only for display text of 24 px and up, or 18.7 px bold.
- **Orange text** only on surfaces up to `#222222`. It fails 4.5:1 on `#2B2B2B`.
- **Orange on warm white** only as a filled block with charcoal text.
- **Danger is 35° of hue from orange** (343° against 18°). Every danger and AI colour also carries its word or icon, so neither depends on colour alone.

Re-measure every pair in WP0 and adjust tints to keep them, rather than relaxing the rule. The existing `e2e/accessibility.spec.ts` (axe) stays green throughout.

I3. **Type.**
- **Inter**, as today, for everything read.
- **The display voice:** Inter at 800 in its **true italic**, which the installed `@fontsource-variable/inter` package already ships (`wght-italic.css`, so no new dependency). It's used with tight tracking for the wordmark and one large moment per screen: the welcome screen's title, a client's name on its page, and empty states.
- **Never a slanted body text, and never a faked italic.**

I4. **The construction grid motif, used sparingly:** hairline lines in warm white at very low opacity, with one slanted guide at the italic's angle. It appears on the welcome screen, empty states, the recovery screen, the README hero and the social preview; **never behind data, the canvas or a form.**

I5. **The mark.** `public/favicon.svg` becomes a warm-white square with an orange dot, the same idea as today's blue square and orange dot, in the new colours. A new `docs/brand/` holds `mark.svg`, `wordmark.svg` (Inter 800 italic, outlined) and a one-page `docs/brand/IDENTITY.md` with I1 to I7, so future work follows it.

*Note to I5, 19 November 2026:* there is no outlined `wordmark.svg`, and no font library to outline one. The wordmark is set live in Inter 800 italic in `docs/brand/`'s HTML pages, and Part 2 renders it into the hero and the social preview with Playwright (P5).

I6. **Tokens by role, and restraint checked.**
- **Rename** `app.css`'s colour tokens by role (for example `--you`, `--ai`, `--ai-soft`, `--ok`, `--danger` and `--surface-1…5`) in place of colour names (`--blue`, `--melon`). The rename is mechanical, across every use.
- **A token check,** `scripts/check-tokens.ts` with no new dependency, in the quick-checks job:
  - no colour literal in app chrome (`src/app`, `src/panels`, `src/canvas`'s overlays, `src/ui`, `src/workspace/ui`, `src/styles`) outside the token definitions;
  - `--ai` and `--ai-soft` used only in the files declared to show the AI's work.

  Each rule gets a mutation shown failing.
- **Design content is not app chrome.** The example design, the blocks, codegen defaults and users' designs keep their own colours: they are the user's work, not StyleCode's.

I7. **What else changes, and what doesn't.**
- **Restyled:**
  - the canvas's affordances: selection, handles, marquee, guides, distances, drop lines and frame labels, in warm white with a charcoal halo so they show on light designs too, and never in orange;
  - notes, as warm-white "paper" with charcoal text, because they're the user's instructions;
  - the AI proposal, in orange;
  - every panel, menu, dialog and workspace page, through the tokens;
  - the docs site's CSS (`scripts/build-site.ts`), with the same tokens.
- **Unchanged:**
  - **Behaviour.** Every existing test still asserts what it did before.
  - **Motion:** none added beyond what exists. The reduced-motion behaviour stays.
  - **The theme:** dark only. No light theme in the app.
- **Words in the docs:**
  - "Its proposal appears in cantaloupe" and similar become "in orange";
  - "the consultant's, in electric blue" becomes "in warm white";
  - this covers the guide, the README, `ARCHITECTURE.md`, `docs/phase-4/PHASE-4-BRIEF.md`'s clarifications (with a dated note), and `CLAUDE.md`'s interface rule.

### Answers at Part 1's WP0 check-in (19 November 2026)

The owner saw the proposal on two screens and approved the look. The reviewer answered WP0's points on his behalf; they add to I1 to I7 and go into `docs/brand/IDENTITY.md`.

I8. **Orange is only the AI's.** Every use of orange that isn't the AI's work becomes warm white or neutral: snap guides, drop and insert marks, the note's arrow, the code's syntax colours, the "Changed" badge, the preview icon, and anything else that used it outside the AI's files. The token check enforces it.

I9. **Warning yellow** `#F2C94C` stays as its own role, `--warn` (11.8:1 on charcoal, 8.9:1 on `#2B2B2B`; hue 45°, against orange's 18°): consent warnings, read-only states, "Suggested (not agreed yet)". It always comes with its word or icon.

I10. **Three more contrast rules** for I2, enforced by the token check where it can:
- no orange text on the orange soft fill (4.49:1 over `#1A1A1A`);
- the subtle grey only on surfaces up to `#222222` (4.20:1 on `#2B2B2B`);
- filled danger buttons take charcoal text (warm white on danger is 2.78:1).

I11. **Surfaces and greys.**
- A fifth raised step, `#333333`, for pressed buttons and tooltips only (warm white 12.0:1, muted 6.2:1; never the subtle grey on it).
- `#5E5B54` is for disabled text only (2.8:1; disabled controls are exempt).
- Code comments are read, so they take the subtle grey `#8F8C82`.

I12. **Notes.** Notes are never exported to code, and every saved note stores its own colour, so new notes default to warm white (`#FDF9EA`) with charcoal text: the peach default (`#FFD8A8`, hue 33°) read as part of the AI's orange family. Saved notes keep their colour, and the other swatches stay.

I13. **Smaller decisions.**
- The focus ring's offset is 2px, so it shows around the warm-white primary button.
- The AI's badge ("Proposed by the AI") is outlined in orange rather than filled: on a selected proposal a filled badge stacked two soft fills (3.74:1).
- A selected proposal's orange fill is 8%.
- "Ask the AI for findings" is a warm-white button (the consultant asks), with its sparkle in orange (the AI).

### Part 2: the README and the repository

P1. **What StyleCode is, in one line.** Lead with the whole product, with the editor's idea as the second line. A starting point to sharpen in Part 2's WP0, as long as every word stays true:

> **StyleCode**: a local-first workspace for software consultants. From a client conversation recorded with consent, to a requirements record you've reviewed, to the interface design.
> *The canvas is the prompt. The AI proposes; you decide.*

Don't claim "nothing leaves your computer" without "with a local model".

P2. **Order, and what each section is for.** The first screen on a 1080p laptop answers what it is, why it matters, and what it looks like.
1. **The hero** (P5): charcoal field, the construction grid, the wordmark large in Inter 800 italic with the mark, the one line, and three labels in small warm-white capitals: *Local-first · Consent-first · The AI proposes, you decide*. One orange element only: the AI's part.
2. **Two sentences and the links:** the problem (a consultant's meeting becomes scattered notes and a guessed spec; StyleCode turns it into a reviewed, traceable record and a design linked to it), then *Live demo* (say it's the editor only, with AI off) · *Guide* · *Architecture* · *Roadmap*.
3. **From conversation to interface:** one diagram (P5) of the flow:
   - **Consent** → **Capture:** record or import, transcribed on this computer;
   - → **Record:** the AI proposes findings, quotes are checked in code, you review;
   - → **Design:** the canvas in context, layers linked to findings;
   - → **Code:** HTML/CSS and React.

   Warm white for you and code, orange for the AI's steps, and each stage marked *built* or *in progress*.
4. **A visual tour:** four screenshots and at most two GIFs (P4), each with a one-line caption that says what it lets the consultant do.
5. **Engineering highlights:** five or six entries. Each says what was built, why it was hard, and links its evidence (a test, an ADR, a research write-up with its numbers and caveats). Candidates, all built:
   - one design document changed only through validated, invertible operations, with code compiled from it deterministically;
   - a layout engine that matches the browser's flexbox and grid, checked by a randomised parity test;
   - AI output constrained by a schema from the property registry, applied as a proposal you accept or reject as one undoable step;
   - consent rules C1 to C11 enforced by a pure, versioned domain model with migrations, gating every capture and AI run;
   - extraction whose quotes are checked in code before a finding is shown (`EXTRACTION.md`'s precision and recall, with its "three short meetings" caveat);
   - transcription and speakers on the consultant's own GPU, measured on the laptop (`TRANSCRIPTION.md`, labelled synthetic speech and a lower bound on errors);
   - local servers that keep API keys from the browser, and one folder per client with atomic saves and a lock;
   - the tests: accessibility with axe, performance budgets for 5,000 layers, and gated, signed merges.
6. **Architecture at a glance:**
   - one diagram (P5): the browser app (editor and workspace), the local Node servers (workspace, AI, transcription), a folder per client, Ollama on this computer, whisper.cpp and sherpa-onnx, and an external AI provider drawn dashed and marked "only where the session's consent allows";
   - one link to `ARCHITECTURE.md`.
7. **Status:** a compact table:
   - the editor: built, v0.5.0;
   - workspace phases 0 to 3: built;
   - Phase 4: designs in the engagement and the record beside the canvas built, the AI with the record in progress;
   - Phases 5 to 7: planned, one line each;
   - one plain line: not yet used with real clients, because the consent wording awaits a POPIA review and transcription was measured on synthetic speech.
8. **Quick start:** `npm install`, `npm start`, what opens, and links to the guide. No more than ten lines.
9. **Documentation:** a table of the main documents, one line each.
10. **How it's built:** one short paragraph:
    - designed and directed by Joshua Heath;
    - implemented with Claude Code from written phase briefs;
    - each phase reviewed independently, every change tested, every merge gated and signed;
    - links to `docs/legal/AUTHORSHIP.md`, the decisions and the briefs.

    It's accurate, and it shows a disciplined process. Don't hide or play down the AI's part.
11. **Ownership and licence:** the short section the repository work added.

**Length:** about 150 lines of Markdown at most. No shields.io badges and no emoji. GitHub's own CI status badge is allowed, once, now that the checks are required.

P3. **Nothing useful is lost; it moves.**

| From the README | To |
| --- | --- |
| The editor's shortcut tables | `docs/GUIDE.md`, a new "Shortcuts" section |
| AI provider setup and where keys go | `docs/GUIDE.md`, "Working with the AI" |
| Code and export table | `docs/GUIDE.md`, "Code and export" |
| "Your data" | `docs/GUIDE.md`, "Where client data lives" and "Saving and getting work back" |
| Project structure, scripts, tech | `CONTRIBUTING.md` |
| The long feature list | The guide's sections, and the README's tour and highlights |

Every link and anchor into these is updated.

P4. **Every picture is real,** made by `npm run demos` after Part 1, from role-played data (Harbour Bakery, Karoo Freight), at 2×, with no screenshot over about 600 KB. The four screens:
1. the AI's proposals beside the highlighted transcript passage, in orange, with a quote checked;
2. a transcript with speakers matched and "may be misheard" marked;
3. the editor on a client's design, with the Record panel open and a layer showing its linked findings;
4. the editor with a note, an AI proposal and the code beside the canvas.

The GIFs:
- at most two, re-recorded: "sketch to layout to code" and "a note the AI follows";
- about 3 MB each at most, shortened rather than degraded;
- made with ffmpeg, as `npm run demos` already needs: install it with `winget` if it's missing, and tell the owner what to click if Windows asks;
- old media no longer used is deleted.

P5. **The hero, the diagrams and the social preview are rendered, not drawn by hand,** as Culprit's are:
- **The sources:** HTML pages in `docs/brand/` (`hero.html`, `flow.html`, `architecture.html`, `social.html`), using the app's tokens and the installed Inter fonts.
- **Rendering:** Playwright (already in the repository) renders them to PNG at 2× through `npm run demos`, so they're regenerated like the screenshots.
- **The images:**
  - hero 3200×1000, shown at half size;
  - diagrams at their natural size;
  - `social-preview.png` 1280×640.
- **Background:** each carries its own charcoal field, so one file looks deliberate on GitHub's light and dark themes.
- **Full alt text** on every image.
- **No Mermaid,** which wouldn't render on the docs site, and no new tools.

P6. **The docs site shows the same README.** `scripts/markdown.ts` escapes most raw HTML, so the README uses plain Markdown (images, tables, links, `<kbd>`), which renders the same on GitHub and the site. If an element is truly needed, add it to the allowed list with a test. The site's title follows P1. Check it in Chromium at desktop and phone widths.

P7. **Truth is checked.** `scripts/check-readme.ts`, with no new dependency, in the quick-checks job, checks:
- every relative link, image and `#anchor` in every tracked Markdown file resolves;
- every figure the README quotes from a research document sits next to a link to that document's section, and appears in that section;
- the README names no counts that drift with every merge (test totals, file counts) unless they are generated.

Each check gets a mutation shown failing. Everything else is checked by hand in the review:
- no "production-ready", "enterprise-grade" or "AI-powered";
- built, in progress and planned always marked;
- role-played data only;
- if a highlight can't be backed by a test, an ADR or a measurement, it's left out.

P8. **The About panel and link preview:**
- **Description:** P1's line.
- **Website:** the Pages demo.
- **Topics:** 8 to 12, accurate. For example: `local-first`, `requirements-engineering`, `consulting`, `ui-editor`, `design-to-code`, `react`, `typescript`, `vite`, `whisper`, `ollama`, `playwright`, `accessibility`.

Apply them with `gh repo edit` after the owner's yes. The owner uploads `social-preview.png` (Settings → General → Social preview); GitHub has no API for it.

P9. **It stays current.**
- `CLAUDE.md` gains two rules:
  - new interface follows `docs/brand/IDENTITY.md`;
  - each phase's docs work package updates the README's status, tour and highlights when users would notice, and re-records media with `npm run demos`.
- Phase 4's Slice C does this for "the AI with the record", in the new colours.

## Work packages

### Part 1: `identity`

**WP0: Assess and propose.**
1. Update `main`, create `identity`, and run every check.
2. List every place app chrome sets a colour (tokens and literals), and which files show the AI's work.
3. Re-measure I2's pairs.
4. Apply the tokens to two screens only, as a proposal:
   - the editor with an AI proposal on the canvas, a note and the code panel;
   - a session page with its consent panel and the record.

⏸ **Check-in:**
- the two screens at 2×, in the new look and today's, side by side;
- the token table with its measured contrasts;
- the list of colour literals found;
- anything in this brief that looks wrong.

The owner judges the look here, before the rest is restyled.

**WP1: Tokens and the check.** The renamed tokens (I6), `scripts/check-tokens.ts` with its mutations, and the type (I3).

**WP2: Every screen.** The canvas affordances, notes and the proposal; then the panels, menus, dialogs, the welcome and recovery screens, every workspace page, and the docs site. Then the mark and `docs/brand/` (I5), and the motif where I4 allows. Update every test whose fixture names a colour, and change no assertion about behaviour.

**WP3: Review and pull request.**
1. Run an independent review subagent: contrast on every screen, orange only on the AI's work, nothing behaving differently, the reference never committed or named.
2. Fix what it finds, push, and open the pull request.

⏸ **Check-in:**
- the pull request link and CI;
- every main screen at 1440×900, 2×;
- one screen with a light-coloured design on the canvas, showing the selection;
- the docs site's home page.

### Part 2: `presentation`

**WP4: Draft.**
1. After Part 1's merge, create `presentation`.
2. Read the repository as a newcomer would, including the About panel (`gh repo view --json description,homepageUrl,repositoryTopics`).
3. Write the draft `README.md` with P2's headings and P1's line, and the hero's first render.
4. Push the branch, so the owner can open the draft README on GitHub, rendered.

⏸ **Check-in:**
- the link to the rendered draft;
- the hero at 2×;
- the screenshot list.

**WP5: The pictures** (P4, P5). Run `npm run demos` for the four screenshots, two GIFs, hero, two diagrams and the social preview, and delete the old media.

**WP6: The words** (P2, P3, P6, P7). Write the README, move the content into the guide and `CONTRIBUTING.md`, add the README check in CI, and check the site.

**WP7: Review and pull request.**
1. Run an independent review subagent. Ask it to read the README cold, as a recruiter and as an engineer, and say what it understood in 60 seconds; check every claim and number against the repository; check that every link works; and check that nothing from the old README was lost.
2. Fix what it finds, push, and open the pull request.

⏸ **Check-in:**
- the pull request link and CI;
- the link to the rendered README;
- its line count and media sizes;
- the 60-second summary;
- P8's text to apply.

**WP8: The About panel.** After the owner's yes and the merge, apply P8, read it back, and tell the owner how to upload the social preview.

## Definition of done

- [ ] The app wears I1 to I7: charcoal ground, warm white for you, orange only for the AI; every pair measured; axe green; the token check and its mutations in CI; no behaviour changed
- [ ] The mark, `docs/brand/` and `IDENTITY.md`; the docs site in the same identity
- [ ] A newcomer can say within a minute what StyleCode is, what it looks like, what's impressive and what's finished, as the 60-second review summary shows
- [ ] The README is at most about 150 lines, in P2's order, every claim backed and its status marked; the README check in CI with its mutations
- [ ] Four current screenshots, at most two current GIFs, and a rendered hero, diagrams and social preview, all within the size limits
- [ ] Nothing useful lost; the docs site renders the new README at desktop and phone widths
- [ ] The About panel set and read back; the social preview made, and the owner told how to upload it
- [ ] The reference image, its brand's name and its artwork appear nowhere in the repository
- [ ] Signed commits, an independent review per part, two pull requests merged by the owner
