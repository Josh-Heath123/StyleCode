# Repository: merges you can trust, fast checks, and ownership papers

> **For Claude Code.** Read these first:
> - `CLAUDE.md`;
> - this brief;
> - `.github/workflows/ci.yml` and `pages.yml`;
> - `playwright.config.ts`;
> - `LICENSE`, `CONTRIBUTING.md` and `README.md`.
>
> This work comes **before Workspace Phase 4's Slice C**. It goes on one branch, `repository-trust`, with one pull request. At every **⏸ Check-in**, stop, report and wait.

## Why

The owner merges a pull request when GitHub's checks are green. So green has to mean, as far as a machine can tell, what the reviewer's check means, and it has to arrive quickly. The repository should also say plainly who owns StyleCode and how it was made, in documents a lawyer would recognise.

**Owner of record: Joshua Heath** (GitHub account `Josh-Heath123`), confirmed by the owner on 18 November 2026.
- `LICENSE`'s first line becomes `Copyright (c) 2026 Joshua Heath`. The first commit is dated 17 February 2026.
- Never put an email address in any file, commit or setting this work creates.

## How decisions were made

The reviewer made these decisions on the owner's behalf on 18 November 2026. Raise any that look wrong at the WP0 check-in; after that, don't reopen them. The owner can overrule any of them.

## Decisions

### A. What a merge must pass

R1. **A ruleset on `main`.** Rulesets are available for public repositories on GitHub Free ([GitHub docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)). The ruleset:
- requires a pull request, with **0 approvals**, because GitHub doesn't let the owner approve his own pull requests;
- requires the status checks of decisions R2 to R5 and R8 to pass, with the branch up to date with `main`;
- blocks force pushes and deleting `main`;
- requires signed commits (R10);
- lets **nobody bypass it, the owner included**.

It is kept in the repository as `.github/rulesets/main.json`. You apply it with `gh api` only after the owner says yes at the WP3 check-in, once the check names exist on `main` (WP4). There's no merge queue: one pull request at a time doesn't need one.

