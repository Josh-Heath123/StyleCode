# StyleCode

A local-first visual UI editor where **the canvas is the prompt**. Draw an interface, select part of it and (in a later phase) ask an AI to change it, then export real frontend code. Everything runs on your machine: no account, no server, no hosting costs.

![The StyleCode editor: an example landing page tidied into auto layout, with a row of cards selected](docs/editor.png)

## Why

Prompt-to-UI tools make you describe everything in words. StyleCode lets you *show* instead. The boxes you draw tell the AI which element you mean, where things sit and what contains what, and text is left for intent: "make this feel more premium".

Under the hood, one design document is the single source of truth. Every edit (yours, and later the AI's) is a small, validated, undoable operation on that document, and code is compiled from it deterministically. The canvas, the code and the preview can never drift apart, and AI changes are targeted and reviewable instead of wholesale rewrites. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full reasoning.

## Status

**Phases 1 and 2 are complete.** The visual editor works on its own, and its layouts are built the way real interfaces are:

- Draw frames, rectangles, ellipses, text and images; nest layers inside frames
- Select, multi-select, marquee, move, resize, rotate; drag layers in and out of frames
- **Auto layout**: frames that arrange their children in a row or column with gap, padding, distribution and alignment, and children that are fixed, hug their content or fill the space left. It behaves exactly like CSS flexbox, which a browser test checks.
- **Tidy into auto layout** (<kbd>Shift</kbd>+<kbd>A</kbd>): turns a rough sketch into nested rows and columns, inferring gaps and alignment, without moving things much
- **Smart guides**: moving, resizing and drawing snap to the edges and centres of nearby layers
- **Semantic roles** (button, navigation, card, heading, image, input, link…) so exported code can use the right HTML tags
- Images stored on your device, shadows, gradients and background blur
- **Blocks**: ready-made buttons, badges, text fields, cards, a navigation bar and a hero section, in light or dark, built from auto layout
- Layers panel with rename, hide, lock and drag to reorder or re-parent; it stays fast with thousands of layers
- Properties panel: position, size and sizing, auto layout, role, opacity, radius, fill or gradient, stroke, shadow, blur, typography, image fit, frame presets, align and distribute
- Group/ungroup, duplicate, copy/paste, z-order, context menu, keyboard shortcuts
- Undo/redo for everything
- Pan and zoom with mouse, trackpad or touch (two-finger pinch)
- Projects autosave in your browser; save to and open from `.stylecode.json` files (images included)

Next up: design-to-code (HTML/CSS and React export with a live preview), then AI collaboration with local (Ollama) or bring-your-own-key models. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Getting started

You need [Node.js](https://nodejs.org) **22.12 or newer**.

```bash
git clone https://github.com/Josh-Heath123/StyleCode.git
cd StyleCode
npm install
npm run dev
```

Then open <http://localhost:5173>. To try a finished layout, choose **Projects → New example project**. The example is drawn freely; select the *Landing page* frame and press <kbd>Shift</kbd>+<kbd>A</kbd> to watch it become rows and columns, then try editing the headline or dragging one of the cards to a new place in its row.

For a faster, production build:

```bash
npm run build
npm run preview    # serves the build at http://localhost:4173
```

## Using the editor

| Action | How |
| --- | --- |
| Move / select tool | <kbd>V</kbd> |
| Frame, rectangle, ellipse, text | <kbd>F</kbd>, <kbd>R</kbd>, <kbd>O</kbd>, <kbd>T</kbd> (then drag, or click for a default size) |
| Add an image | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>, or drop or paste image files onto the canvas |
| Add a block | **Insert** tab on the left: click to add to the selected frame, or drag onto the canvas |
| Add auto layout / tidy a frame | <kbd>Shift</kbd>+<kbd>A</kbd> (on a frame: arranges what is inside it; on other layers: wraps them in a row or column) |
| Remove auto layout | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> |
| Reorder inside auto layout | drag the layer (a line shows where it will land), or use the arrow keys |
| Move without snapping | hold <kbd>Ctrl</kbd>/<kbd>⌘</kbd> while dragging |
| Hand tool / pan | <kbd>H</kbd>, hold <kbd>Space</kbd> and drag, scroll, or two fingers on touch screens |
| Zoom | <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + scroll, pinch, <kbd>Ctrl</kbd>+<kbd>=</kbd> / <kbd>Ctrl</kbd>+<kbd>-</kbd> |
| Zoom to 100% / fit / selection | <kbd>Shift</kbd>+<kbd>0</kbd> / <kbd>Shift</kbd>+<kbd>1</kbd> / <kbd>Shift</kbd>+<kbd>2</kbd> |
| Select inside a frame | <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + click; select a top-level frame by its name label |
| Add to selection | <kbd>Shift</kbd> + click, or drag a marquee |
| Keep proportions / resize from centre | hold <kbd>Shift</kbd> / <kbd>Alt</kbd> while resizing |
| Snap rotation to 15° | hold <kbd>Shift</kbd> while rotating |
| Duplicate while moving | hold <kbd>Alt</kbd> while dragging |
| Edit text | double-click it, or select it and press <kbd>Enter</kbd> |
| Select parent / children | <kbd>Esc</kbd> or <kbd>Shift</kbd>+<kbd>Enter</kbd> / <kbd>Enter</kbd> |
| Nudge | arrow keys (<kbd>Shift</kbd> for 10px); inside auto layout they move the layer one place |
| Undo / redo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> (<kbd>⌘</kbd>+<kbd>Z</kbd> / <kbd>⇧</kbd><kbd>⌘</kbd>+<kbd>Z</kbd>) |
| Duplicate, group, ungroup | <kbd>Ctrl</kbd>+<kbd>D</kbd>, <kbd>Ctrl</kbd>+<kbd>G</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> |
| Bring forward / to front | <kbd>Ctrl</kbd>+<kbd>]</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>]</kbd> |
| Lock / hide | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> |
| Align | buttons in the properties panel, or <kbd>Alt</kbd>+<kbd>A</kbd>/<kbd>D</kbd>/<kbd>W</kbd>/<kbd>S</kbd>/<kbd>H</kbd>/<kbd>V</kbd> |

