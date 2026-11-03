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
 (Phase 4)   │  AI assistant ──▶ proposed operations ─┘     design document     │
             │                    (validated, previewed)          │             │
             │                                  ┌─────────────────┼──────────┐  │
             │                                  ▼                 ▼          ▼  │
             │                            canvas (DOM)   code generators  IndexedDB
             │                                           (Phase 3)       + files │
             └──────────────────────────────────────────────────────────────────┘
 (Phase 4)   local dev server: proxies AI calls, holds API keys, talks to Ollama
```

Source layout:

| Folder | Responsibility | May import |
| --- | --- | --- |
| `src/model` | Document types, property registry, operations, geometry, commands, the auto-layout engine and layout inference, file format. Pure TypeScript, no React, no DOM. | nothing outside `model` |
| `src/editor` | The editor store (document + editing state), history, camera, React bindings. | `model` |
| `src/render` | The single design-property → CSS mapping. | `model` |
| `src/canvas` | Canvas viewport, layer rendering, overlay, pointer gestures, snapping, text measurement, the layout normaliser. | `model`, `editor`, `render`, `ui` |
| `src/panels` | Layers, insert and properties panels and their controls. | everything above |
| `src/persistence` | IndexedDB storage, image assets, project files, example project. | `model`, `editor` |
| `src/app` | App shell, top bar, tool dock, shortcuts, shared actions, inserting images and blocks. | everything |
| `src/ui` | Generic UI: icons, menus. | nothing app-specific |

The `model` layer is the part that matters most and is tested most heavily. Everything above it is a view or an input method. Unit tests (Vitest) sit next to the code they test; browser tests (Playwright) live in `e2e/` and drive the real app.

## 3. The design document

The document is a flat map of nodes plus a root id:

```ts
interface DesignDocument { id; name; rootId; nodes: Record<string, DesignNode> }
interface DesignNode extends NodeProps { id; type; parentId; children: string[] }
```

- **Flat map, ordered children.** Lookups by id are O(1) (important for AI operations, which reference ids), and the tree is expressed by `parentId` + `children`. Children are in paint order: later is on top.
- **Node types:** `page` (the root, also the canvas background), `frame` (container), `rect`, `ellipse`, `text`, `image`. Only `page` and `frame` can contain children. A *group* is simply a frame without fill or clipping, which is exactly how it will be expressed in HTML: a `div`.
- **Flat properties.** Every editable property (`x`, `fill`, `fontSize`, …) is a top-level key described in the **property registry** (`model/properties.ts`): its type, range, and which node types it applies to. The registry drives validation, the properties panel, and will drive the AI's operation schema and the code generators. Adding a property means adding one registry entry.
- **CSS semantics, on purpose.** Coordinates follow the CSS box model: a child's `x`/`y` is its offset from the parent's *padding box* (inside the parent's border), rotation is around the centre, and `box-sizing` is `border-box`. Design tools like Figma use their own model; StyleCode uses CSS's because its promise is that the canvas *is* the code. Changing a frame's border width therefore shifts its children by that width, exactly as the exported CSS will.
- **Layout and meaning are properties too.** A frame's `layout` (`none`, `row`, `column`), `gap`, per-side padding, `justify` and `align` make it an auto-layout frame; every layer has `widthMode`/`heightMode` (`fixed`, `hug`, `fill`), `positioning` (`auto`, or `absolute` to sit outside the flow) and a semantic `role` (button, nav, card, heading, input, link…). Roles change nothing visually; they tell the code generators which HTML element to use and tell the AI what a layer is.
- **Versioned file format.** Saved projects are `{ format: "stylecode", version, document, assets? }`. Loading goes through `parseProject`, which validates every property, repairs what it safely can (bad values fall back to defaults, dangling references are dropped) and rejects files from newer versions with a clear message instead of crashing. Version 2 added auto layout, sizing, roles, effects and images; version 1 files open unchanged, because every new property has a default that reproduces the old behaviour.

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

AI edits will be transactions with `source: 'ai'`. They undo exactly like manual edits.

## 5. Auto layout

### The engine lives in the model

Auto-layout frames arrange their children like CSS flexbox. On a DOM canvas there were two ways to build that:

| Option | Verdict |
| --- | --- |
| Render auto-layout frames with `display: flex` and read positions back from the DOM | Exact by definition, but the document would no longer know where its own layers are. Hit-testing, snapping, the selection overlay, resize maths, the AI's context and undo would all wait on a render-then-measure step, and every layout change would cost two renders. |
| **Resolve layout in the model and write the result back as x/y/width/height** ✅ | One geometry for everything. Layout runs inside the transaction of the edit that caused it, so undo is exact and the AI sees real coordinates. The price is keeping a flexbox subset faithful to the browser, which a test enforces (below). |

`model/layout.ts` supports: row or column; gap; padding per side; `justify` start, centre, end or space-between; `align` start, centre or end; children that are **fixed**, **hug** their content (auto-layout frames and auto-sized text) or **fill** the space left (`flex: 1 1 0; min-width: 0` along the main axis, `align-self: stretch` across it); children set to ignore auto layout (`position: absolute`); hidden children skipped. There is no wrapping yet, and rotation does not affect layout, as in CSS.

`layoutRoots` works out which frames a change can affect: the outermost frame of each unbroken chain of auto-layout ancestors. Editing a word deep inside a card re-lays out that card and whatever hugs it, and nothing else.

### Parity with the browser

`e2e/layout-parity.spec.ts` builds random nested auto-layout trees (150 per run, from a fixed seed, including tiny outlined shapes and frames smaller than their own padding), lays each one out with the engine, renders the same tree in Chromium using the flexbox declarations from `render/css.ts`, and compares every box to within half a pixel. It found five places where a reasonable-looking engine disagrees with CSS, now encoded as rules:

- A layer can only fill along an axis where its parent's size is decided by something else. In a parent that hugs that axis there is no space to fill, so it keeps its own size.
- A box is never smaller than its border plus, for an auto-layout frame, its padding (with `box-sizing: border-box` the browser cannot draw it smaller). The normaliser enforces this for every layer, so the model never records a size the canvas can't show.
- A filling layer starts from that minimum; the space left after those is what gets shared.
- Sizes can be 0: an empty hugging frame collapses to its padding.
- Text is measured to hundredths of a pixel and rounded up, not to whole pixels, or a row of labels drifts.

The code generators in Phase 3 will emit the same declarations, so this test also pins what exported code does.

### Tidy into auto layout

<kbd>Shift</kbd>+<kbd>A</kbd> on a freely drawn frame infers a structure for it (`model/infer.ts`, applied by `model/autolayout.ts`) with recursive **XY-cut**, a classic page-analysis technique: find a band of empty space running all the way across the layers, split there, and repeat inside each part until single layers remain. Where both a horizontal and a vertical split exist, the wider whitespace wins, so three cards side by side become three columns even though each card is itself a stack; a tie goes to a column, since pages read top to bottom. Then:

- each row or column gets the median of its gaps and whichever alignment (start, centre, end) its edges agree on best;
- groups separated by much larger gaps than the rest (a logo, a set of links and a button) become clusters in a `space-between` row;
- the frame's padding is the distance from its edges to the content, so nothing moves more than it must;
- a single layer sitting in the middle of its frame (a label in a button) is centred for real, so it stays centred when either changes size;
- layers that overlap cannot be split, so they stay together as a freely arranged group, and a frame whose layers all overlap is left alone with an explanation;
- frames inside that are still freely arranged are tidied too, so one command structures a whole sketch.

Inference is deterministic: the same sketch always gives the same structure, and the whole result is one undoable step. This is exactly the kind of geometry a language model is bad at, so in Phase 4 the AI will call it rather than reinvent it.

With other layers selected, <kbd>Shift</kbd>+<kbd>A</kbd> wraps them in a new hugging row or column without moving them. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> turns auto layout off and leaves everything where it is.

### Editing inside auto layout

Dragging a layer inside an auto-layout frame lifts it out of the flow, so it follows the pointer while the others close up, and a cantaloupe line shows where it will land; dropping it puts it back into the flow at that place. Passing over a sibling frame it could not fit inside (one card over another) keeps reordering rather than dropping into that frame; a smaller layer can still be dropped into a bigger sibling. Arrow keys move the selection one place instead of one pixel, and selected neighbours move together. Resizing a hugging or filling layer, with the handles or by typing a width or height, switches that axis to a fixed size. Align and distribute only move layers that auto layout doesn't place. A layer set to ignore auto layout keeps its own position, but if it is an auto-layout frame itself it still lays out its contents. The layers panel lists auto-layout children in reading order (first at the top) rather than front-to-back, so the list matches the row or column.

### Smart guides

Outside auto layout, moving, resizing and drawing snap a layer's edges and centre to the edges and centres of its siblings and of the frame it is in, within 6 screen pixels (so the pull feels the same at every zoom), and draw the guide lines that explain each snap. Holding <kbd>Ctrl</kbd>/<kbd>⌘</kbd> turns snapping off for that gesture.

## 6. Canvas rendering: real DOM, screen-space overlay

The single most consequential technical decision is how the canvas draws.

| Option | Verdict |
| --- | --- |
| HTML `<canvas>` / WebGL (Figma's approach) | Fast for huge vector documents, but StyleCode would have to re-implement CSS: text wrapping, fonts, shadows, gradients, `backdrop-filter`, and above all flexbox and grid. Every gap between that re-implementation and the browser is a bug where the canvas disagrees with the exported code. |
| SVG | Good for shapes, poor for text layout, and not how the output will be built. |
| Canvas library (Konva, Fabric, Pixi) | Same fidelity problem plus a large dependency. |
| **DOM for content + screen-space overlay** ✅ | Layers are real `div`s (and `img`s) styled by the same function that will generate the exported CSS. Text, fonts, shadows, gradients and blur come from the browser for free, so what you see is what the code renders; auto-layout positions come from the model and are checked against the browser's own flexbox. Selection outlines, handles and guides live in a separate SVG overlay in screen space, so they stay 1px crisp at any zoom. |

Pan and zoom are a single CSS transform on the content layer, so they never re-render layers. Each layer component subscribes only to its own node, so editing one layer re-renders one component. UI documents rarely exceed a few hundred layers; in a 1,000-layer document, dragging 99 selected layers costs about 13 ms per pointer move in a production build. The layers panel is virtualised: only the rows in view (plus a margin) are rendered, so the list stays responsive with thousands of layers.

Hit-testing uses the browser where it is exact (which element is under the pointer, including rounded corners and rotation) and the model's affine matrices where it needs geometry (which frame a point is in, marquee intersection, resize maths). All geometry uses 2D affine matrices, so rotation and nesting compose correctly with auto layout.

Text is measured with an off-screen element styled by the same CSS mapping, so measured and rendered sizes match exactly. Inter ships with the app so measurement is identical on every machine and offline; documents are re-fitted on open in case fonts differ.

## 7. Local-first persistence

There is no account and no server. The open project autosaves to **IndexedDB** half a second after each change and on tab hide. Projects can be saved to and opened from `.stylecode.json` files (using the File System Access API's save dialog where the browser supports it, a download otherwise). Opening a file always creates a new local project, so it can never overwrite existing work. If the same project is open in two tabs, a notice explains that the last tab to save wins.

**Images** are stored in their own IndexedDB store as blobs, keyed by a SHA-256 hash of their content (`asset_…`). The same picture added twice is stored once, and image layers refer to it by id, so the document stays small and copying an image layer between projects just works. Images up to 15 MB are accepted. Layers on screen share one object URL per image, released a few seconds after the last one goes away; a layer whose image is missing shows a placeholder and picks the image up as soon as it is added. Images finish loading in the background, and an insert waits for any drag or scrub in progress to end so it never interrupts it. Saving to a file embeds the images that project uses (base64, under `assets`), so a saved file is self-contained; opening it puts them back into the local store. Nothing is uploaded anywhere.

**Blocks** (button, badge, text field, card, navigation bar, hero section, in light or dark) are plain functions that build a subtree of auto-layout frames with roles set. They are inserted like anything else, as one undoable operation, and are fully editable afterwards; there is no separate component system to keep in sync.

## 8. AI architecture (Phase 4, designed now)

### Pipeline

```
user request + selection
  → context builder      (compact, relevant slice of the document)
  → provider             (Ollama / OpenAI-compatible / Anthropic …)
  → structured response  ({ explanation, operations[] } constrained by JSON schema)
  → validation           (tryApplyOps against the real document + AI policy checks)
  → preview              (proposed changes shown on the canvas, in cantaloupe)
  → accept → transaction (source: 'ai', undoable)   |   reject → nothing changed
