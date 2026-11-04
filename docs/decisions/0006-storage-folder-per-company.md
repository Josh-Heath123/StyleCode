# ADR-0006: Storage: a workspace folder, one folder and one JSON file per company

- **Status:** Proposed
- **Date:** 2026-11-04

## Context

ADR-0002 requires that client data stays on the computer and that each company's data can be backed up, exported or deleted as a unit. The domain model (`docs/spec/DOMAIN-MODEL.md`) is one validated `CompanyWorkspace` value per company; a workspace with problems is never saved and opens read-only. The Phase 0 brief asks to evaluate a workspace folder managed by the local server, with SQLite for records and search, checking `node:sqlite` against a library.

Measured on the user's laptop (Windows 11 Home, Node 22.15.0, 2026-11-04):

- `node:sqlite` loads without a flag but prints an `ExperimentalWarning`; it became a release candidate only in Node 25.7 ([Node.js docs, SQLite](https://nodejs.org/api/sqlite.html), checked 2026-11-04).
- Its bundled SQLite (3.49.1) has **no full-text search**: FTS5, FTS4 and FTS3 all fail with "no such module". Others report the same for Node's Windows build ([skilld #64](https://github.com/skilld-dev/skilld/issues/64), checked 2026-11-04).
- A JSON workspace of 60 one-hour meetings (54,000 segments, 2,400 findings, 12.7 MB): save 57 ms, load and validate 186 ms, substring search over every segment 22 ms. At 200 meetings (42.8 MB): save 226 ms, load 1.06 s, search 143 ms.

## Decision

- A workspace folder, `StyleCode` in the user's home folder by default, or `STYLECODE_WORKSPACE`. Created readable only by the user.
- `companies/<company id>/` per company, holding `workspace.json` (the `CompanyWorkspace`), `workspace.previous.json` (the last good copy), `files/<file id>` and `designs/<document id>.stylecode.json`.
- Saves are one at a time, written to a temporary file and renamed into place. A workspace with problems is refused (`checkBeforeSave`). Each save names the revision it is based on and is refused if the file has moved on.
- Files are stored by id, never by a name from the browser. Audio is never inside `workspace.json`.
- Search is in memory over the open workspace, by substring, until a measured need says otherwise.
- No SQLite for now. A new ADR revisits it when a real workspace takes over a second to load, search needs ranking, or `node:sqlite` is stable with FTS5 on Windows.

## Options considered

- **One JSON file per company (chosen).** For: matches the domain model exactly; no dependency; fast enough at measured sizes; readable without StyleCode; a company is one folder to back up or delete. Against: each save rewrites the whole file (57 ms at 12.7 MB); no indexed search; very large companies would load slowly.
- **SQLite through `node:sqlite`.** For: no dependency; incremental writes; queries. Against: experimental on our supported Node versions; no FTS5 on the user's Windows build, which removes the main reason to use it; a second representation of the model to keep in step with validation.
- **SQLite through `better-sqlite3`.** For: stable, with FTS5. Against: a native runtime dependency (needs the user's approval, and prebuilt binaries per Node version and platform); the same second representation.
- **IndexedDB in the browser, as the editor does.** Against: data tied to one browser profile, hard to back up or delete per company, and clearing site data loses everything. Not suitable for client records.

## Consequences

- Phase 1 builds `server/workspace/`: list companies, read and save a workspace, add and read files, delete a company's folder.
- `src/workspace/model/performance.test.ts` guards load and validation times.
- The editor's IndexedDB storage is unchanged (ADR-0007).
- Backups are a folder copy; the guide says so.
