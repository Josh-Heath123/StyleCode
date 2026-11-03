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
| `src/model` | Document types, property registry, operations, geometry, commands, file format. Pure TypeScript, no React, no DOM. | nothing outside `model` |
| `src/editor` | The editor store (document + editing state), history, camera, React bindings. | `model` |
| `src/render` | The single design-property → CSS mapping. | `model` |
| `src/canvas` | Canvas viewport, layer rendering, overlay, pointer gestures, text measurement. | `model`, `editor`, `render`, `ui` |
| `src/panels` | Layers and properties panels and their controls. | everything above |
| `src/persistence` | IndexedDB storage, project files, example project. | `model`, `editor` |
| `src/app` | App shell, top bar, tool dock, shortcuts, shared actions. | everything |
| `src/ui` | Generic UI: icons, menus. | nothing app-specific |

The `model` layer is the part that matters most and is tested most heavily. Everything above it is a view or an input method.

## 3. The design document

The document is a flat map of nodes plus a root id:

```ts
interface DesignDocument { id; name; rootId; nodes: Record<string, DesignNode> }
interface DesignNode extends NodeProps { id; type; parentId; children: string[] }
```

- **Flat map, ordered children.** Lookups by id are O(1) (important for AI operations, which reference ids), and the tree is expressed by `parentId` + `children`. Children are in paint order: later is on top.
- **Node types:** `page` (the root, also the canvas background), `frame` (container), `rect`, `ellipse`, `text`. Only `page` and `frame` can contain children. A *group* is simply a frame without fill or clipping, which is exactly how it will be expressed in HTML: a `div`.
- **Flat properties.** Every editable property (`x`, `fill`, `fontSize`, …) is a top-level key described in the **property registry** (`model/properties.ts`): its type, range, and which node types it applies to. The registry drives validation, the properties panel, and will drive the AI's operation schema and the code generators. Adding a property means adding one registry entry.
- **CSS semantics, on purpose.** Coordinates follow the CSS box model: a child's `x`/`y` is its offset from the parent's *padding box* (inside the parent's border), rotation is around the centre, and `box-sizing` is `border-box`. Design tools like Figma use their own model; StyleCode uses CSS's because its promise is that the canvas *is* the code. Changing a frame's border width therefore shifts its children by that width, exactly as the exported CSS will.
- **Versioned file format.** Saved projects are `{ format: "stylecode", version, document }`. Loading goes through `parseProject`, which validates every property, repairs what it safely can (bad values fall back to defaults, dangling references are dropped) and rejects files from newer versions with a clear message instead of crashing.

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

A **normaliser** hook runs after every batch, inside the same transaction. It currently keeps auto-sizing text boxes fitted to their content, so undoing a text edit also restores the box size. The same hook will host layout normalisation (auto-layout) in Phase 2.

AI edits will be transactions with `source: 'ai'`. They undo exactly like manual edits.

## 5. Canvas rendering: real DOM, screen-space overlay

The single most consequential technical decision is how the canvas draws.

| Option | Verdict |
| --- | --- |
| HTML `<canvas>` / WebGL (Figma's approach) | Fast for huge vector documents, but StyleCode would have to re-implement CSS: text wrapping, fonts, shadows, gradients, `backdrop-filter`, and above all flexbox and grid. Every gap between that re-implementation and the browser is a bug where the canvas disagrees with the exported code. |
| SVG | Good for shapes, poor for text layout, and not how the output will be built. |
| Canvas library (Konva, Fabric, Pixi) | Same fidelity problem plus a large dependency. |
| **DOM for content + screen-space overlay** ✅ | Layers are real `div`s styled by the same function that will generate the exported CSS. Text, effects and (in Phase 2) auto-layout come from the browser for free, so what you see is what the code renders. Selection outlines and handles live in a separate SVG overlay in screen space, so they stay 1px crisp at any zoom. |

Pan and zoom are a single CSS transform on the content layer, so they never re-render layers. Each layer component subscribes only to its own node, so editing one layer re-renders one component. UI documents rarely exceed a few hundred layers; in a 1,000-layer document, dragging 99 selected layers costs about 13 ms per pointer move in a production build.

Hit-testing uses the browser where it is exact (which element is under the pointer, including rounded corners and rotation) and the model's affine matrices where it needs geometry (which frame a point is in, marquee intersection, resize maths). All geometry uses 2D affine matrices from day one, so rotation and nesting compose correctly and auto-layout can slot in later.

Text is measured with an off-screen element styled by the same CSS mapping, so measured and rendered sizes match exactly. Inter ships with the app so measurement is identical on every machine and offline; documents are re-fitted on open in case fonts differ.

## 6. Local-first persistence

There is no account and no server. The open project autosaves to **IndexedDB** half a second after each change and on tab hide. Projects can be saved to and opened from `.stylecode.json` files (using the File System Access API's save dialog where the browser supports it, a download otherwise). Opening a file always creates a new local project, so it can never overwrite existing work. If the same project is open in two tabs, a notice explains that the last tab to save wins.

## 7. AI architecture (Phase 4, designed now)

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

## 8. Code generation (Phase 3, designed now)

Generators are pure functions from the document to files:

- **HTML/CSS**: semantic tags chosen from node roles (`nav`, `header`, `button`, `section`), class names from layer names, the same CSS declarations the canvas renders.
- **React**: one component per top-level frame, with reusable components extracted from repeated structures.

The hard problem is layout. A sketch is absolutely positioned boxes, but good code uses flexbox and grid. Phase 2 adds **auto-layout frames** (direction, gap, padding, alignment), which the canvas renders with real flexbox and the generators emit directly, plus a deterministic **"tidy into auto-layout"** command that infers rows, columns, gaps and alignment from rough geometry. Code generated from auto-layout frames is responsive; absolutely positioned content is exported faithfully but flagged.

Code → design sync is deliberately limited: a full React parser round-trip is a rabbit hole. Instead, the code panel will allow editing each layer's CSS declarations, which map one-to-one onto registry properties and so can be parsed back into operations.

## 9. Known risks

| Risk | Mitigation |
| --- | --- |
| Turning rough geometry into clean responsive layout | Auto-layout as a first-class model concept; deterministic inference; AI used for semantics, not maths. |
| Small models producing invalid or hallucinated operations | Constrained decoding, short ids, validation, a repair attempt, and preview before apply. |
| Silent context truncation in Ollama | Explicit `num_ctx` and a context budget. |
| AI damaging existing work | Scoped operations, locked layers protected, preview, atomic undoable transactions. |
| DOM canvas performance at scale | Per-node subscriptions, transform-based pan/zoom, structural sharing; virtualise the layer list if documents grow past a few thousand layers. |
| Canvas and export disagreeing | One CSS mapping used by both; CSS box-model semantics in the document. |
| API key exposure | Keys live in a local server process, never in browser code or storage. |
| Scope creep | Each phase must leave the app working; no feature without a place in the core loop. |
