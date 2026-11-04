# CLAUDE.md

Guidance for Claude Code in this repository. Read this first in every session.

## What this is

StyleCode is a local-first visual UI editor: you draw on a canvas, tidy the result into auto layout (rows, columns, grids), export real HTML/CSS or React, and an optional AI proposes changes you accept or reject. Phases 1–5 of that editor are complete (v0.5.0).

The project is now becoming an **AI-assisted consulting workspace** for software consultants. It captures client consultations (with consent), turns them into a structured record of requirements, keeps per-client knowledge, and designs the interface in the StyleCode editor. Later phases add technology, architecture and cost analysis. The vision is in `docs/vision/PRODUCT-VISION.md`. The current phase brief is in `docs/phase-N/`, and the roadmap in `docs/ROADMAP.md`.

## Non-negotiables

- **Local-first.** Client data, recordings and files stay on the user's computer. There are no accounts, no hosted services and nothing that costs money to run.
- **AI is optional.** Everything works with AI off. Local models (Ollama) are the default; the user's own API key is an option.
- **API keys never reach** the browser, the repo, project files or logs. Keys live with the local server only (see `server/ai/`).
- **No recording without consent.** A session's consent record must exist before recording, audio import or transcript import (importing or pasting one), and must allow it (`docs/spec/CONSENT.md` once written).
- **Never commit real client data** or recordings of real people. Test data is role-played. Audio files are git-ignored (`.gitignore`).
- **Companies' data never mix.** Nothing in one company's workspace may reference another's.
- **Deterministic where it matters.** Costs, compatibility and constraint checks are code over sourced, dated data. The AI never supplies a price, and never marks something as verified.
- **Status and provenance on every finding.** Never blur "AI-suggested" with "confirmed", or "assumption" with "said by the client".
- **AI changes are proposals.** The user accepts or rejects them, and each one is undoable.
- **No mock functionality** and no placeholder controls. If a feature isn't ready, it isn't shown.

## Commands

```bash
npm install                      # first time
npx playwright install chromium  # first time, for browser tests
npm run dev                      # http://localhost:5173 (includes the local AI server)
npm run typecheck                # app + browser tests
npm test                         # unit tests (Vitest)
npm run test:e2e                 # browser tests (Playwright, own dev server on 5174)
npm run test:all                 # unit tests, then browser tests
npm run build                    # type-check + production build
npm run format                   # Prettier on everything except Markdown
npm run format:check             # what CI checks
npm run demos                    # re-record docs/media GIFs (needs ffmpeg)
npm run site                     # documentation site into site/
npm run build:pages              # app at site/app/ plus the site, as GitHub Pages publishes it
```

Node 22.12 or newer is required. The user works on **Windows**, so keep npm scripts and tooling cross-platform (no bash-only scripts).

## Code map

| Folder | What lives there |
| --- | --- |
| `src/model` | Design document, property registry, invertible operations, layout engine (flex + grid), file format. Pure TypeScript, no React/DOM. |
| `src/editor` | Editor store, history, gestures, camera, React bindings. |
| `src/canvas`, `src/panels`, `src/app`, `src/ui` | The editor UI. |
| `src/render` | The one design → CSS mapping shared by canvas and code export. |
| `src/codegen` | HTML/CSS/React generators, CSS parser, exports. Pure. |
| `src/ai` | Assistant: context, prompt, schema from the registry, interpreting replies as proposals. |
| `src/persistence` | IndexedDB storage, images, project files. |
| `server/ai` | Local AI server (Vite plugin): settings, keys, providers. Node only. |
| `src/workspace` | (new) The consulting workspace: domain model first. |
| `e2e`, `e2e/demos` | Browser tests; demo recordings. |
| `scripts` | The documentation site builder and its Markdown renderer. |
| `.github` | CI (Linux: format, typecheck, unit, build, browser tests; Windows: typecheck, unit, build), the Pages deploy, issue and PR templates. |
| `docs` | Vision, guide, architecture, roadmap, decisions (`docs/decisions/`), specs (`docs/spec/`), research (`docs/research/`), phase briefs and handovers. |

`docs/ARCHITECTURE.md` explains the editor's design and the reasons behind it. Read the relevant section before changing an area.

## Conventions

- TypeScript is strict. Run `npm run format` (Prettier, `.prettierrc.json`) before committing; CI runs `npm run format:check`. Markdown is excluded (`.prettierignore`).
- `model` and `codegen` stay pure: no React, no DOM.
  - Every design-document change goes through `applyOps`.
  - New layer properties go through the registry in `src/model/properties.ts`.
- The workspace domain model follows the same style: plain data, validated, versioned, tested.
- Tests:
  - Unit tests sit next to the code (`*.test.ts`).
  - Anything a user does gets a browser test in `e2e/`.
  - Layout changes keep `e2e/layout-parity.spec.ts` green.
  - New UI passes `e2e/accessibility.spec.ts` and works from the keyboard.
- Performance budgets live in `src/model/performance.test.ts`. Don't loosen them to make a change pass.
- Interface text is plain English: short, specific, no exclamation marks. Colours and spacing come from the tokens in `src/styles/app.css`, and text meets WCAG AA contrast.
- Ask before adding a runtime dependency. Experiments go under `spikes/` with their own dependencies, and `src/` never imports them.

## How to work

- **Plan first.** For anything non-trivial, show the plan and wait for the user's go-ahead. Follow the current phase brief; stop at its check-ins.
- **Branch per phase or slice.** Make small, clear commits and open a PR at the end. Never push to `main` or merge without the user.
- **Keep everything green.** Before calling something done, run `npm run typecheck`, `npm test` and `npm run test:e2e`.
- **Record decisions as ADRs** in `docs/decisions/` (template there). Don't reopen an accepted ADR without asking.
- **Don't invent product behaviour.** If the vision, spec or user hasn't decided something, ask, offering options and a recommendation.
- **Research cites sources** (link and date). Performance is measured on the user's machine, not quoted from elsewhere.
- **End of a phase:**
  1. Run an independent review subagent over the work.
  2. Fix what it finds.
  3. Write `docs/phase-N/HANDOVER.md`.
  4. Update the README, guide and roadmap if users would notice the change.
