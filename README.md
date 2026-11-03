# StyleCode

A local-first visual UI editor where **the canvas is the prompt**. Draw an interface, select part of it and (in a later phase) ask an AI to change it, then export real frontend code. Everything runs on your machine: no account, no server, no hosting costs.

![The StyleCode editor with an example landing page](docs/editor.png)

## Why

Prompt-to-UI tools make you describe everything in words. StyleCode lets you *show* instead. The boxes you draw tell the AI which element you mean, where things sit and what contains what, and text is left for intent: "make this feel more premium".

Under the hood, one design document is the single source of truth. Every edit (yours, and later the AI's) is a small, validated, undoable operation on that document, and code is compiled from it deterministically. The canvas, the code and the preview can never drift apart, and AI changes are targeted and reviewable instead of wholesale rewrites. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full reasoning.

## Status

**Phase 1 (foundation) is complete.** The visual editor works on its own:

- Draw frames, rectangles, ellipses and text; nest layers inside frames
- Select, multi-select, marquee, move, resize, rotate; drag layers in and out of frames
- Layers panel with rename, hide, lock and drag to reorder or re-parent
- Properties panel: position, size, rotation, opacity, radius, fill, stroke, typography, frame presets, align and distribute
- Group/ungroup, duplicate, copy/paste, z-order, context menu, keyboard shortcuts
- Undo/redo for everything
- Pan and zoom with mouse, trackpad or touch (two-finger pinch)
- Projects autosave in your browser; save to and open from `.stylecode.json` files

Next up: auto-layout and design-to-code, then AI collaboration with local (Ollama) or bring-your-own-key models. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Getting started

You need [Node.js](https://nodejs.org) **22.12 or newer**.

```bash
git clone https://github.com/Josh-Heath123/StyleCode.git
cd StyleCode
npm install
npm run dev
```

Then open <http://localhost:5173>. To try a finished layout, choose **Projects → New example project**.

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
| Nudge | arrow keys (<kbd>Shift</kbd> for 10px) |
| Undo / redo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> (<kbd>⌘</kbd>+<kbd>Z</kbd> / <kbd>⇧</kbd><kbd>⌘</kbd>+<kbd>Z</kbd>) |
| Duplicate, group, ungroup | <kbd>Ctrl</kbd>+<kbd>D</kbd>, <kbd>Ctrl</kbd>+<kbd>G</kbd>, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> |
| Bring forward / to front | <kbd>Ctrl</kbd>+<kbd>]</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>]</kbd> |
| Lock / hide | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> |
| Align | buttons in the properties panel, or <kbd>Alt</kbd>+<kbd>A</kbd>/<kbd>D</kbd>/<kbd>W</kbd>/<kbd>S</kbd>/<kbd>H</kbd>/<kbd>V</kbd> |

Number fields accept arithmetic (`1440/3`), step with the arrow keys and can be scrubbed by dragging their label.

## Your data

Projects are stored in your browser's IndexedDB on this device and autosave as you work. Use **Projects → Save to file…** to keep a portable copy or move a project between browsers, and **Open project file…** to bring one back. Clearing your browser's site data for `localhost` deletes locally stored projects, so save important work to a file.

## Project structure

```
src/
  model/        design document, property registry, operations, geometry, commands, file format (pure TS, fully tested)
  editor/       editor store, history, camera, React bindings
  render/       the single design → CSS mapping shared by the canvas and (soon) code export
  canvas/       viewport, layer rendering, selection overlay, gestures, text measurement
  panels/       layers and properties panels
  persistence/  IndexedDB storage, project files, example project
  app/          app shell, top bar, tool dock, shortcuts, actions
  ui/           icons and menus
docs/           architecture and roadmap
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Serve the production build |
| `npm test` | Run the unit tests |
| `npm run typecheck` | Type-check only |

## Tech

React 19 and TypeScript, built with Vite. The canvas renders layers as real DOM elements, so the canvas shows exactly what the exported CSS will render. Runtime dependencies are React, React DOM and the Inter font, and nothing else.
