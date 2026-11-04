# ADR-0002: Local-first; data, recordings and files stay on the consultant's computer

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

A consultant's workspace holds clients' business information, meeting transcripts and, later, audio recordings (vision §2, §3, §8). That is confidential material belonging to people other than the user. StyleCode is already local-first: projects are stored in the browser's IndexedDB, there are no accounts, and AI runs through a local server with Ollama as the default and the user's own API key as an option (`docs/ARCHITECTURE.md` §7 and §8).

The user decided this before Phase 0 (Phase 0 brief, "Decisions already made", 2), and it is a non-negotiable in `CLAUDE.md`.

## Decision

- Client data, transcripts, recordings and files are stored only on the consultant's computer.
- There are no accounts, no hosted services run for the product, and nothing that costs money to run.
- AI is optional. Everything works with AI off. Local models (Ollama) are the default. An external provider is used only if the consultant configures one with their own API key, and only for sessions whose consent allows it (ADR-0003).
- API keys stay with the local server and never reach the browser, the repository, project files or logs (as today, `server/ai/`).
- Each company's data is kept separate, so it can be backed up, exported or deleted as a unit and never references another company's data.

## Options considered

- **Local-first (chosen).** Confidential data never leaves the machine unless the consultant chooses an external AI provider for a session that allows it. No running costs and no service to operate. Against: no sync between devices, no sharing with colleagues, and backups are the consultant's responsibility.
- **Hosted service with accounts.** Sync, sharing and access from anywhere. Against: running costs, operating and securing a service, and holding clients' confidential data on third-party servers. Contradicts the vision's zero-cost, consultant-owned setup.
- **Local-first with optional sync** (for example through a folder the user already syncs). Keeps data local by default. Against: conflict handling and partial-sync states add a lot of complexity before the core workflow exists. Sync between devices is out of scope for the first version; it can be revisited in a later ADR.

## Consequences

- Where records, transcripts, audio and files live on disk, and in what format, is decided in WP4 (storage). The brief's starting point is one folder per company, managed by the local server.
- Protecting data at rest relies, at first, on the operating system's disk encryption. WP4 decides whether app-level encryption is needed now or later.
- The local server becomes responsible for more than AI settings, so its protections (loopback only, origin and header checks) apply to every new endpoint (WP4, local API security).
- Export and delete-by-company are part of the design from the start, not added later.
- Features that need a hosted service (accounts, live sharing, cloud transcription) are out of scope unless a later ADR changes this one.
