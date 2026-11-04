# ADR-0001: Build the workspace in the StyleCode repo

- **Status:** Proposed
- **Date:** 2026-11-04

## Context

StyleCode is a working local-first UI editor (v0.5.0, Phases 1–5 complete), with a canvas, auto layout, code generation and AI proposals through a local server (`server/ai/`). The product vision (`docs/vision/PRODUCT-VISION.md`) turns it into an AI-assisted consulting workspace, in which designing the interface during a consultation (vision §4) is one activity among several. The vision also requires that "the original ability to translate sketches into structured frontend code should remain part of this overall workflow".

The user decided this before Phase 0 (Phase 0 brief, "Decisions already made", 1).

## Decision

The consulting workspace is built in this repository. The StyleCode editor keeps working, with its tests green, and becomes one module of the product: the place where an engagement's interface is designed.

New workspace code lives in its own folders (starting with `src/workspace/`), following the same conventions as the editor's model: plain data, validated, versioned, tested.

## Options considered

- **Same repository, editor as a module (chosen).** Reuses the editor, the local AI server, the test and CI setup, and the documentation site as they are. One install, one dev server, one set of conventions. Against: the repository and app grow beyond what the name StyleCode describes, and the boundary between editor and workspace has to be kept deliberately.
- **New repository, with the editor as a dependency.** A clean start for the workspace. Against: the editor would have to be packaged and versioned first, changes that span both need two pull requests, and the AI server and test setup would be duplicated.
- **Monorepo with separate packages** (for example npm workspaces). Enforces the boundary through package dependencies. Against: restructures a working project before there is any workspace code to separate, and adds tooling the project doesn't need yet. It stays possible later if the boundary proves hard to keep.

## Consequences

- `npm run typecheck`, `npm test` and `npm run test:e2e` cover both the editor and the workspace, and must stay green after every change.
- The editor's design-document code (`src/model`, `src/codegen`) must not come to depend on workspace code. The workspace links to editor documents; the editor doesn't know about companies or engagements.
- How the app shell hosts both, and how existing StyleCode projects relate to engagements, are decided in WP4 (runtime, storage, existing projects).
- The README, guide and site describe StyleCode as an editor today. They are updated once workspace features reach users, not before.
- Whether the product keeps the name StyleCode is not decided here.