Number fields accept arithmetic (`1440/3`), step with the arrow keys and can be scrubbed by dragging their label.

## Your data

Projects are stored in your browser's IndexedDB on this device and autosave as you work. Images you add are stored there too, once each however many times you use them; nothing is uploaded anywhere. Use **Projects → Save to file…** to keep a portable copy or move a project between browsers (the images used in the project are embedded in the file), and **Open project file…** to bring one back. Clearing your browser's site data for `localhost` deletes locally stored projects, so save important work to a file.

## Project structure

```
src/
  model/        design document, property registry, operations, geometry, commands,
                auto-layout engine and inference, file format (pure TS, fully tested)
  editor/       editor store, history, camera, React bindings
  render/       the single design → CSS mapping shared by the canvas and (soon) code export
  canvas/       viewport, layer rendering, selection overlay, gestures, snapping, text measurement
  panels/       layers, insert and properties panels
  persistence/  IndexedDB storage, image assets, project files, example project
  app/          app shell, top bar, tool dock, shortcuts, actions, blocks
  ui/           icons and menus
e2e/            browser tests (Playwright), including the layout parity test
docs/           architecture and roadmap
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Serve the production build |
| `npm test` | Run the unit tests |
| `npm run test:e2e` | Run the browser tests (starts its own dev server on port 5174) |
| `npm run test:all` | Unit tests, then browser tests |
| `npm run typecheck` | Type-check the app and the browser tests |

The browser tests need Playwright's Chromium once per machine: `npx playwright install chromium`.

## Tech

React 19 and TypeScript, built with Vite. The canvas renders layers as real DOM elements, so the canvas shows exactly what the exported CSS will render. Runtime dependencies are React, React DOM and the Inter font, and nothing else; tests use Vitest and Playwright.