```

### Context, not the whole document

Small models have small context windows, so the context builder sends what matters for the request, not the whole tree:

- the selection with full properties;
- its ancestors (for layout context) and siblings (for spatial relationships);
- a one-line-per-node summary of the rest of the frame;
- short ids (`e1`, `e2`, …) aliased to real ids, which saves tokens and reduces mis-typed references;
- the property registry's descriptions as the schema for what may be changed.

### Safeguards

- **Schema-constrained output.** Ollama accepts a JSON schema in its `format` parameter (since v0.5) and constrains generation to it; hosted providers have equivalent structured-output modes.
- **Validation is the same as for manual edits.** Invalid operations are rejected before anything changes; the error is fed back to the model for one repair attempt.
- **AI policy on top of validity.** Operations may only touch the selection and its descendants unless the request is explicitly page-wide; locked layers are off-limits (locking becomes "protect this from the AI"); deletions above a threshold need confirmation.
- **Preview before apply.** Proposed changes are shown on the canvas in the AI accent colour with an accept/reject choice and a plain-language explanation.
- **Undo.** Accepted proposals are ordinary transactions.

### Providers and keys

Three modes, all first-class:

1. **No AI.** The editor and code export are fully useful on their own.
2. **Local.** Ollama on `localhost`. No key, no cost, nothing leaves the machine. Ollama accepts browser requests from `localhost` origins by default.
3. **Bring your own key.** OpenAI-compatible endpoints (which also covers LM Studio, llama.cpp's server, OpenRouter and Groq), Anthropic and others.

API keys are **never stored in or sent to the browser**. StyleCode already runs a local Node process (the Vite dev server, or a small static server for the built app); Phase 4 adds a tiny local proxy route to it that reads keys from a local `.env` or config file in the user's home directory and forwards requests. Keys stay on the user's machine and out of frontend code, browser storage and the repository. This costs the project owner nothing to host.

### Local model trade-offs

| Factor | Reality | Mitigation |
| --- | --- | --- |
| Hardware | 7–9B models at 4-bit need roughly 5–8 GB of RAM or VRAM; 3–4B models fit 8 GB laptops. | Operations are short (100–500 tokens), so even CPU-only generation is tolerable; model choice is a setting. |
| Quality | Small models are weaker at design judgement and nested JSON. | Constrained decoding, a narrow operation vocabulary, validation with a repair loop, and deterministic commands doing the heavy lifting. |
| Speed | Grammar-constrained decoding is noticeably slower than free text. | Small outputs, streaming of the explanation, and the UI never blocks editing. |
| Context window | Ollama picks its default context size from available VRAM (4K tokens on typical laptops) and silently truncates prompts that exceed it. | The app sets `num_ctx` explicitly on the native API and budgets the context it sends. |
| Installation | Ollama installs with one download on Windows, macOS and Linux. | Clear setup instructions, connection check in settings, and no-AI mode always available. |

## 9. Code generation (Phase 3, designed now)

Generators are pure functions from the document to files:

- **HTML/CSS**: semantic tags chosen from node roles (`nav`, `header`, `button`, `section`), class names from layer names, the same CSS declarations the canvas renders.
- **React**: one component per top-level frame, with reusable components extracted from repeated structures.

The hard problem is layout. A sketch is absolutely positioned boxes, but good code uses flexbox and grid. Phase 2 solved the model side: **auto-layout frames** whose behaviour is pinned to real flexbox (section 5), a deterministic **tidy** command that infers rows, columns, gaps and alignment from rough geometry, and **semantic roles** that say which element a layer is. The generators emit `render/css.ts`'s flexbox declarations for auto-layout frames and choose tags from roles. Code generated from auto-layout frames is responsive; absolutely positioned content is exported faithfully but flagged.

Code → design sync is deliberately limited: a full React parser round-trip is a rabbit hole. Instead, the code panel will allow editing each layer's CSS declarations, which map one-to-one onto registry properties and so can be parsed back into operations.

## 10. Known risks

| Risk | Mitigation |
| --- | --- |
| Turning rough geometry into clean responsive layout | Auto-layout as a first-class model concept; deterministic inference; AI used for semantics, not maths. |
| Small models producing invalid or hallucinated operations | Constrained decoding, short ids, validation, a repair attempt, and preview before apply. |
| Silent context truncation in Ollama | Explicit `num_ctx` and a context budget. |
| AI damaging existing work | Scoped operations, locked layers protected, preview, atomic undoable transactions. |
| DOM canvas performance at scale | Per-node subscriptions, transform-based pan/zoom, structural sharing, a virtualised layer list. |
| Canvas and export disagreeing | One CSS mapping used by both; CSS box-model semantics in the document; a randomised browser test comparing the layout engine with real flexbox. |
| Large images bloating storage and files | Content-addressed storage (each picture stored once), a 15 MB limit per image, and only images in use are embedded in saved files. |
| API key exposure | Keys live in a local server process, never in browser code or storage. |
| Scope creep | Each phase must leave the app working; no feature without a place in the core loop. |
