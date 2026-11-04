# StyleCode architecture

This document explains what StyleCode is trying to be, the decisions that shape the codebase, and why they were made. It is written for contributors and for anyone evaluating the project.

## 1. The product, and what makes it different

Prompt-to-UI generators (type a description, get a page) and visual site builders both exist and are good. A third prompt-to-React tool would add nothing. StyleCode's bet is narrower and more interesting:

> **The canvas is the prompt.**

When you draw three boxes, select one and say "make this an image card", the drawing has already told the AI almost everything text struggles with: *which* element you mean, where things are, how big they are, what contains what, and roughly what layout you have in mind. StyleCode treats that spatial, structural input as the primary channel to the AI, and keeps text for intent ("more premium", "make it responsive").

Three design rules follow from that bet, and they explain most of the architecture:

1. **One document is the single source of truth.** The canvas, the panels, undo/redo, persistence, the AI and the code generators all read and write the same design document. Nothing keeps its own copy.
2. **Everything changes through operations.** Manual edits and AI edits are the same thing: a small batch of validated operations that can be inverted. That is what makes AI changes reviewable, targeted and undoable.
3. **Code is compiled, not generated.** The AI never writes code. It proposes operations on the document, and deterministic generators turn the document into HTML/CSS or React. The canvas, the code and the preview cannot drift apart because there is only one thing to drift from.

A useful consequence of rule 3: small local models become viable. A 4–8B model running in Ollama struggles to write a whole page of correct React, but it can reliably produce ten lines of JSON like `{"op":"update","id":"e3","set":{"radius":16}}`, especially with schema-constrained decoding.

## 2. System overview

```
             ┌──────────────────────── browser (local) ────────────────────────┐
             │                                                                  │
 pointer ──▶ │  Canvas gestures ─┐                                              │
 keyboard ─▶ │  Shortcuts ───────┼──▶ commands ──▶ operations ──▶ Editor store │
 panels ───▶ │  Property panel ──┘                    ▲              │          │
             │                                        │              ▼          │
             │  AI assistant ──▶ proposed operations ─┘     design document     │
             │                    (validated, previewed)          │             │
             │                                  ┌─────────────────┼──────────┐  │
             │                                  ▼                 ▼          ▼  │
             │                            canvas (DOM)   code generators  IndexedDB
             │                                          → code panel,    + files │
             │                                            preview, ZIP            │
             └──────────────────────────────────────────────────────────────────┘
             local server (Vite dev/preview): AI route, holds API keys, calls the provider
```

Source layout:

| Folder | Responsibility | May import |
| --- | --- | --- |
| `src/model` | Document types, property registry, operations, geometry, commands, the auto-layout engine and layout inference, file format. Pure TypeScript, no React, no DOM. | nothing outside `model` |
| `src/editor` | The editor store (document + editing state), history, camera, React bindings. | `model` |
| `src/render` | The single design-property → CSS mapping. | `model` |
| `src/codegen` | Code generation: screens as element trees, HTML/CSS and React printers, CSS → design parsing, site and app export, ZIP. Pure TypeScript, no DOM. | `model`, `render` |
| `src/canvas` | Canvas viewport, layer rendering, overlay, pointer gestures, snapping, text measurement, the layout normaliser. | `model`, `editor`, `render`, `ui`, and the shared actions and inserts in `app` |
| `src/panels` | Layers, insert, properties and code panels and their controls. | everything above |
| `src/persistence` | IndexedDB storage, image assets, project files, example project. | `model`, `editor` |
| `src/ai` | The assistant: context builder, instructions, response schema, interpretation and AI policy, suggestions, the client for the local server. | `model`, `editor` |
| `src/app` | App shell, top bar, tool dock, assistant bar, AI settings, shortcuts, shared actions, inserting images and blocks, preview and export, onboarding, the screen-reader announcer and the recovery screen. | everything |
| `src/ui` | Generic UI: icons, menus, dialog focus handling, error boundaries. | nothing app-specific |
| `server/ai` | The local AI server (a Vite plugin): settings and keys, provider adapters, streaming. Runs in Node, never in the browser. | Node only |
| `server/shared` | Node helpers shared by the local servers, such as the rename that retries on Windows. | Node only |

The `model` layer is the part that matters most and is tested most heavily. Everything above it is a view or an input method. Unit tests (Vitest) sit next to the code they test; browser tests (Playwright) live in `e2e/` and drive the real app.

## 3. The design document

The document is a flat map of nodes plus a root id:

```ts
interface DesignDocument { id; name; rootId; nodes: Record<string, DesignNode> }
interface DesignNode extends NodeProps { id; type; parentId; children: string[] }
```