R2. **A flaky test fails the run.** CI keeps one retry, so a test that passes the second time is still reported as flaky, but the run fails: `failOnFlakyTests` on CI (Playwright 1.52 or later; this repository has 1.63, [Playwright docs](https://playwright.dev/docs/api/class-testconfig)). Today a retry can turn a race into a green tick, as the keyboard-only test did on #22.

R3. **A hygiene check** (`scripts/check-hygiene.ts`, run with Node's type stripping like the other scripts, no new dependency). It runs on every pull request against its base and fails on any of these:
- audio, video or archive files;
- any file over a size limit, set just above the largest tracked file today, with any existing exceptions listed by path;
- user folder paths: `X:\Users\…`, `/Users/…` and `/home/…`, in files or in commit messages;
- email addresses, apart from GitHub's `noreply` ones;
- likely secrets: API key prefixes such as `sk-`, `sk-ant-`, `ghp_`, `github_pat_` and `AKIA`, and private key headers;
- `.env` files;
- an action that isn't pinned to a full commit SHA.

Its own tests use made-up examples. The check contains no real user name.

R4. **Dependencies.**
- GitHub's dependency review action (pinned) fails a pull request that adds a dependency with a known vulnerability.
- The hygiene check also fails when `dependencies` in `package.json` gains an entry, unless the pull request carries the label `dependency-approved`, which only the owner adds. This puts `CLAUDE.md`'s rule, "ask before adding a runtime dependency", into the checks. The workflow reruns when labels change.

R5. **Licence and copyright on every file** (R18): `reuse lint` in CI, installed in the job, not in `package.json`.

R6. **CodeQL** code scanning in GitHub's default setup (a repository setting, no workflow file). It is **not** a required check, because it can take longer than the tests. Its alerts show in the Security tab, and you check them at each slice's end.

R7. **Windows browser tests run nightly on `main`, and on demand,** not on every pull request. The owner works on Windows, and Phase 3's Windows-only issues (letter case, the skipped signal test) show it matters. A full Windows browser run would double each merge's wait. Typecheck, unit tests and the build stay required on Windows for every pull request.

### B. As fast as possible

R8. **Target: every required check done in under 4 minutes** (median of 5 runs) on a typical pull request, running every test that runs today, with **no flakes in 10 consecutive runs**. Today the Linux job takes about 6 minutes, everything in one job, one step after another. How:
- **Parallel jobs:** quick checks (format, typecheck, hygiene, REUSE, dependency review), unit tests, the build, and the browser tests run at the same time.
- **Browser tests split across runners** (Playwright's `--shard`, with the reports merged), as many shards as the measurements say pay off.
- **No Chromium download and system packages on every run:** use the official Playwright container for the matching version, pinned by digest, or a cache keyed on the Playwright version, whichever measures faster.
- **The destructive tests** (`retention`, `settings`: the "after the rest" project) **in their own job with their own workspace folder.** They run last today only because they share the folder; with a folder of their own they can run alongside the rest. Locally, `npm run test:e2e` keeps today's order.
- Measure the current layout (the last 10 runs, from `gh run list`) and the new one (5 runs), and report both.

R9. **Docs-only changes skip the browser tests** through a job-level condition fed by a small "what changed" job, **never a workflow-level path filter**. A path filter leaves required checks waiting forever; a job skipped by its condition counts as passed. "Docs-only" means Markdown under `docs/`, plus `README.md`. Anything else runs everything.

### C. Proving where each change came from

R10. **Signed commits and tags.**
- Make an SSH key used only for signing on the laptop, and set `gpg.format ssh`, `user.signingkey`, `commit.gpgsign true` and `tag.gpgsign true` **in this repository's config only**.
- Add the public key to GitHub as a **signing key** with `gh ssh-key add --type signing`. If `gh` lacks the `admin:ssh_signing_key` scope, `gh auth refresh -s admin:ssh_signing_key` opens the browser for the owner to approve.
- Every commit on `repository-trust` is signed from its first commit. GitHub signs the merge commits it makes.
- History isn't rewritten: older commits stay as they are.

R11. **Least privilege in the workflows.** `permissions: contents: read` at the top, and anything more only in the job that needs it (Pages). No secrets are used by pull request workflows. Every action stays pinned to a full commit SHA with its release in a comment, and a container image is pinned by digest.

R12. **The repository's security settings:**
- secret scanning with push protection;
- Dependabot alerts and Dependabot security updates (no version-update pull requests: they'd be noise);
- private vulnerability reporting, so `SECURITY.md` needs no email address;
- CodeQL's default setup (R6).

You turn these on with `gh api` in WP4, after the owner's yes at the WP3 check-in, and read each one back to confirm it.

### D. Ownership papers

These are factual records, not legal advice, and they're written so the owner can confirm every sentence. Where the law is cited, cite it with link and date in the documents' own **Sources** list.

R13. **`COPYRIGHT.md`:**
- "Copyright © 2026 Joshua Heath. All rights reserved, except as the PolyForm Strict License 1.0.0 in `LICENSE` allows."
- What the licence permits in one sentence (noncommercial use only; no changes, no redistribution), linking to `LICENSE`.
- Third-party parts keep their own licences (R19).

R14. **`docs/legal/AUTHORSHIP.md`: how StyleCode is made, and who controls it.** Facts only:
- **What the owner decided:** the product, its direction, every phase brief's decisions (accepted or overruled at check-ins), and every merge.
- **Where the record is kept:** `docs/vision/`, `docs/decisions/` (ADRs), `docs/phase-*/` (briefs and handovers), and the git history with its pull requests. All are dated, and from now on signed (R10).
- **AI tools used under the owner's direction:** Claude Code writes code and documents to the briefs. A Claude chat acts as reviewer, writing briefs for the owner to accept. Anthropic's Consumer Terms assign to the user "all our right, title, and interest (if any) in Outputs" ([Anthropic](https://www.anthropic.com/legal/consumer-terms)). Say plainly that the "(if any)" leaves open how far AI output is protected.
- **The law it rests on:**
  - Under South Africa's Copyright Act 98 of 1978, the author of a computer program is "the person who exercised control over the making of the computer program", and copyright first vests in the author (s 1, s 21(1)(a); *King v South African Weather Service* [2008] ZASCA 143). The courts have held that the person in control needn't be a programmer.
  - Under US law, protection depends on human authorship, and prompts alone aren't enough (US Copyright Office, *Copyright and Artificial Intelligence, Part 2*, 29 January 2025).
  - Write both as statements of the sources, not conclusions.
- **Third-party code and data:** only the listed dependencies (R19). Test data and test voices are synthetic or role-played.

The owner confirms the whole text at the WP3 check-in. Don't claim that anyone other than the owner directed the work, and don't leave out the AI tools.

R15. **`CONTRIBUTING.md` gains one paragraph:** outside contributions aren't accepted, and if one ever is, only after the contributor signs a written assignment or licence of their rights to the owner.

R16. **`SECURITY.md`:** report a vulnerability privately through GitHub's private vulnerability reporting (R12). It names no email address.

R17. **`TRADEMARKS.md`:** the name "StyleCode" and its logo belong to the owner. The licence covers copyright and patents and gives no right to use the name or logo.

R18. **REUSE** ([REUSE Specification 3.3](https://reuse.software/spec-3.3/)):
- **A `REUSE.toml` at the root:** every file is `SPDX-FileCopyrightText = "2026 Joshua Heath"`, except files that belong to someone else, which say so.
- **The licence identifier:** PolyForm Strict isn't on the SPDX licence list (PolyForm Noncommercial and Small Business are), so the identifier is `LicenseRef-PolyForm-Strict-1.0.0`.
- **A copy of its text** goes in `LICENSES/LicenseRef-PolyForm-Strict-1.0.0.txt`, identical to `LICENSE` below its copyright line.
- **No per-file headers:** the TOML covers every file without touching it.

R19. **`THIRD-PARTY-NOTICES.md`, generated by a script:**
- the runtime dependencies from `package-lock.json`: React and React DOM, and the Inter font, each with its licence;
- what `npm run transcription:setup` downloads, from its manifest: whisper.cpp, sherpa-onnx and each model, each with its licence.

A check in CI fails if the file is out of date.

R20. **Small markers:**
- **`package.json`:** `"author": "Joshua Heath"`, with `"license"` left as it is.
- **The README:** an "Ownership and licence" section linking R13 to R18.
- **`.github/CODEOWNERS`:** `* @Josh-Heath123`.
- **`CLAUDE.md`:** the new rules (signed commits, the checks, the owner of record, no email addresses).

R21. **A dated public record at each phase's end:**
- a signed tag (for example `v0.6.0` at the end of Workspace Phase 4) with a GitHub release;
- a [Software Heritage "Save code now"](https://archive.softwareheritage.org/save/) request for the repository, which keeps an independent, dated copy of its whole history.

This work does the first "Save code now" in WP4. The first signed tag waits for Phase 4's end.

### E. The reviewer

R22. **The owner merges on green.** The reviewer reviews each merged slice on a clean copy right after the merge, and any fixes go first in the next slice. A phase isn't closed until the reviewer has reviewed it. The owner can still bring a pull request to the reviewer before merging.

## Work packages

### WP0: Start

1. Update `main` (at `5e4671e` or later), create `repository-trust`, and run every check.
2. Set up signing first (R10), so that every commit on the branch is signed. Commit this brief as `docs/repository/REPOSITORY-BRIEF.md`, as the first, signed commit.
3. Read the last 10 CI runs' times with `gh run list` / `gh run view` (per job and per step).
4. Write your plan for the jobs and shards (R8, R9).

⏸ **Check-in:**
- today's timings;
- the planned jobs, and how the destructive tests get their own folder;
- the signing key's fingerprint, and that GitHub shows the first commit as "Verified";
- any decision that looks wrong.

### WP1: Fast, strict CI (R2 to R9, R11)

- The new workflow layout, the hygiene check with its tests, dependency review, `reuse lint`, `failOnFlakyTests`, and the nightly Windows browser run.
- Add `workflow_dispatch` so the CI workflow can be rerun on the branch.
- Measure 5 runs for time and 10 for flakes. If the 4-minute target can't be met, report the best you got and why.

### WP2: Ownership papers (R13 to R20)

The documents, `REUSE.toml` and `LICENSES/`, the notices generator with its CI check, and the small markers. `LICENSE`'s first line names Joshua Heath.

### WP3: Review and pull request

1. Run an independent review subagent over the branch: the checks really fail on what they should (give them bad examples), nothing in R3's list slips through, the papers match the facts in the repository, and no email address or user path appears anywhere.
2. Fix what it finds, push, and open the pull request.

⏸ **Check-in:**
- the pull request link and its CI result;
- the timings before and after;
- the flake count from 10 runs;
- `.github/rulesets/main.json` as it will be applied;
- the list of R12's settings;
- `docs/legal/AUTHORSHIP.md` for the owner to confirm, sentence by sentence.

Wait for the owner's yes and the merge.

### WP4: Switch it on

1. After the merge, apply the ruleset and R12's settings with `gh api`.
2. Read each one back.
3. Send the Software Heritage "Save code now" request.

⏸ **Check-in:** what is now on, each read back, and the Software Heritage request's status. Then Workspace Phase 4's Slice C starts on its own branch, with every commit signed.

## Definition of done

- [ ] Every commit on the branch signed and shown as "Verified"
- [ ] Required checks under 4 minutes (median of 5), every test that runs today still running, no flakes in 10 runs; or the best achieved, with the reason
- [ ] The hygiene check, dependency review, REUSE and the notices check fail on bad examples and pass on the branch
- [ ] Windows browser tests running nightly on `main`
- [ ] `COPYRIGHT.md`, `docs/legal/AUTHORSHIP.md` (confirmed by the owner), `CONTRIBUTING.md`, `SECURITY.md`, `TRADEMARKS.md`, `REUSE.toml` with `LICENSES/`, `THIRD-PARTY-NOTICES.md`, `CODEOWNERS`, `package.json`, the README section, `CLAUDE.md`, and `LICENSE` naming Joshua Heath
- [ ] The ruleset and security settings on, each read back; the Software Heritage request sent
- [ ] An independent review done; the pull request merged by the owner

## Sources

- GitHub Docs, "Available rules for rulesets" (consulted 18 November 2026): https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- Playwright, `testConfig.failOnFlakyTests`, added in 1.52 (consulted 18 November 2026): https://playwright.dev/docs/api/class-testconfig
- REUSE Specification 3.3, 14 November 2024: https://reuse.software/spec-3.3/
- SPDX licence list: PolyForm Noncommercial and Small Business are listed and Strict is not (consulted 18 November 2026): https://spdx.org/licenses/
- Copyright Act 98 of 1978 (South Africa), s 1 "author": https://en.wikisource.org/wiki/Copyright_Act,_1978/1997-10-01; *King v South African Weather Service* [2008] ZASCA 143
- US Copyright Office, *Copyright and Artificial Intelligence, Part 2: Copyrightability*, 29 January 2025: https://www.copyright.gov/ai/
- Anthropic, Consumer Terms of Service (consulted 18 November 2026): https://www.anthropic.com/legal/consumer-terms
- Software Heritage, Save Code Now: https://archive.softwareheritage.org/save/
