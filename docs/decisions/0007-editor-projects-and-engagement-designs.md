# ADR-0007: Existing editor projects and engagement designs coexist; designs are copied into the company

- **Status:** Proposed
- **Date:** 2026-11-04

## Context

StyleCode's editor stores projects in the browser's IndexedDB (`docs/ARCHITECTURE.md` §7). An engagement links to designs (`DesignLink`, `docs/spec/DOMAIN-MODEL.md`), and the user's review of the domain model requires that a design belongs to one company and is stored inside that company's data. The MVP opens the canvas from an engagement, without it being informed by the record yet.

## Decision

- Standalone editor projects stay in IndexedDB, unchanged.
- An engagement's design is stored in its company's folder (`designs/<document id>.stylecode.json`, ADR-0006).
- Attaching a design to an engagement either creates a new one or copies an existing project into the company with a new document id. The original project is untouched.
- Opening an engagement's design loads and saves it through the workspace API, via a second persistence adapter in the editor.
- Nothing is migrated automatically.

## Options considered

- **Coexist, and copy into the company (chosen).** For: no risk to existing work; a design can't be shared between companies; the company's folder is complete. Against: two places designs live; a copied design no longer follows its original.
- **Link to the IndexedDB project.** For: no copy. Against: the design isn't in the company's data, so backing up, exporting or deleting a company misses it, and one project could be linked from two companies.
- **Migrate every project to disk.** For: one place for everything. Against: forces a change on users of the editor alone, and touches work that has nothing to do with clients.

## Consequences

- The editor gets a persistence interface with two implementations (IndexedDB and workspace API). It is built when the canvas is opened from an engagement (Phase 1, or later if that link waits).
- Validation already reports a design document linked from two companies (`sharedIds`).
