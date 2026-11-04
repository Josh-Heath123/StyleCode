# Decision records

Each architecture decision record (ADR) states one decision, why it was made and what follows from it. Copy `TEMPLATE.md` to start one, numbered in order.

An ADR is **Proposed** until the user accepts it. Accepted ADRs aren't reopened without asking the user. To change one, write a new ADR that supersedes it, and mark the old one "Superseded by ADR-NNNN".

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-workspace-in-stylecode-repo.md) | Build the workspace in the StyleCode repo | Accepted |
| [0002](0002-local-first.md) | Local-first: data, recordings and files stay on the consultant's computer | Accepted |
| [0003](0003-consent-before-recording.md) | Consent is recorded before any recording | Accepted |
| [0004](0004-deterministic-engines.md) | Deterministic engines for cost, compatibility and constraints; AI proposes and explains | Accepted |
| [0005](0005-runtime-browser-and-local-server.md) | Runtime: the browser plus a local Node server, started with one command | Proposed |
| [0006](0006-storage-folder-per-company.md) | Storage: a workspace folder, one folder and one JSON file per company | Proposed |
| [0007](0007-editor-projects-and-engagement-designs.md) | Editor projects stay in IndexedDB; engagement designs are copied into the company | Proposed |
| [0008](0008-local-api-security.md) | The workspace API has the AI server's protections, plus file-safety rules | Proposed |
| [0009](0009-data-protection.md) | OS disk encryption now; no app-level encryption yet | Proposed |
