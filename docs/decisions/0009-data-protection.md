# ADR-0009: Data protection: operating-system disk encryption now, no app-level encryption yet

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

The workspace folder (ADR-0006) holds clients' confidential information and, later, recordings. Everything stays on one computer (ADR-0002). The user's laptop runs Windows 11 Home.

## Decision

- StyleCode recommends turning on the operating system's disk encryption, in the guide and in the app's workspace settings: Device encryption on Windows 11 Home where the hardware supports it, or BitLocker on Pro, Enterprise and Education ([Microsoft, Device encryption in Windows](https://support.microsoft.com/en-us/windows/device-encryption-in-windows-cf7e2b6f-3e70-4882-9532-18633605b7df), checked 2026-11-04); FileVault on macOS; LUKS on Linux.
- No app-level encryption for now.
- On macOS and Linux the workspace folder is readable only by the user. On Windows, Node can't set that, so it relies on the home folder's default permissions (ADR-0006).
- The app warns if the workspace folder is inside a cloud-synced folder (OneDrive, Dropbox, Google Drive), because syncing sends client data off the computer, which ADR-0002 rules out.
- Deleting a company deletes its folder. Logs never contain client data.

## Options considered

- **OS disk encryption, with guidance (chosen).** For: protects a lost or stolen laptop, costs nothing, no passphrase for StyleCode to lose. Against: StyleCode can't enforce it, and it doesn't protect against other software running as the user.
- **App-level encryption now** (a passphrase-derived key for each workspace). For: protects data even without disk encryption, and in copied backups. Against: a forgotten passphrase loses every client's data; search and backups get harder; it adds little against software running as the user, which can read the page.

## Consequences

- When data starts to leave the computer (exporting to share, backups to a cloud folder, or sync, which is out of scope), a new ADR decides on app-level encryption.
- The guide gets a short "Protecting client data" section in Phase 1.
