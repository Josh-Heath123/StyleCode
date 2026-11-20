# Notes for the Workspace Phase 5 brief

Started on 19 November 2026, during the repository follow-ups (pull request #27), and added to by Phase 4's Slice C docs work. These are questions the Phase 5 brief inherits. None of them is decided; each needs the user, or the reviewer on the user's behalf.

## Creating a client reads every client's file

`WorkspaceStore.create` (`server/workspace/store.ts`) refuses a name another client already has, ignoring case (MVP Q4). To know the names, it lists every client: it reads and fully validates each client's `workspace.json`. And it does so inside one queue shared by every create, so creates run one at a time, each waiting for the ones before it.

Measured on the laptop (Windows), 19 November 2026:
- **The test folder:** after a full local browser-test run it held 134 clients, 714 KB of `workspace.json` in all (the largest 38 KB).
- **One listing:** with the laptop otherwise idle, listing those 134 clients took 158 ms, then 128 and 109 ms (three runs, from a Node script calling `list()`).
- **Under load:** during a full local run, with the browser workers creating clients at once (and other work on the laptop at the same time), one create took 4,775 ms (the server's wait, from the trace). In a second run, with nothing else running, a create hadn't answered when `workspace.spec.ts:20` gave up at 7.7 s.
- **What fails:** `workspace.spec.ts:20` ("StyleCode opens on the clients list, and a new client opens on its own page") expects the new client's page within 5 s of Add client. It failed in two of the three full local runs on 19 November. It passes on CI, where each runner's folder holds fewer clients.

A consultant with tens of clients won't notice. The browser tests create hundreds in one folder, and a consultant who keeps a client folder for every engagement over years would hold hundreds too.

*Options, for the brief:* keep the names in memory, read once and updated by each create, rename and delete in the same queue; or read only each file's company name, not the whole file. Either keeps the case-insensitive check as it is. No product code changed for it yet.

## The dev server that stopped once

During one local full run on 19 November, the browser tests' dev server stopped answering at 14:41:06 (local time) for the rest of the run: every request after one `/api/ai/chat` was refused, on both `::1` and `127.0.0.1`. Its output (Playwright's `[WebServer]` lines, stderr only then) shows no error and no stack.

- **What it wasn't:** rewriting the files edited at that moment, against a second dev server, changed nothing. It didn't happen in the two quiet full runs that followed.
- **What could stop it without a word:** the data folder lock's signal handlers (`server/workspace/folder.ts`) release the lock and call `process.exit` on SIGINT, SIGTERM, SIGHUP or SIGBREAK, and print nothing. Whether a console event reached it is unknown.
- *If it happens again:* CI now keeps the dev server's stdout in the log (pull request #27); a local run can show it with `DEBUG=pw:webserver`. A line from those handlers saying which signal arrived would answer it.

## Flakes to watch

Seen once each, not yet explained. None is retried or skipped; each fails its run if it comes back.

- **`e2e/retention.spec.ts:224`, a 500 adding a WAV (20 November 2026, a local Windows run of presentation WP7).** "A read-only client's recording past its time is listed, but left alone by the delete action" failed in `withRecordings` (`retention.spec.ts:56`): `POST …/added-recordings` answered 500 instead of 201, for a client created moments before. The server's log shows `ENOENT: no such file or directory, open '…\companies\co_…\files\fi_….tmp'`, from `RecordingStore.addWav` (`server/workspace/recordings.ts:257-268`), which opens its temporary file with `wx` and, unlike `WorkspaceStore.addFile`, doesn't make `files/` first; `files/` is made when the client is created (`server/workspace/store.ts:263`), so it should have been there. The branch then changed nothing in `server/` or that test, and the next full run passed (202 of 202). *If it comes back:* list the company folder at the moment of failure, and check whether anything removed or renamed `files/` (antivirus, the indexer, or a delete of another client in the same run).
- **A unit test, name not recorded (20 November 2026, presentation WP7).** One `npm test` run reported 1 failed of 863, during work on `scripts/readme.ts`; the run's output wasn't kept, so which test is unknown. Ten runs of `npx vitest run` in a row afterwards (on `workspace-4c-ai-context`, from `e9a26b2`) all passed, 862 with 1 skipped. *If it comes back:* keep the whole output, and note what else the laptop was running.