- **Flat map, ordered children.** Lookups by id are O(1) (important for AI operations, which reference ids), and the tree is expressed by `parentId` + `children`. Children are in paint order: later is on top.
- **Node types:** `page` (the root, also the canvas background), `frame` (container), `rect`, `ellipse`, `text`, `image`, and `note`. Only `page` and `frame` can contain children. A *group* is simply a frame without fill or clipping, which is exactly how it will be expressed in HTML: a `div`. A **note** is the designer's annotation: it always sits directly on the page (operations refuse to put one inside a frame, and loading moves stray ones out), may point at a layer through `noteTarget`, is never exported, and is read by the AI as an instruction (section 8).
- **Flat properties.** Every editable property (`x`, `fill`, `fontSize`, …) is a top-level key described in the **property registry** (`model/properties.ts`): its type, range, and which node types it applies to. The registry drives validation, the properties panel, the AI's response schema and instructions, and the code generators. Adding a property means adding one registry entry.
- **CSS semantics, on purpose.** Coordinates follow the CSS box model: a child's `x`/`y` is its offset from the parent's *padding box* (inside the parent's border), rotation is around the centre, and `box-sizing` is `border-box`. Design tools like Figma use their own model; StyleCode uses CSS's because its promise is that the canvas *is* the code. Changing a frame's border width therefore shifts its children by that width, exactly as the exported CSS will.
- **Layout and meaning are properties too.** A frame's `layout` (`none`, `row`, `column`, `grid`, with `columns`), `gap`, per-side padding, `justify` and `align` make it an auto-layout frame; every layer has `widthMode`/`heightMode` (`fixed`, `hug`, `fill`), `positioning` (`auto`, or `absolute` to sit outside the flow) and a semantic `role` (button, nav, card, heading, input, link…). Roles change nothing visually; they tell the code generators which HTML element to use and tell the AI what a layer is.
- **Versioned file format.** Saved projects are `{ format: "stylecode", version, document, assets? }`. Loading goes through `parseProject`, which validates every property, repairs what it safely can (bad values fall back to defaults, dangling references are dropped) and rejects files from newer versions with a clear message instead of crashing. Version 2 added auto layout, sizing, roles, effects and images, and version 4 notes, grids, size limits, per-corner radii and phone settings. Older files open unchanged, because every new property has a default that reproduces the old behaviour.

## 4. Operations, transactions and undo

All document changes go through four operations (`model/ops.ts`):

| Operation | Effect | Inverse |
| --- | --- | --- |
| `create { parentId, index, nodes[] }` | inserts a subtree | `delete` |
| `delete { id }` | removes a node and its subtree | `create` with the captured subtree |
| `update { id, props }` | sets properties | `update` with the previous values |
| `move { id, parentId, index }` | re-parents and/or re-orders | `move` back |

`applyOps(doc, ops)` is **atomic** (all operations apply or none do), **pure** (the input document is never mutated) and returns the **inverse batch**. Every operation is validated: unknown ids, properties that do not apply to a node type, bad colours, non-finite numbers, cycles and structural errors are all rejected with a readable message. A property test applies random operation sequences and checks that undoing them reproduces the original document exactly.

Structural sharing keeps this cheap: a batch copies the node map once and only the nodes it touches; property-only edits keep children arrays, which lets the layer list skip work entirely during drags.

**Commands** (`model/commands.ts`) translate intentions into operations: group/ungroup, re-parent while preserving the on-page position, duplicate, align, distribute, reorder, copy/paste. They are pure functions of the document, which makes them easy to test and reusable by the AI layer. Complex commands build their batch incrementally with `OpBuilder`, so each step is computed against the state the previous steps produced.

The **editor store** (`editor/editor.ts`) records batches as **transactions** with a label, a source (`user`, `ai`, `system`) and the selection before and after. There are two ways to change the document:

- `apply(ops)`: one-shot edits, one undo step. Rapid repeats (arrow-key nudges) can coalesce.
- **Gestures**: `beginGesture` → `previewGesture(ops)` per frame → `commitGesture`. Previews are applied to a fixed base document, so a drag that produces 200 intermediate states records one undo step, and Escape cancels cleanly.

A **normaliser** hook runs after every batch, inside the same transaction. It keeps auto-sizing text boxes fitted to their content and then lays out every auto-layout frame the batch could have affected (section 5). Because its output is part of the same transaction, undoing a text edit also restores the box size and the position of everything the layout moved.

AI edits are transactions with `source: 'ai'`. They undo exactly like manual edits.

## 5. Auto layout

### The engine lives in the model

Auto-layout frames arrange their children like CSS flexbox. On a DOM canvas there were two ways to build that:

| Option | Verdict |
| --- | --- |
| Render auto-layout frames with `display: flex` and read positions back from the DOM | Exact by definition, but the document would no longer know where its own layers are. Hit-testing, snapping, the selection overlay, resize maths, the AI's context and undo would all wait on a render-then-measure step, and every layout change would cost two renders. |
| **Resolve layout in the model and write the result back as x/y/width/height** ✅ | One geometry for everything. Layout runs inside the transaction of the edit that caused it, so undo is exact and the AI sees real coordinates. The price is keeping a flexbox subset faithful to the browser, which a test enforces (below). |

`model/layout.ts` supports: row or column; gap; padding per side; `justify` start, centre, end or space-between; `align` start, centre or end; children that are **fixed**, **hug** their content (auto-layout frames and auto-sized text) or **fill** the space left (`flex: 1 1 0; min-width: 0` along the main axis, `align-self: stretch` across it); children set to ignore auto layout (`position: absolute`); hidden children skipped; and **wrapping rows** (`flex-wrap: wrap`). Rotation does not affect layout, as in CSS.

A wrapping row places layers on a line until the next one doesn't fit, then starts a new line; lines are as tall as their tallest layer and separated by the gap. Filling layers count as their minimum size when lines are formed, then share what is left on their own line, and layers set to fill the height stretch to their line rather than the frame. The block of lines is aligned like the layers within them (`align-content` follows `align-items`), so a single wrapped line sits where an unwrapped row would. A wrapping row that hugs its width is as wide as all its layers on one line (`width: max-content`).

To know how tall a line is, the engine first measures each layer that stretches across it at its **natural size**, as CSS does: a frame at its content (with any layer filling its own length counted at its minimum, and layers stretching across it measured the same way), text at its wrapped height, a shape at its border. Only then are the stretched layers sized to the line.

### Grids

A frame with `layout: grid` has `columns` equal columns (`repeat(n, minmax(0, 1fr))`) and places its layers row by row, each taking `columnSpan` columns and starting a new row when it doesn't fit; rows are as tall as their tallest layer (`grid-auto-rows: max-content`, so a short grid never squeezes them and a tall one never stretches them). A layer that fills its width fills its cell, one that fills its height stretches to its row, and the others are placed in their cell by the frame's alignment (`justify-items`/`align-items`). A grid that hugs its width is as wide as its widest column needs times the number of columns (`width: max-content`). Switching a row to a grid keeps the order, gives it one column per layer up to six, and makes the layers fill their cells.

### Size limits

Layers in auto layout can have `minWidth`, `maxWidth`, `minHeight` and `maxHeight` (0 for none). Filling layers share space with the same *freezing* algorithm CSS flexbox uses (`flexSizes`): share out what is left in proportion, clamp anyone who went past a limit, freeze them, and share again among the rest until nobody moves. Hugging and fixed sizes are clamped directly. Limits also decide where wrapping rows break and how wide a hugging row may grow. Exported code uses the matching `min-width` and friends, and a filling layer keeps `min-width: 0` only when it has no minimum of its own.

`layoutRoots` works out which frames a change can affect: the outermost frame of each unbroken chain of auto-layout ancestors. Editing a word deep inside a card re-lays out that card and whatever hugs it, and nothing else.

### Parity with the browser

`e2e/layout-parity.spec.ts` builds random nested auto-layout trees (200 per run, from a fixed seed, including tiny outlined shapes and frames smaller than their own padding), lays each one out with the engine, renders the same tree in Chromium using the flexbox declarations from `render/css.ts`, and compares every box to within half a pixel. It found five places where a reasonable-looking engine disagrees with CSS, now encoded as rules:

- A layer can only fill along an axis where its parent's size is decided by something else. In a parent that hugs that axis there is no space to fill, so it keeps its own size.
- A box is never smaller than its border plus, for an auto-layout frame, its padding (with `box-sizing: border-box` the browser cannot draw it smaller). The normaliser enforces this for every layer, so the model never records a size the canvas can't show.
- A filling layer starts from that minimum; the space left after those is what gets shared.
- Sizes can be 0: an empty hugging frame collapses to its padding.
- Text is measured to hundredths of a pixel and rounded up, not to whole pixels, or a row of labels drifts.

The parity test also generates wrapping rows (with filling and stretched layers among them), grids with spans, and size limits; 200 trees run each time, and 1,600 across eight seeds were checked while building Phase 5. Grids added three more rules: a fixed-height grid whose rows overflow it still sizes rows by their content (hence `grid-auto-rows: max-content`), text measured for a hugging grid uses its natural width rather than its stored one, and a hugging grid inside another must be `max-content` wide rather than shrink-to-fit. The code generators emit the same declarations, so this test also pins what exported code does; a second test (section 9) checks whole exported pages.

### Tidy into auto layout

<kbd>Shift</kbd>+<kbd>A</kbd> on a freely drawn frame infers a structure for it (`model/infer.ts`, applied by `model/autolayout.ts`) with recursive **XY-cut**, a classic page-analysis technique: find a band of empty space running all the way across the layers, split there, and repeat inside each part until single layers remain. Where both a horizontal and a vertical split exist, the wider whitespace wins, so three cards side by side become three columns even though each card is itself a stack; a tie goes to a column, since pages read top to bottom. Then:

- each row or column gets the median of its gaps and whichever alignment (start, centre, end) its edges agree on best;
- groups separated by much larger gaps than the rest (a logo, a set of links and a button) become clusters in a `space-between` row;
- the frame's padding is the distance from its edges to the content, so nothing moves more than it must;
- a single layer sitting in the middle of its frame (a label in a button) is centred for real, so it stays centred when either changes size;
- layers that overlap cannot be split, so they stay together as a freely arranged group, and a frame whose layers all overlap is left alone with an explanation;
- frames inside that are still freely arranged are tidied too, so one command structures a whole sketch.

Inference is deterministic: the same sketch always gives the same structure, and the whole result is one undoable step. This is exactly the kind of geometry a language model is bad at, so the AI calls it (the `tidy` operation) rather than reinventing it.

With other layers selected, <kbd>Shift</kbd>+<kbd>A</kbd> wraps them in a new hugging row or column without moving them. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> turns auto layout off and leaves everything where it is.

### Editing inside auto layout

Dragging a layer inside an auto-layout frame lifts it out of the flow, so it follows the pointer while the others close up, and a cantaloupe line shows where it will land; dropping it puts it back into the flow at that place. Passing over a sibling frame it could not fit inside (one card over another) keeps reordering rather than dropping into that frame; a smaller layer can still be dropped into a bigger sibling. Arrow keys move the selection one place instead of one pixel, and selected neighbours move together. Resizing a hugging or filling layer, with the handles or by typing a width or height, switches that axis to a fixed size. Align and distribute only move layers that auto layout doesn't place. A layer set to ignore auto layout keeps its own position, but if it is an auto-layout frame itself it still lays out its contents. The layers panel lists auto-layout children in reading order (first at the top) rather than front-to-back, so the list matches the row or column.

### Smart guides

Outside auto layout, moving, resizing and drawing snap a layer's edges and centre to the edges and centres of its siblings and of the frame it is in, within 6 screen pixels (so the pull feels the same at every zoom), and draw the guide lines that explain each snap. Holding <kbd>Ctrl</kbd>/<kbd>⌘</kbd> turns snapping off for that gesture.

Moving also snaps to **equal spacing** (`canvas/snapping.ts`): to the gaps that siblings level with the layer already have, and to the middle between two neighbours. Edge alignment and spacing compete on distance, so whichever is nearer wins, and every matching gap is marked with its size. Holding <kbd>Alt</kbd> with a layer selected measures from it to the layer under the pointer (or to the edges of its frame). Notes aren't snap targets, so they never pull a layer out of line.

## 6. Canvas rendering: real DOM, screen-space overlay

The single most consequential technical decision is how the canvas draws.

| Option | Verdict |
| --- | --- |
| HTML `<canvas>` / WebGL (Figma's approach) | Fast for huge vector documents, but StyleCode would have to re-implement CSS: text wrapping, fonts, shadows, gradients, `backdrop-filter`, and above all flexbox and grid. Every gap between that re-implementation and the browser is a bug where the canvas disagrees with the exported code. |
| SVG | Good for shapes, poor for text layout, and not how the output will be built. |
| Canvas library (Konva, Fabric, Pixi) | Same fidelity problem plus a large dependency. |
| **DOM for content + screen-space overlay** ✅ | Layers are real `div`s (and `img`s) styled by the same function that will generate the exported CSS. Text, fonts, shadows, gradients and blur come from the browser for free, so what you see is what the code renders; auto-layout positions come from the model and are checked against the browser's own flexbox. Selection outlines, handles and guides live in a separate SVG overlay in screen space, so they stay 1px crisp at any zoom. |

Pan and zoom are a single CSS transform on the content layer, so they never re-render layers. Each layer component subscribes only to its own node, so editing one layer re-renders one component. The layers panel is virtualised: only the rows in view (plus a margin) are rendered.

**Large documents.** Phase 5 profiled a 5,000-layer document (ten pages of twenty sections of cards, rows and grids) in a production build and fixed what showed up:

| Hotspot | Fix |
| --- | --- |
| Painting and layerising every page on every frame | Top-level frames that clip get `content-visibility: auto`, so the browser skips pages out of view (it can only do that safely where the frame clips anyway). |
| Selection changes repainting the design under the overlay | The overlay is its own compositing layer. |
| Panning and zooming repainting everything | The content layer is composited while the camera moves and redrawn sharp 160 ms after it stops. |
| Copying the 5,000-entry node map several times per drag frame | Gestures push operations together where nothing reads in between, the normaliser's changes are applied on top rather than replayed from the start, and a gesture can hand the editor the document it already built. |
| Layer rows redrawing because a layer moved | Rows only redraw when what they show changes (name, type, visibility, lock, role, layout, children). |
| Walking the whole tree on every hover and camera change | The layer list's tree shape is worked out once per document. |
| Text measured twice on load | The measurement cache holds 20,000 entries instead of 1,000. |

On the development container, a drag frame went from about 70 ms to about 35 ms of main-thread time and a pan step from about 27 ms to 17 ms; loading takes a second or two. `src/model/performance.test.ts` holds generous budgets for layout, edits, drag frames, code generation and saving on that document, and `e2e/large-document.spec.ts` checks the real editor stays usable with it.

Hit-testing uses the browser where it is exact (which element is under the pointer, including rounded corners and rotation) and the model's affine matrices where it needs geometry (which frame a point is in, marquee intersection, resize maths). All geometry uses 2D affine matrices, so rotation and nesting compose correctly with auto layout.

Text is measured with an off-screen element styled by the same CSS mapping, so measured and rendered sizes match exactly. Inter ships with the app so measurement is identical on every machine and offline; documents are re-fitted on open in case fonts differ.

## 7. Local-first persistence

There is no account and no cloud service. The open project autosaves to **IndexedDB** half a second after each change and on tab hide. Projects can be saved to and opened from `.stylecode.json` files (using the File System Access API's save dialog where the browser supports it, a download otherwise). Opening a file always creates a new local project, so it can never overwrite existing work. If the same project is open in two tabs, a notice explains that the last tab to save wins.

**Images** are stored in their own IndexedDB store as blobs, keyed by a SHA-256 hash of their content (`asset_…`). The same picture added twice is stored once, and image layers refer to it by id, so the document stays small and copying an image layer between projects just works. Images up to 15 MB are accepted, in the formats every browser shows (PNG, JPEG, WebP, GIF, AVIF, SVG, BMP, ICO), so a picture on the canvas always appears in exported code too. Layers on screen share one object URL per image, released a few seconds after the last one goes away; a layer whose image is missing shows a placeholder and picks the image up as soon as it is added. Images finish loading in the background, and an insert waits for any drag or scrub in progress to end so it never interrupts it. Saving to a file embeds the images that project uses (base64, under `assets`), so a saved file is self-contained; opening it puts them back into the local store. Nothing is uploaded anywhere.

**Recovery.** Storage can fail (a full disk, a blocked database, a project written by a bug), and none of that should cost work:

- On start-up every stored project is tried, the last one first; one whose data doesn't parse, or that throws while loading, is skipped with a notice and left untouched, and Projects marks it *can't be opened* with **Download data**, which saves the stored record exactly as it is. Storage being unavailable at all is the only case that falls back to working in memory, and the save status says so.
- A failed save is reported once, then retried after 2, 5, 15 and every 30 seconds; the save status becomes a menu with **Try saving again**, **Save to file…** and **Free up space in Projects…**. Quota errors get their own message. After a successful save, if the browser's storage estimate is over 90% full, a warning appears once per session, and Projects shows the usage.
- `beforeunload` flushes a pending save and asks the browser to confirm leaving while one is pending, in progress or failed (or, with no storage, whenever there are unsaved edits). Opening, creating or importing another project first lets a waiting or running save finish, and if the current project's changes still couldn't be saved, asks before replacing it; saying no keeps it open.
- Rendering errors are caught by error boundaries: a panel (layers, design, code, tools) shows *Try again* while the rest keeps working; if the editor itself fails, a recovery screen offers saving a copy to a file, undoing the last change (or cancelling a drag in progress) and reloading, with a prefilled bug report. Autosave pauses while it shows, so a design that broke the editor never replaces the last good save, and leaving doesn't ask; undoing resumes it. Errors that escape everything (a rejected promise, a bug in an event handler) become a notice instead of failing silently, and if StyleCode can't start at all the page says so.

**Blocks** (button, badge, text field, card, navigation bar, hero section, in light or dark) are plain functions that build a subtree of auto-layout frames with roles set. They are inserted like anything else, as one undoable operation, and are fully editable afterwards; there is no separate component system to keep in sync.

## 8. AI collaboration

### Pipeline

```
request + selection (or the screen in view)
  → context builder        src/ai/context.ts    one screen as a compact tree with short ids
  → local server           server/ai            adds the key, calls the provider, streams back
  → provider               Ollama / OpenAI-compatible / Anthropic, constrained to a JSON schema
  → streamed explanation   shown while the reply is still arriving
  → interpretation         src/ai/proposal.ts   ids resolved, AI policy, operations validated
      ↳ problems?          one repair attempt: the errors go back to the model, in its own ids
  → proposal               shown on the canvas in cantaloupe, not yet recorded
  → accept → one transaction (source: 'ai', undoable)   |   reject → nothing changed
```

`src/ai/assistant.ts` runs the pipeline and holds the assistant's state; the assistant bar (`src/app/AssistantBar.tsx`) sits above the tool dock and shows each stage.

### Context, not the whole document

Small models have small context windows, so the model is told about one screen, not the document. The context builder writes the screen as an indented tree, one line per layer:

```
Screen e1 "Pricing", 1280×800.
Selected: e4. You may change the layers marked * and add layers inside or next to them.

e1 frame "Pricing" 1280×800 layout=column
  e3 frame "Plans" 960×300 layout=row
    * e4 frame "Basic plan" 300×300 layout=column gap=8 fill=#ffffff
      * e5 text "Name" 46×22 text="Basic"
```

- Layers get short ids (`e1`, `e2`… in document order), mapped back to real ids afterwards. They save tokens and make mistyped references unlikely.
- The layers the request may change (the selection and everything in it, or the whole screen when nothing is selected) are marked `*` and listed with every property that differs from the defaults. Ancestors are always shown; then siblings, then the rest of the screen as one-line summaries, while there is room.
- The room is a character budget from the model's context window: for Ollama, the context size minus about 5,500 tokens for the instructions and the reply, at 3.5 characters a token; for hosted models, 60,000 characters. What doesn't fit is summarised as "… 12 more layers not shown".
- **Notes** on the screen are appended as "Notes from the designer", each with its text and the short id of the layer it points at, and the instructions tell the model to treat them as requests. Notes aren't part of the screen tree the model sees, and it can't create them, so it acts on them rather than editing them.
- The instructions (`src/ai/prompt.ts`) describe the design model, the operations and the rules, list every property the AI may set with its description from the property registry (so they never go out of date), and end with a worked example, which helps small models most.

### What the model returns

One JSON object: `{ "explanation": "...", "operations": [...] }`. The explanation comes first so it streams first. There are five operations:

| Operation | Meaning |
| --- | --- |
| `update {id, set}` | change properties of a layer |
| `create {ref, parent, index?, type, set}` | add a layer; later operations can use its `ref` (`n1`) as an id or parent |
| `delete {id}` | remove a layer and what is inside it |
| `move {id, parent, index?}` | reorder, or move into another frame keeping its place on screen |
| `tidy {id}` | arrange a frame's freely placed layers with auto layout (the same inference as <kbd>Shift</kbd>+<kbd>A</kbd>) |

`src/ai/schema.ts` builds the JSON schema for this from the property registry: every property except `locked` and `src` (the AI can't lock layers or point images at stored files), with enums for keyword properties and a pattern for colours. The schema is deliberately flat, with no `$ref` and no length or range limits, which some constrained decoders turn into very large grammars. Ranges are checked afterwards.

### Safeguards

- **Constrained output.** Ollama gets the schema as `format`; OpenAI-compatible servers get `response_format` with the schema, and fall back to a JSON object, then to plain text, if a server rejects it; Anthropic gets a single tool, `propose_changes`, whose input schema is the schema, and is required to call it.
- **Validation is the same as for manual edits.** The operations are applied to a copy of the document with the same checks as any edit; nothing changes until they all succeed.
- **AI policy on top of validity.** The AI may change only the layers marked `*`, and add or move layers inside them or next to them in the same frame. The screen itself can't be deleted or moved. Locked layers can't be changed, moved on their own, deleted (directly or with the frame around them), rearranged by `tidy` or given new layers; moving or hiding the frame around a locked layer still carries it along, as it does when you edit by hand. A final check compares every locked layer before and after and refuses the whole proposal if one differs in anything but the position and size auto layout works out. A proposal that deletes more than 10 layers, or 3 or more that make up at least half of what it may change, needs a deliberate click ("Delete 12 layers and apply"); <kbd>Enter</kbd> alone won't apply it.
- **One repair attempt.** Problems are reported back to the model in its own terms ("Operation 2: there is no layer "e99"") for one more try. If the reply is still wrong, nothing changes and the assistant lists what was wrong. A reply cut off by the length limit is reported as such rather than repaired, since asking again would only cut it off again.
- **Preview before apply.** The editor shows the proposal without recording it: changed and new layers are outlined in cantaloupe, layers that would be deleted are shown as dashed outlines where they were. The properties and code panels show the proposed values. Autosave and export use the design as recorded (`editor.committedDoc`), so an unreviewed proposal is never saved or exported.
- **The design is read-only during review.** Selecting, panning, zooming and looking at the properties and code still work, but an edit (a drag, a nudge, a property, the layers panel, the CSS editor) would be made on top of changes that aren't recorded, so the editor refuses it and says to accept or reject first. Undo rejects the proposal. A reply that arrives while you are dragging, scrubbing or typing (on the canvas, or in a field such as a property or a layer name) waits until you finish, then is checked again against the design as it is; images that finish loading during review are added after it.
- **Undo.** An accepted proposal is one ordinary transaction, labelled with the request ("AI: make it darker"), marked `source: 'ai'`.
- **No endless waiting.** A reply that goes quiet for two minutes (long enough for a local model to load) is given up with a message suggesting a smaller model; the client keeps its own abort controller so a stall and the user's Stop are told apart.

### Providers and keys

Three modes, all first-class:

1. **No AI**, the default. The editor and code export are fully useful on their own, and nothing is sent anywhere.
2. **Local.** Ollama on this computer. No key, no cost, nothing leaves the machine. The context size is set explicitly (`num_ctx`), because Ollama otherwise picks one from available memory and silently truncates longer prompts.
3. **Your own key.** OpenAI-compatible APIs (OpenAI, LM Studio, OpenRouter, Groq, llama.cpp's server…) and Anthropic.

Requests go through a small local server, not from the browser to the provider. `server/ai/plugin.ts` is a Vite plugin that mounts `/api/ai` on both the dev server and the preview server, so it runs wherever StyleCode runs and costs nothing to host:

| Route | Purpose |
| --- | --- |
| `GET /api/ai/config` | the settings, with `hasKey` and where the key comes from, never the key |
| `PUT /api/ai/config` | save settings; a key is sent once and stored, or removed |
| `POST /api/ai/models` | list a provider's models; also the connection check (unsaved settings may be tried) |
| `POST /api/ai/chat` | stream a reply as lines of JSON: `{"delta"}`… then `{"done"}`, or `{"error"}` in plain words |

Settings live in `~/.stylecode/ai.json` (or the file named by `STYLECODE_AI_CONFIG`). On macOS and Linux it is readable only by the user (mode 0600, in a folder created 0700). On Windows, Node can't set that: mode bits are ignored and `chmod` only changes the read-only flag, so the file relies on the home folder's default Windows permissions. Saves happen one at a time, each written to a new temporary file and renamed into place, so the file is never half-written. On Windows the rename is retried up to six times over about three seconds if antivirus or indexing briefly holds the file (`EPERM`, `EBUSY`; `server/shared/rename.ts`). Keys can instead come from `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. Keys are never sent to the browser, stored in browser storage, written into frontend code or kept in the repository.

A key saved in the settings only ever goes to the address it was saved with, and a key from an environment variable only to the saved address. Trying another address in the settings dialog uses only a key typed for it; saving a new address without a new key forgets the old key; and provider requests never follow redirects, which would otherwise carry `x-api-key` to wherever the redirect points.

The routes only answer StyleCode's own page on this computer, checked on every request:

- the connection must come from this computer (a loopback address), even if the server was started with `--host`;
- the `Host` must be `localhost`, `127.0.0.1` or `[::1]`, which defeats DNS rebinding;
- an `Origin`, when there is one, must be exactly this server: Vite answers CORS preflights from other `localhost` ports, so this is the check that keeps another local web app out;
- a browser's `Sec-Fetch-Site` must be `same-origin` or `none`;
- every request carries an `x-stylecode-ai` header, so a plain form post from another page can't reach the routes at all.

If the browser goes away mid-reply, the request to the provider is aborted too. A build served by some other static server has no `/api/ai`, and the assistant says so.

### Local model trade-offs

| Factor | Reality | Mitigation |
| --- | --- | --- |
| Hardware | 7–9B models at 4-bit need roughly 5–8 GB of RAM or VRAM; 3–4B models fit 8 GB laptops. | Replies are short (a few hundred tokens), so even CPU-only generation is tolerable; the model is a setting. |
| Quality | Small models are weaker at design judgement and nested JSON. | Constrained decoding, a narrow and flat operation vocabulary, a worked example, validation with a repair attempt, and deterministic commands (`tidy`) doing the heavy lifting. |
| Speed | Constrained decoding is slower than free text. | The explanation streams first, you can keep editing while a request runs, and it can be stopped at any time. |
| Context window | Ollama picks its default context size from available memory and silently truncates prompts that exceed it. | `num_ctx` is set explicitly, the context is budgeted to fit, and the context size is a setting. |
| Installation | Ollama installs with one download on Windows, macOS and Linux. | Setup steps in the settings dialog and the README, a connection check that lists installed models, and no-AI mode always available. |

### Tests

Unit tests cover the schema, the instructions, the context builder (scope, short ids, budget), interpretation and policy (out-of-scope changes, locked layers reached by every kind of operation, unknown properties, bad colours, refs between new layers, moves, tidy, deletion confirmation), the streamed explanation, the editor's proposal mode (read-only review, undo rejecting, waiting for edits in progress) and the assistant's state machine with a fake server (repair, errors, a project switched mid-request, a reply arriving during an edit). The server's tests run fake provider servers to check each provider's request format and stream parsing, the JSON and token-parameter fallbacks, cut-off replies, error messages, key handling (file mode, environment, never returned, only sent to its own address, redirects not followed), serialised saves and the request checks. The browser tests drive the whole flow against a fake Ollama (`e2e/fakeOllama.ts`): settings, a request, the proposal on the canvas, accept, undo, reject, edits refused during review, the repair attempt, a reply that stays wrong, large deletions, Stop and suggestions.

## 9. Code generation

Generators are pure functions from the document to files, in `src/codegen`. The AI never writes code (section 1): it changes the document, and the generators compile it.

### From a screen to an element tree

Each top-level frame is a **screen**. `buildScreen` turns it into a tree of elements, each with a tag, a class, attributes and a CSS rule, and both printers (HTML and React) work from that tree.

- **Tags come from roles**: `nav`, `header`, `footer`, `section`, `article` (card), `button`, `a` (link), `ul`/`li` (list), `input`, `h1`–`h6` (headings, levelled by font size within the screen: the largest is `h1`), `p`, `img`. Text without a role is a `p`, or a `span` where only phrasing content is allowed. The HTML stays valid: inside a button, link, heading or paragraph only phrasing elements are used, nothing interactive nests inside a button or link, and a list holds only list items (anything else is wrapped in an `li` with `display: contents`, which leaves the layout alone).
- **An input** is a text layer, or a frame holding one, with the input role: it becomes `<input placeholder="…">` with the frame's box and the text's type style.
- **Class names** come from layer names (`Hero title` → `hero-title`). Layers still called "Frame 3" or "Text" are named by role, by their first words of text, or by what they are (`row`, `column`, `box`, `circle`), and repeats get `-2`, `-3`.
- **Images** reference `assets/<id>.<ext>`; an image whose picture isn't on this device exports as a labelled placeholder box, with a warning.

### Faithful at the design width

Declarations come from `render/css.ts`, the mapping the canvas renders with: layers in auto layout get their flexbox declarations (the ones the parity test checks), layers in free layout and layers that ignore auto layout get `position: absolute` with their exact position and size. A short base stylesheet resets browser defaults (margins, button and input styles, list bullets) and carries the bundled Inter font. The screen itself becomes `width: 100%; max-width: <design width>; margin: 0 auto`, so on a wider screen it is centred on its own background.

`e2e/code.spec.ts` renders the exported page for the example project (in free layout and tidied into auto layout) at the design width and compares every layer's box with the canvas: they agree to within a pixel.

### Responsive below the design width

Fixed pixel layouts break on phones, so every screen's stylesheet ends with one media query, active only below the design width, that adapts it:

- rows wrap onto new lines;
- fixed widths become maximums (`max-width: 100%`), and frames that hug their content may shrink to the space available;
- a layer filling a row keeps a readable width (at least 240px, or the whole line);
- headings and paragraphs stacked in a column may wrap; labels in rows (buttons, links, badges) stay on one line;
- heights set by the design become minimums, so content that wraps can grow;
- images keep their aspect ratio;
- large type (28px and up) scales with the viewport (`clamp(…, …vw, size)`, never below the larger of 20px and 60% of its size), and so do page-wide side padding (never below 16px) and wide gaps in rows (never below 12px).

At the design width none of this applies, so it cannot disturb the faithful layout. Layers in free layout can't adapt this way; the code panel says so and points to <kbd>Shift</kbd>+<kbd>A</kbd>. The same test renders the tidied example at 390px and 768px and checks that nothing scrolls sideways.

Grids export as CSS grid; below the design width their gaps scale like a row's. **Phone settings** (section 3) go into a second media query, below 640px or the page width if that is narrower: `display: none` for layers hidden on phones; a row or column switching direction (a row stacked as a column also stops wrapping, and its layers stop flexing and stretch across); a grid's columns on phones (one unless chosen), with spans limited to that many columns; full width (`width: 100%; max-width: 100%`); and font size and alignment for text. Notes are never part of a screen.

### React

Each screen becomes a TypeScript component with a CSS module (`LandingPage.tsx`, `LandingPage.module.css`). **Repeated structures become components**: two subtrees count as the same when their elements and CSS match; whatever differs between them (text, images, alt text, placeholders, fill and text colours) becomes props. Colours are passed as CSS custom properties, so the styles stay in the stylesheet:

```tsx
function Card({ iconBackground, title, description }: CardProps) {
  return (
    <article className={s.card}>
      <div className={s.icon} style={{ '--icon-background': iconBackground } as CSSProperties} />
      <h2 className={s.title}>{title}</h2>
      …
```

The largest repeated structures win, a structure used only once stays inline, and a component is named after what its instances' names share (`tag-card`, `price-card` → `Card`). A prop is named after its layer when the instances' layers share a name (`title`), and generically (`text`, `imageSrc`) when each was named by its own content; names that would clash with JavaScript's reserved words or with the file's own identifiers get a suffix. Screen components never take a name `App.tsx` uses itself, and static-site pages never overwrite `index.html` or `base.css`.

### Exports and preview

- **Website**: one HTML page per screen (the first is `index.html`), a stylesheet per page, shared `base.css`, images and fonts. No build step and no JavaScript.
- **React app**: Vite + React + TypeScript, one component per screen (switched by the address, `#screen-name`, when there are several), images imported so Vite bundles them, and the same dependency versions StyleCode is built with. An exported app was installed and built (`npm install && npm run build`) as part of developing this.
- Both are written into a **ZIP** by a small writer in `codegen/zip.ts` (stored, not compressed; the archive is checked with `unzip -t` and read back in tests), saved through the system save dialog where the browser has one.
- The **preview** renders the exact exported HTML and CSS (fonts and images inlined) in an `<iframe sandbox="">` (no scripts, no access to the app) at the design width, 768px and 390px. The only addition is a hidden scrollbar, so a tall page isn't laid out a scrollbar's width narrower than the design.

### Code → design

A full React-to-design round trip is a rabbit hole. Instead, the code panel lets you edit the CSS of the selected layer's rule, limited to declarations that map onto design properties: size, position (for freely placed layers), flexbox direction, wrapping, alignment, gap and padding, background (colour or two-colour gradient), border, radius, overflow, shadow, backdrop blur, opacity, rotation, object-fit and typography. `codegen/parseCss.ts` turns the edited text into property changes, applied as one undoable step; removing a declaration resets what it described (removing `border` removes the stroke). Declarations StyleCode sets itself (`position`, `flex`, `margin`…) and ones it can't represent (`filter`, dashed borders, several shadows) are reported, and nothing changes. Any CSS colour is accepted; the browser's own parser turns it into hex. A unit test reads every layer of a test page back through the parser and checks the regenerated CSS is identical.

### Tests

Snapshot tests pin the generated HTML, CSS, TSX and CSS module for a test page, so any change to generated code shows up as a reviewable diff. Other unit tests cover tags and HTML validity, escaping, the split between design-width and responsive rules, component extraction, CSS parsing, the export file sets and the ZIP format; the browser tests cover fidelity, phone widths, the code panel, the preview and both downloads.

## 10. Onboarding and accessibility

**First run.** `app/onboardingState.ts` keeps a little state in `localStorage` (a per-browser convenience: if it is missing, onboarding just starts again): whether the welcome screen has been seen, whether the checklist is open, and which steps are done. Steps tick themselves off by watching the editor's history labels ("Add frame", "Add auto layout", "Add note") or from the app (opening the Code tab, choosing the phone width in the preview, the AI coming back with a proposal), so the checklist never asks you to confirm anything. Empty states say what to do next, and the shortcut reference is generated from the same labels the menus use.

**Keyboard.** The layer list is a single tab stop (`role="tree"` with `aria-activedescendant`), so a long list doesn't mean hundreds of <kbd>Tab</kbd> presses; arrow keys move the active row and the selection with it, and it scrolls into view. The canvas is a tab stop too: <kbd>Tab</kbd> walks through the layers beside the selected one and, at either end, lets focus move on, so it is never a trap. Its focus ring appears only when it was reached with <kbd>Tab</kbd>, not after a click and a shortcut. Global shortcuts leave <kbd>Enter</kbd>, <kbd>Space</kbd> and arrow keys to a button, tab or radio that was reached with the keyboard (`:focus-visible`), and still work after a mouse click on a toolbar button. Dialogs keep <kbd>Tab</kbd> inside and give focus back to whatever opened them.

**Screen readers.** Every control has a name; the canvas describes its keys; a polite live region announces what is selected (debounced, so a marquee is read once) and the editor's messages, with errors in an assertive one. The regions are always in the page, because a live region that appears together with its text is often not read.

**Contrast and checks.** Secondary text and line numbers meet 4.5:1 on every surface, and filled buttons use a slightly deeper electric blue so white text on them does too. `e2e/accessibility.spec.ts` runs axe (WCAG 2.1 A and AA) over the editor, the code panel, every dialog, the menus, the assistant, the welcome screen and the checklist, and drives the layer tree, the canvas and a dialog from the keyboard alone. The designs on the canvas are the user's own and are left out of the scan.

## 11. Known risks

| Risk | Mitigation |
| --- | --- |
| Turning rough geometry into clean responsive layout | Auto-layout as a first-class model concept; deterministic inference; AI used for semantics, not maths. |
| Small models producing invalid or hallucinated operations | Constrained decoding, short ids, validation, a repair attempt, and preview before apply. |
| Silent context truncation in Ollama | Explicit `num_ctx` and a context budget. |
| AI damaging existing work | Scoped operations, locked layers protected, preview, atomic undoable transactions. |
| DOM canvas performance at scale | Per-node subscriptions, transform-based pan/zoom, structural sharing, a virtualised layer list, off-screen pages skipped by the browser, and performance budgets on a 5,000-layer document. |
| Losing work to storage problems or crashes | Retried saves with ways out, a warning before closing with unsaved changes, damaged projects skipped and downloadable, error boundaries and a recovery screen that can save a copy. |
| An editor only usable with a mouse | Keyboard models for the layer tree, canvas and dialogs, a live region, AA contrast, and an axe check in CI. |
| Canvas and export disagreeing | One CSS mapping used by both; CSS box-model semantics in the document; a randomised browser test comparing the layout engine with real flexbox; a browser test comparing whole exported pages with the canvas. |
| Fixed-width designs breaking on phones | Responsive rules that apply only below the design width; a browser test for sideways scrolling at 390px and 768px; free layout flagged in the code panel. |
| Large images bloating storage and files | Content-addressed storage (each picture stored once), a 15 MB limit per image, and only images in use are embedded in saved files. |
| API key exposure | Keys live in a file in the user's home folder, readable only by the user on macOS and Linux and protected by the home folder's permissions on Windows (or in environment variables) and are used by the local server; the browser only learns whether one is set. A key only goes to the address it was saved with, redirects aren't followed, and the AI routes only answer StyleCode's own page, from this computer. |
| Scope creep | Each phase must leave the app working; no feature without a place in the core loop. |

## 12. The consulting workspace: runtime and storage

*Status: decided in Phase 0 (WP4). Each decision has its own ADR (0005 to 0009), all Accepted. Nothing here is built yet; Phase 1 builds it.*

The workspace's data is described in `docs/spec/DOMAIN-MODEL.md`: one `CompanyWorkspace` value per company, validated, versioned, never saved with problems, and opened read-only when it has them. This section is about where that value lives and what runs it.

```
            ┌──────────── browser, http://localhost ────────────┐
            │  editor (as today)       workspace UI (Phase 1)    │
            │  IndexedDB: standalone   microphone (Phase 3,      │
            │  editor projects         getUserMedia)             │
            └──────────────┬───────────────────────┬────────────┘
                 /api/ai   │                       │  /api/workspace
            ┌──────────────▼───────────────────────▼────────────┐
            │  local Node server (Vite plugins, one command)     │
            │  same request checks for both: loopback, Host,      │
            │  Origin, Sec-Fetch-Site, StyleCode header           │
            └──────────────────────────┬────────────────────────┘
                                       ▼
            ~/StyleCode Data/companies/<company id>/
                workspace.json          the CompanyWorkspace
                workspace.previous.json the last good copy
                files/<file id>         documents, later audio
                designs/<document id>.stylecode.json
```

### Runtime (ADR-0005)

**Decided:** keep today's shape, a browser page plus a local Node server, started with one command. The workspace API is a second Vite plugin next to `server/ai`, mounted on the dev and preview servers as the AI routes are.

- **Microphone (Phase 3):** `http://localhost` and `127.0.0.1` are secure contexts, so `getUserMedia` works without HTTPS ([MDN, Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), checked 2026-11-04).
- **Files:** the server reads and writes the workspace folder, so the browser doesn't need the File System Access API (which only Chromium browsers have).
- **Windows and cost:** Node 22.12 or newer is already required. Nothing is signed, hosted or paid for.
- **Reuse:** all of the editor and `server/ai` carry over unchanged.
- **Against:** the consultant needs Node and a terminal command, and a closed tab isn't a closed app. Packaging as a desktop app later stays possible, because the server is plain Node: Electron bundles Chromium and Node ([Electron, Security](https://www.electronjs.org/docs/latest/tutorial/security), checked 2026-11-04); Tauri would need Rust and the MSVC build tools to develop, and a rewrite or a Node sidecar for the server ([Tauri, Prerequisites](https://v2.tauri.app/start/prerequisites/), checked 2026-11-04).

### Storage (ADR-0006)

**Decided:** a workspace folder on disk, managed by the local server, with **one folder per company** holding its own `workspace.json`, its files and its designs. A client's data can be backed up, exported or deleted as a unit, and the server only ever opens one company's folder for a request, so data can't leak between companies.

**Records: one JSON file per company, not SQLite (for now).** The brief asked to evaluate SQLite with `node:sqlite` against a library. Measured on the user's laptop (Windows 11, Node 22.15.0, 2026-11-04):

| Check | Result |
| --- | --- |
| `node:sqlite` loads without a flag | Yes on 22.15, with an `ExperimentalWarning`. It needs `--experimental-sqlite` before Node 22.13, so on 22.12, the oldest version StyleCode supports, it is behind a flag. It became a release candidate only in Node 25.7 ([Node.js docs, SQLite](https://nodejs.org/api/sqlite.html), checked 2026-11-04). |
| Full-text search (FTS5, FTS4, FTS3) in `node:sqlite` | **No:** `no such module: fts5`. The Windows build of Node 22.15, with SQLite 3.49.1, lacks it (measured on that version only); others report the same on Windows ([skilld #64](https://github.com/skilld-dev/skilld/issues/64)). |
| JSON functions in `node:sqlite` | Yes. |
| JSON workspace, 60 one-hour meetings (54,000 segments, 2,400 findings, 12.7 MB) | Save (stringify, write, rename) 57 ms; load (parse and validate) 186 ms; substring search of every segment 22 ms. |
| The same, 200 meetings (180,000 segments, 42.8 MB) | Save 226 ms; load 1.06 s; search 143 ms. |

The domain model is already one validated value per company, and at the sizes a consultant reaches with one client, a JSON file is fast enough, needs no dependency, and is readable with any text editor if StyleCode is ever gone. The budgets in `src/workspace/model/performance.test.ts` keep it that way. SQLite would add a second representation to keep in step, and on the user's Windows Node it brings neither stability nor search. The choice is revisited (a new ADR) when one of these holds: a real workspace takes over a second to load, search needs ranking that substring search can't give, or `node:sqlite` is stable with FTS5 on Windows. `better-sqlite3` (a native runtime dependency, with FTS5) is the fallback if that happens before Node catches up.

**Writes** follow `~/.stylecode/ai.json`: one at a time, to a temporary file renamed into place, so a file is never half-written. On Windows, the rename can fail with `EPERM` or `EBUSY` while antivirus or search indexing has the file open, so it is retried a few times, with a short wait, before the save is reported as failed. Before replacing `workspace.json` the server keeps the last good copy as `workspace.previous.json`. The server refuses to save a workspace with problems (`checkBeforeSave`). Each save carries the revision it was based on; if the file has moved on (a second tab), the save is refused and the page says so, instead of "last tab wins".

**Files** (documents now, audio in Phase 3) are stored under `files/` by their id, never by a name the browser sent, and listed in the workspace as `FileRef`s. Audio stays out of `workspace.json`.

**The workspace folder** is `StyleCode Data` in the user's home folder by default (visible, so it's easy to back up, and not to be confused with a checkout of the StyleCode repo), or wherever `STYLECODE_WORKSPACE` points. On macOS and Linux it is created readable only by the user. On Windows Node can't set that, so it relies on the home folder's default Windows permissions.

**Where it may not be.** The server refuses to start if the workspace folder is inside this repo or any git repository, so client data can never be committed. It warns in the app if the folder is inside a cloud-synced folder (OneDrive, Dropbox, Google Drive), because syncing sends client data off the computer, which ADR-0002 rules out. Real client work uses the built app (`npm start`), not `npm run dev`; the guide says so.

### Existing StyleCode projects (ADR-0007)

**Decided:** coexistence, with designs copied into the company. Standalone editor projects stay in IndexedDB as today. Attaching a design to an engagement either creates a new one or copies an existing project into the company's `designs/` folder with a new document id, so a design belongs to exactly one company (review point 6) and the original is untouched. Opening an engagement's design loads and saves it through the workspace API instead of IndexedDB, which needs a second persistence adapter for the editor (Phase 1, or later if the canvas link waits). Nothing is migrated automatically.

### Local API security (ADR-0008)

**Decided:** the workspace routes get the same checks as `/api/ai` (§8): the connection comes from a loopback address; `Host` is `localhost`, `127.0.0.1` or `[::1]`; any `Origin` is exactly this server; `Sec-Fetch-Site` is `same-origin` or `none`; and every request carries a StyleCode header. Phase 1 moves these checks from `server/ai/handler.ts` into one shared module, so both APIs use the same code and tests. On top of that, because these routes touch the disk:

- the server refuses to start if the workspace folder is inside this repo or any git repository;
- every id in a path is checked with `isValidId` before it becomes part of a file path, and file names from the browser are never used as paths;
- request bodies have a size limit, and JSON is the only body type except file uploads;
- files are sent back with `X-Content-Type-Options: nosniff` and as downloads, so a stored file can't run as a page;
- responses carry no CORS headers.

### Data protection (ADR-0009)

**Decided:** rely on the operating system's disk encryption now, and don't add app-level encryption yet.

- **Guidance in the app and the guide:** turn on Device encryption (Windows 11 Home, where the hardware supports it) or BitLocker (Pro, Enterprise, Education) ([Microsoft, Device encryption in Windows](https://support.microsoft.com/en-us/windows/device-encryption-in-windows-cf7e2b6f-3e70-4882-9532-18633605b7df), checked 2026-11-04), FileVault on macOS, or LUKS on Linux.
- **Why not app-level encryption now:** with everything on one computer behind the user's login and disk encryption, it adds a passphrase that, if forgotten, loses every client's data, and it complicates search and backups. It becomes worth it when data leaves the computer: export to share, sync (out of scope), or backups to a cloud folder. A new ADR decides it then.
- **Cloud-synced folders:** the app warns if the workspace folder is inside OneDrive, Dropbox or Google Drive, because syncing sends client data off the computer (ADR-0002).
- **Also:** the workspace folder is readable only by the user on macOS and Linux, and relies on the home folder's default permissions on Windows; deleting a company deletes its folder (MVP 1.4); logs never contain client data.
