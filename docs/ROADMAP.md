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
- **Local AI server**: a Vite plugin mounts `/api/ai` on the dev and preview servers. It keeps settings and API keys in `~/.stylecode/ai.json` (mode 0600) or reads them from environment variables, calls the provider and streams the reply. Keys never reach the browser and are only sent to the saved address (a saved key is forgotten when its address changes); the routes only answer StyleCode's own page, from this computer
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
