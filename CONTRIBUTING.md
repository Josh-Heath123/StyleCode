# Contributing to StyleCode

StyleCode doesn't take outside contributions: pull requests from outside the project aren't merged. Reporting a bug is still welcome (see the end of this page).

If an outside contribution is ever accepted, it will be only after its contributor has signed a written assignment, or a written licence, of their rights in it to the owner, Joshua Heath. Until then, nothing from outside the project is merged.

This page describes how StyleCode is worked on: its few firm principles, the layout of the code, and what a change needs before it is merged. StyleCode is released under the [PolyForm Strict License 1.0.0](LICENSE), which doesn't allow changing or redistributing it.

## Principles

These come from the project's brief and every change keeps them:

- **Local-first.** Client data, recordings, designs and images stay on the user's computer: client work in the `StyleCode Data` folder, the standalone editor's designs in the browser. Nothing is uploaded, there is no account, and the app must keep working with no network.
- **No cost to run.** No paid services or hosting are required. The app is static; the optional AI server is a Vite plugin that runs on the user's own computer.
- **Keys never reach the browser.** API keys are typed once, saved by the local server in its own file (readable only by the user on macOS and Linux; on Windows, protected by the home folder's default permissions), and used only by that server. Never put a key, or anything that could reveal one, in frontend code, the project file or logs.
- **AI is optional.** Every feature works with AI off. The AI changes the design document through the same validated operations as the user, never the code, and its changes are always a proposal the user accepts or rejects.
- **One source of truth.** The design document is the model; the canvas, the code panel and exports are all derived from it. Edits are invertible operations, so everything can be undone.
- **Nothing that doesn't work.** No placeholder buttons, mock data or half-finished controls. If a feature isn't ready, it isn't shown.
- **Light.** Runtime dependencies are React, React DOM and the Inter font. Adding one needs a strong reason, discussed in an issue first.

## Getting set up

You need [Node.js](https://nodejs.org) 22.12 or newer.

```bash
git clone https://github.com/Josh-Heath123/StyleCode.git
cd StyleCode
npm install
npx playwright install chromium   # once per machine, for the browser tests
npm run dev                        # http://localhost:5173 (workspace data in ~/StyleCode Data (development))
```

To try the AI flow without installing a model, run the fake Ollama the tests use and point **AI settings** at the address it prints:

```bash
node --experimental-strip-types e2e/fakeOllama.ts
```

## Where things are

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the design and the reasons behind it; read the sections for the area you are changing. In short:

| Folder | What lives there |
| --- | --- |
| `src/model` | The design document, property registry, operations, layout engine, file format. Pure TypeScript, no React or DOM. |
| `src/editor` | The editor store, history and camera, and the React bindings. |
| `src/canvas` | The canvas: rendering layers, the overlay, gestures, snapping, text measurement. |
| `src/panels` | Layers, Insert, Design and Code panels. |
| `src/render` | The one mapping from the design to CSS, shared by the canvas and code export. |
| `src/codegen` | HTML, CSS and React generators, the CSS parser, exports. Pure functions. |
| `src/ai` | The assistant: context, instructions, schema, interpreting replies. |
| `src/app` | The app shell, top bar, dock, dialogs, onboarding, shortcuts. |
| `src/persistence` | IndexedDB storage, images, project files. |
| `src/workspace` | The consulting workspace: its domain model (`model/`, pure and versioned), transcript import, extraction, recording, transcription and its pages (`ui/`). |
| `server/ai` | The local AI server (settings, keys, providers). |
| `server/workspace` | The local workspace server: the data folder, clients, saves, files, recordings. |
| `server/transcription` | Transcription on this computer: setup, jobs, the GPU's turn. |
| `server/shared` | Request checks and renames that retry, shared by the local servers. |
| `e2e` | Browser tests, and `e2e/demos` for the README's pictures. |
| `scripts` | The documentation site builder, the hygiene, token and dependency checks, the third-party notices. |
| `spikes` | Experiments with their own dependencies, never imported by `src`. |

A few rules that keep the layers clean: `model` and `codegen` don't depend on React, the DOM or `app` (test fixtures aside), so they run anywhere; every change to a document goes through `applyOps` (usually via `editor.apply` or a gesture); a new layer property is added to `model/types.ts`, `model/defaults.ts` and the registry in `model/properties.ts`, which then drives validation, the AI schema and the file format.

## Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Build if needed and serve StyleCode for client work, with the real data folder |
| `npm run dev` | Start the development server (data in `StyleCode Data (development)`) |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Serve the production build (uses the real data folder, like `npm start`) |
| `npm test` | Run the unit tests |
| `npm run test:e2e` | Run the browser tests (starts its own dev server on port 5174, with AI settings and workspace data in temporary places) |
| `npm run test:all` | Unit tests, then browser tests |
| `npm run typecheck` | Type-check the app and the browser tests |
| `npm run format` / `format:check` | Format with Prettier / check the formatting, as CI does |
| `npm run check:hygiene` | What may never be committed: audio, video, archives, big files, user folders, email addresses, likely secrets |
| `npm run check:tokens` | Colours only through the tokens, orange only for the AI |
| `npm run check:readme` | Every relative link, image and anchor in the Markdown resolves, and the README's figures match their sources |
| `npm run notices` | Rewrite THIRD-PARTY-NOTICES.md after a dependency or transcription download changes |
| `npm run transcription:setup` | Download and check what transcription on this computer needs (Windows with an NVIDIA graphics card; about 1.3 GB) |
| `npm run demos` | Make the README's pictures (needs ffmpeg) |
| `npm run site` | Build the documentation site into `site/` (`npm run build:pages` also builds the app into it) |

## Tech

React 19 and TypeScript, built with Vite. The canvas renders layers as real DOM elements, so it shows exactly what the exported CSS will render. Runtime dependencies are React, React DOM (with its scheduler) and the Inter font, and nothing else. The local servers use only Node's standard library (`fetch`, `http`, `fs`); transcription runs whisper.cpp and sherpa-onnx, downloaded by `npm run transcription:setup`, never committed. Tests use Vitest and Playwright, with axe for accessibility.

## Making a change

1. For anything bigger than a small fix, open an issue first so the approach can be agreed.
2. Keep the change focused. A pull request that does one thing is easier to review and to undo.
3. Write tests alongside the code (below).
4. Run the checks:

   ```bash
   npm run typecheck
   npm test             # unit tests (Vitest)
   npm run test:e2e     # browser tests (Playwright); starts its own dev server
   ```

5. If you changed generated code on purpose, update the snapshots with `npx vitest run -u` and check the diff reads as intended.
6. If the change is visible, update the README or [the guide](docs/GUIDE.md), and the roadmap if it finishes something listed there.

## Tests

CI runs on every pull request: formatting, the type-check, the hygiene, token and README checks, the licence checks (REUSE and third-party notices), the unit tests, a production build and the browser tests (a pull request that changes only documentation skips the browser tests). The browser tests also run on Windows every night. The owner merges a pull request only when every required check passes.

- **Model, layout, codegen and AI logic** get unit tests in a `*.test.ts` file next to the code. They run in Node, so they must not need the DOM.
- **Anything a user does** gets a browser test in `e2e/`: drive the real editor with the mouse and keyboard and check the document (`snapshot(page)` in `e2e/helpers.ts` reads the editor's state).
- **Layout** changes must keep `e2e/layout-parity.spec.ts` passing: it compares the layout engine with the browser's own flexbox and grid on random trees. New layout features belong in its generator.
- **Accessibility**: `e2e/accessibility.spec.ts` runs axe over the editor, panels, dialogs and menus. New UI should pass it, and be usable from the keyboard.
- **Performance**: `src/model/performance.test.ts` holds budgets for a 5,000-layer document. They are generous; if one fails, something got much slower.

## Style

- Formatting is Prettier with the project's settings (`.prettierrc.json`): run `npm run format` before committing (CI runs `npm run format:check`; Markdown is excluded).
- TypeScript is strict. Prefer clear names over comments; write a comment when it explains *why*, or something a reader couldn't work out from the code.
- Interface text is plain English: short, specific, no jargon, no exclamation marks. Say what happened and what the user can do about it.
- Colours, spacing and type come from the tokens at the top of `src/styles/app.css`. Text must meet WCAG AA contrast (4.5:1) on the surfaces it sits on.

## The README's pictures

Every picture in `docs/media` is made by Playwright with `npm run demos`:

- **The screenshots** (`e2e/demos/screenshot.demo.ts`, `workspace.demo.ts`): the real app at 1440×900 and 2×, from role-played clients (Karoo Freight, Harbour Bakery).
- **The GIFs** (`e2e/demos/record.demo.ts`): the real editor at 1440×900, turned into GIFs by [ffmpeg](https://ffmpeg.org), which needs to be on your PATH (on Windows, `winget install Gyan.FFmpeg`).
- **The hero, the two diagrams and the social preview** (`e2e/demos/brand.demo.ts`): the HTML pages in `docs/brand/`, rendered to PNG with the app's tokens and Inter.

```bash
npm run demos            # everything
npm run demos -- brand   # only the pages in docs/brand/
```

The demos' dev server keeps its data in its own folder, `C:\StyleCode Demo Data` on Windows (`e2e/demos/demoWorkspace.ts`), emptied before each run: the workspace pages show their data folder's path, so it names no user. Look at every picture before committing it, and at frames from across each GIF: no user folder or account name, no test suffixes in names, role-played data only. Keep each screenshot under about 600 KB and each GIF under about 3 MB, shortening a GIF rather than lowering its quality.

The AI in the pictures is a scripted stand-in model, so they are repeatable; keep that labelled wherever they are shown.

## The documentation site

`npm run site` builds a small site from the Markdown docs into `site/`. On every push to `main`, the Pages workflow builds it together with the app (a live demo, without AI, since that needs the local server) and publishes both to GitHub Pages.

## Reporting bugs and security issues

Use the issue templates for bugs and ideas. For a security problem, especially anything involving API keys, please don't open a public issue: report it privately, as [SECURITY.md](SECURITY.md) explains.
