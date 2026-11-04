# ADR-0005: Runtime: the browser plus a local Node server

- **Status:** Proposed
- **Date:** 2026-11-04

## Context

The workspace needs file-system access (records, documents, later audio), the microphone (Phase 3), an easy install on Windows, zero running cost, and as much reuse of the current code as possible. Today StyleCode is a browser app with a local Node server for AI, mounted as a Vite plugin on the dev and preview servers (`docs/ARCHITECTURE.md` §8). Node 22.12 or newer is already required. The Phase 0 brief asks to evaluate this shape first.

## Decision

- The workspace runs as today's app does: a page on `http://localhost` and a local Node server, started with one command.
- The workspace API is a Vite plugin next to `server/ai`, mounted on the dev and preview servers.
- Packaging as a desktop app is not done now; the server stays plain Node so that it remains possible.

## Options considered

- **Browser plus local Node server (chosen).** For: reuses all the code; `localhost` is a secure context, so `getUserMedia` works without HTTPS ([MDN, Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts), checked 2026-11-04); the server handles files, so no browser-specific file API is needed; nothing to sign or pay for. Against: needs Node and a terminal command; a closed tab isn't a closed app; the server must guard its routes against other pages (ADR-0008).
- **Electron.** For: a real desktop app with an installer, and its main process is Node, so the server code would carry over. Against: ships Chromium and Node in every install ([Electron, Security](https://www.electronjs.org/docs/latest/tutorial/security), checked 2026-11-04); an installer to build and keep up to date; a second way to run the app to test.
- **Tauri.** For: small installers using the system WebView2. Against: development needs Rust and the MSVC build tools ([Tauri, Prerequisites](https://v2.tauri.app/start/prerequisites/), checked 2026-11-04); the server logic would be rewritten in Rust or run as a Node sidecar; a different web engine to test against.

## Consequences

- Phase 1 adds `server/workspace/` as a Vite plugin, and a one-command start (for example `npm start`: build, then serve with the plugins).
- The guide explains how to start StyleCode and that closing the terminal stops it.
- Request checks are shared between the AI and workspace routes (ADR-0008).
- If installing Node turns out to be a real barrier for users, a new ADR considers Electron, reusing the Node server.
