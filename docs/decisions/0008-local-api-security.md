# ADR-0008: The local workspace API has the AI server's protections, plus file-safety rules

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

The workspace API (ADR-0005) reads and writes clients' data on disk. Any web page the consultant visits can send requests to `localhost`, and a DNS-rebinding site can make its own name resolve there. `/api/ai` already defends against this (`docs/ARCHITECTURE.md` §8, `server/ai/handler.ts`).

## Decision

Every workspace route checks, on every request:

- the connection comes from a loopback address, even if the server was started with `--host`;
- `Host` is `localhost`, `127.0.0.1` or `[::1]`;
- any `Origin` is exactly this server;
- `Sec-Fetch-Site`, when present, is `same-origin` or `none`;
- a StyleCode request header is present.

The server refuses to start if the workspace folder is inside this repo or inside any git repository (a `.git` folder in it or any folder above it), so client data can never be committed. Real client work uses the built app (`npm start`), not `npm run dev`, and the guide says so.

These checks move from `server/ai/handler.ts` into one shared module used by both APIs, with one set of tests. Because these routes touch the disk, also:

- every id is checked with `isValidId` before it becomes part of a path, and names from the browser are never used as paths;
- request bodies have a size limit, and are JSON except for file uploads;
- stored files are returned with `X-Content-Type-Options: nosniff` and as downloads;
- no CORS headers are sent.

## Options considered

- **Same checks plus file-safety rules (chosen).** For: proven on `/api/ai`, no secrets to manage. Against: relies on browsers sending `Origin` and `Sec-Fetch-Site` as they do today.
- **Add a per-session token** handed to the page at start-up. For: defence in depth if a header check is ever bypassed. Against: more moving parts; the current checks already stop cross-site and rebinding requests. Can be added later without changing the API.

## Consequences

- Phase 1 refactors the request checks into a shared module before adding workspace routes.
- Browser tests cover a request from another origin and a path with an invalid id; unit tests cover a workspace folder inside a git repository.
- The guide tells consultants to use `npm start` for client work.
