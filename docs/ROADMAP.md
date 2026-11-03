# StyleCode roadmap

Each phase leaves the app working and builds on the previous one without restructuring it. Phases are ordered by technical dependency.

## The first genuinely useful version (MVP)

> Sketch a screen on the canvas → tidy it into auto-layout → export clean HTML/CSS or React → select part of it and ask a local or hosted AI to change it, with a preview you accept or reject.

That is the smallest version that proves the core idea: visual input and AI working on the same structure, with real code at the end. It is reached at the end of Phase 4.

## Changed from the original brief

**Design-to-code (now Phase 3) comes before AI (now Phase 4).** The AI's most valuable edits, such as "make this responsive", "turn this into a navigation bar" or "align these as a row", are expressed in terms of auto-layout and semantic roles. Those concepts have to exist in the model first. Shipping code export first also makes the no-AI mode properly useful, which the brief requires anyway.

**Undo/redo moved into Phase 1.** It is not a feature on top of the model; it falls out of the operation system that the AI will also use, so it belongs in the foundation.

## Phase 1: Foundation ✅

- Vite + React + TypeScript project, minimal dependencies
- Design system: midnight surfaces, electric blue for selection, cantaloupe for drop targets (and later AI)
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
- Wrapping rows and grid layout (Phase 3, where responsive export needs them)

## Phase 3: Design to code

- HTML/CSS generator and React generator, both pure functions of the document
- Code panel beside the canvas: selecting a layer highlights its code; editing a layer's CSS declarations writes back to the design
- Live preview of the generated code in a sandboxed iframe at desktop, tablet and mobile widths
- Responsive output from auto-layout; absolutely positioned content exported faithfully but flagged
- Wrapping rows and a simple grid layout, so card grids reflow at narrow widths
- Export a project as a ZIP (static site or a minimal Vite React app)
- Snapshot tests that pin generated code for known documents

## Phase 4: AI collaboration

- Provider abstraction: Ollama (local), OpenAI-compatible endpoints (LM Studio, llama.cpp, OpenRouter, Groq, OpenAI) and Anthropic
- Local proxy route in the dev/preview server that holds API keys from a local config file; keys never reach the browser
- Settings: provider, model, connection check, context size; a clear no-AI default
- Context builder: selection, ancestors, siblings, frame summary, short id aliases, schema from the property registry
- Schema-constrained responses; validation, AI policy (scope, locked layers) and one repair attempt
- Assistant bar docked to the tool dock: selection-aware prompt, streamed explanation, proposals previewed on the canvas in cantaloupe, accept/reject, undo
- Prompt suggestions based on what is selected

## Phase 5: Refinement and presentation

- Onboarding: a short interactive first run, empty states that teach, shortcut reference
- Accessibility pass on the editor itself (keyboard-only editing of layers and properties, screen-reader labels)
- Error handling and recovery for storage, files and providers
- Performance pass against large documents
- Annotations: sketch arrows and notes on the canvas that the AI reads as instructions (the "mark up a printout" interaction)
- Editor polish carried over from Phase 2: per-corner radius, equal-spacing guides and distance labels
- Documentation site, demo GIFs, contribution guide, GitHub presentation
