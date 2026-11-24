# Workspace Phase 5: Technology catalogue, rules engine and architecture

> **For Claude Code.** Read these first:
> - `CLAUDE.md`;
> - `docs/phase-4/HANDOVER.md` and `docs/phase-5/NOTES-FOR-THE-BRIEF.md`;
> - ADR-0004 (deterministic engines), with ADR-0002 and ADR-0006;
> - `docs/vision/PRODUCT-VISION.md` §5 to §7;
> - `docs/ARCHITECTURE.md` §12, `docs/spec/DOMAIN-MODEL.md` (provenance and versioning) and `docs/spec/MVP.md`;
> - `docs/ROADMAP.md`, "Workspace Phase 5".
>
> Phase 5 is built in three slices, each on its own branch with its own pull request. At every **⏸ Check-in**, stop, report and wait.

## Goal

At the end of Phase 5, the consultant can:
- browse a catalogue of technologies in which every fact shows its source and the date it was checked, and see which facts are due to be checked again;
- record an engagement's technical constraints, each linked to the findings it comes from. For example: "works offline on Android", "client data stays in South Africa", "the team knows C#";
- see, for each part of the system, which catalogue options fit those constraints, which don't, and which the catalogue can't tell, with the rule and the facts behind each;
- get a proposed architecture: one choice for each part, shown to work with each other and with the constraints, with up to two alternatives beside it and what differs between them. Then keep one, edited if they like, linked to the constraints, findings and rules it rests on.

Every result is calculated by code from the catalogue and the constraints, and the same inputs give the same result (ADR-0004). **Phase 5 adds no AI** (decision 1).

Phase 5 is "Workspace Phase 5: Technology catalogue, rules engine and architecture" in `docs/ROADMAP.md`. Its acceptance criteria are the roadmap's, refined below.

## How decisions were made for this phase

The user chose these on 24 November 2026:
- the catalogue and the engine first, before any work on the canvas AI's fit (decision 25);
- code only in Phase 5: no AI proposes constraints or architectures yet (decision 1);
- the first catalogue covers business web apps, mobile apps, integrations and APIs, and data and reporting (decision 5);
- yes to the Software Heritage save (WP0).

The rest are the reviewer's decisions, made on the user's behalf on 24 November 2026 from the ADRs, the vision, the roadmap and the Phase 5 notes. Raise any that looks wrong at the WP0 check-in, especially where the code shows a simpler way to the same behaviour. After that, don't reopen them.

**Check-ins in this phase are short:** screenshots, numbers and a recommendation. The user may pass a check-in to the reviewer and paste back its answer. Treat that answer as the user's.

## Decisions made for this phase

### What Phase 5 is, and isn't

1. **No AI in Phase 5.** The consultant enters the constraints. Options, compatibility and the proposed architecture are calculated by code. Nothing from a client goes to an AI, so the consent wording doesn't change, C5 is untouched, and no POPIA question is added. A later phase may let the AI propose constraints from findings and explain trade-offs; that needs its own consent statement and is that phase's decision.
2. **Not legal advice.** The catalogue says what its sources said on the date they were checked. Where a constraint touches the law (data staying in South Africa), the page says it isn't legal advice, as the consent form does.
3. **No prices.** Costs are Phase 6. A fact may say a technology is open source or a paid service, never how much it costs.

### The catalogue (Slice A; ADR-0010)

4. **One catalogue, shipped with StyleCode, the same for every client.** It lives in the repository as data (`catalogue/`), is validated in CI, and is read-only in the app. It never holds client data: it is public. It has a version and a date (`catalogue/CATALOGUE.json`), and every result records the version it used.
5. **What it covers first** (the user's choice): business web apps, mobile apps, integrations and APIs, and data and reporting, with South African clients in mind. That's about 30 to 40 technologies across the parts in decision 6. Claude Code proposes the list at the WP0 check-in. For example:
   - **web front ends:** a React single-page app, a server-rendered framework, a plain multi-page site;
   - **mobile:** native Android and iOS, one or two cross-platform frameworks, a progressive web app;
   - **back ends:** Node.js, .NET, Python and PHP frameworks;
   - **databases:** PostgreSQL, MySQL, SQL Server, SQLite, a document database, a hosted backend-as-a-service;
   - **hosting:** the large clouds' South African regions where they have them, a South African host, a platform-as-a-service;
   - **authentication:** a hosted identity provider, Microsoft's, a self-hosted one;
   - **integrations used in South Africa:** payment gateways, accounting packages, WhatsApp and SMS messaging, email;
   - **data and reporting:** a hosted BI service, an open-source dashboard tool.

   The names here are examples, not facts. What each technology can do comes only from its sources.
6. **The parts of a system** are a fixed list: web front end, mobile app, back end, database, hosting, authentication, integrations (payments, accounting, messaging, email), and data and reporting. A technology fills one part or more.
7. **Facts are typed, sourced and dated.** Each fact has a kind from a fixed vocabulary, a value, a source, the date it was checked, and an optional note in plain words. The source is a title, a publisher and an `https` URL to the project's or vendor's own documentation. Use a blog or forum only where no primary source exists, and say so. The first vocabulary holds only what the rules in decisions 13 and 17 use:
   - the licence (an SPDX id, or "proprietary");
   - open source, or a paid service (no prices);
   - its languages and runtimes;
   - the platforms it runs on or targets (web, Android, iOS, Linux, Windows, serverless);
   - whether it works offline (yes, partly or no), for front ends and mobile;
   - whether it's self-hostable, and whether it's offered as a managed service;
   - a South African region or data centre (yes, with the region's name, or no), for hosting and hosted services;
   - the runtimes and databases a host offers;
   - its SDKs or APIs (languages with an official SDK, and whether an HTTPS API can be used from any back end);
   - what it requires: another part or technology it can't work without;
   - its support: the latest release date, and the end of support where the source gives one.
8. **Facts in StyleCode's own words.** A value and a note say what the source says without copying it: no quotation beyond a few words. Claude Code gathers the facts from the sources under the user's direction, and the reviewer checks a random sample against the sources at each catalogue check-in. The app shows a fact as "checked against <source> on <date>", never as "verified" by StyleCode (ADR-0004).
9. **Checked again after a year.** A fact checked more than 12 months before today shows "check again". That's the only result that depends on the date: it's worked out from the day shown, from the user's clock. The Technologies page lists every fact that's due.
10. **Missing means unknown.** If a fact a rule needs is missing, the option is "can't tell from the catalogue" for that constraint. It is never assumed to fit.
11. **The Technologies page** sits beside Clients (`#/technologies`) and is read-only. It lists technologies by part, with a filter. Each technology shows its facts, each with its source link and date, and "check again" where that's due. It works with no client open.

### Constraints and the engine (Slice B; ADR-0011)

12. **Constraints belong to an engagement.** The consultant enters them from a fixed list of types, each with its parameters and linked to at least one finding in the engagement's record, or marked as the consultant's own (as a finding can be entered without a session). The types:
    - platforms: must run on the web, Android or iOS (one or more);
    - works offline;
    - data stays in South Africa: hosting and hosted services need a South African region;
    - licence: open source only, or no strong copyleft (from a fixed list of SPDX ids);
    - self-hosted only, or managed services only;
    - the team's languages;
    - must integrate with a named technology in the catalogue (an accounting package, say);
    - must use a named technology for a part (an existing system), or must not use it;
    - still supported: a release in the last N months.

    A constraint shows the weakest status among its findings; if one is an assumption, it says "rests on an assumption". Constraints keep a history, as findings do, and deleting one asks first, as deleting a finding does.
13. **The engine** is pure TypeScript in `src/engine/`, with no React or DOM, like `src/model`. `evaluate(catalogue, constraints)` gives, for each part and each technology, "fits", "doesn't fit" or "can't tell", with the rules applied and the facts each one used.
    - Each rule has a stable id (`R-OFFLINE`, say), a one-line description in plain words, and a test.
    - The outputs are sorted, and the same inputs always give the same output.
    - A test runs every role-played engagement twice and compares the results, and a stored expected result catches any change that wasn't meant.
14. **Results are calculated.** Each shows its provenance: the engine's version and the catalogue's version. The domain model's `calculated` provenance already has the fields.
15. **The Architecture page** belongs to an engagement (`#/c/<company>/e/<engagement>/architecture`), with an **Architecture** card on the engagement page. It shows the constraints, then the options by part. Each option shows its reasons and the facts behind them, and each fact links to its source.

### The architecture (Slice C)

16. **Which parts.** The consultant ticks the parts this engagement needs, from decision 6. Not every project has a mobile app or a reporting tool.
17. **Compatibility between choices** is checked by rules too, from facts only:
    - the host offers the back end's runtime;
    - the host offers the database, or the database can be self-hosted there;
    - an integration has an SDK in the back end's language, or an HTTPS API;
    - the authentication provider supports the front end and mobile platforms chosen;
    - anything a choice requires is among the choices.

    A pair the facts can't settle is "can't tell", and the page says which fact is missing.
18. **The proposal is calculated, in an order that's fixed and shown.** From the options that fit, the engine finds the combinations that are compatible across the ticked parts, and orders them by:
    1. the fewest "can't tell" results;
    2. the fewest languages and runtimes in all;
    3. the most of the team's languages;
    4. the catalogue's own order.

    It shows the first, with up to two alternatives beside it and only the facts on which they differ. The page explains the order in one line. There are no hidden weights.
19. **Keeping an architecture.** The consultant keeps the proposal or an alternative, and can change any choice. The engine checks the architecture again on every change.
    - A kept architecture stores its choices and the catalogue and engine versions it was checked with. It links each choice to the constraints and rules it rests on, and through them to the findings.
    - When the catalogue or the engine has changed since, the page checks it again and says what changed.
    - An engagement can keep more than one architecture, because Phase 6 compares their costs. One is marked as the one proposed to the client.
20. **Workspace version 7** adds an engagement's `constraints` and `architectures`, with a migration (there are none before it). Companies never mix: constraints and architectures belong to one engagement, and the catalogue holds no client data.
21. **The Markdown export** gains the engagement's constraints, with their findings, and its kept architectures: the choices, the rules behind them, and each fact's source and date.
22. **Performance budgets** go in a unit test like `src/model/performance.test.ts`: evaluating the whole catalogue against 15 constraints in under 50 ms, and proposing an architecture across all eight parts in under 500 ms. Measure them on the laptop, and don't loosen them to make a change pass.
23. **The identity holds.** No result is the AI's, so none is orange. "Fits", "doesn't fit" and "can't tell" are words with an icon, in the existing role tokens, and nothing relies on colour alone. Any new colour goes into `IDENTITY.md` first.

### What Phase 5 inherits (`docs/phase-5/NOTES-FOR-THE-BRIEF.md`)

24. **In Slice A, each small and each with a test:**
    - **Creating a client** keeps the clients' names in memory, read once and updated by create, rename and delete in the same queue, so a create no longer reads every client's file. `workspace.spec.ts:20` stays as it is.
    - **The data folder lock's signal handlers** print one line naming the signal before they exit.
    - **A standalone canvas request on a model on this computer takes the heavy slot and the cooling pause too,** as an engagement's request does. This reverses Phase 4's decision 18 on this one point: the GPU contention Phase 3 measured outweighs keeping the standalone editor exactly as it was.
    - **`think: false` goes only to models that think.** The AI server asks Ollama's `/api/show` once per model and sends `think: false` only when the model's capabilities include thinking, for extraction and canvas requests alike. Add a fake-Ollama test for each kind of model.
    - **The hygiene check reads only an image's text** for addresses: PNG's `tEXt`, `iTXt` and `zTXt` (decompressed) and `eXIf` chunks, and their JPEG and GIF equivalents. Text files are checked as before. The tests: an address in each kind of chunk is refused, and WP11's bytes pass.
25. **The canvas AI's fit and the extraction questions** wait for an AI quality slice before real client use (the user's choice). The roadmap names that slice. Phase 5 doesn't touch the AI's prompts.
26. **The flakes to watch** stay on watch.

## Clarifications

- **"Fits" isn't "recommended".** The page says an option fits the constraints entered and the catalogue as it was checked. It doesn't say a technology is good.
- **Unknown is honest.** "Can't tell" is a normal result, not an error, and the page says which fact is missing.
- **Only what the consultant enters.** A constraint is never made from a finding automatically. The consultant reads the findings and enters the constraints.
- **The catalogue is small on purpose.** Missing technologies are fine. A consultant can't add one in the app in Phase 5; adding one is a pull request with sourced facts.
- **Test data stays role-played.** Harbour Bakery (an online ordering page that takes payments) and Karoo Freight (a drivers' app that works offline on Android) get constraints built on the findings they already have.

## Ground rules

As in Phase 4, plus:
- one branch per slice: `workspace-5a-catalogue`, `workspace-5b-constraints` and `workspace-5c-architecture`;
- signed commits, the noreply author, and no email address anywhere;
- no new runtime dependency without the user's label (the engine and the catalogue need none);
- nothing outside the repository without the user's yes (the Software Heritage request in WP0 has it);
- sources are fetched only to gather facts: nothing in the app or its tests touches the network;
- every picture is checked by eye before it's committed.

## Slice A: The catalogue (`workspace-5a-catalogue`)

### WP0: Start clean

- Commit this brief as `docs/phase-5/PHASE-5-BRIEF.md`, the first commit on the branch.
- Take a baseline: typecheck, unit tests and browser tests on `main` (`eb34d2d`), with the counts.
- Send the Software Heritage "Save code now" request for `https://github.com/Josh-Heath123/StyleCode` (the user said yes on 24 November 2026), and note its status.
- Write a plan: the catalogue's file layout and schema, the fact vocabulary as types, the parts, and the technology list (decision 5), with the source you'd use for each technology.

⏸ **Check-in:** the baseline, the Software Heritage status, the plan and the list, and any decision above that looks wrong.

### WP1: The inherited fixes (decision 24)

Each fix in its own commit, with its test.

### WP2: The catalogue's format and its check

- The `catalogue/` data, its TypeScript types and a validator (`src/catalogue/`).
- `npm run check:catalogue`, run in CI's Quick checks. It checks that:
  - every id is unique;
  - every part and fact kind is known;
  - every fact has an `https` source and a date not in the future;
  - every reference to another technology resolves;
  - the catalogue's version and date are set.
- ADR-0010, the catalogue: shipped, sourced, dated, read-only, with no client data, and how it's curated and checked.

### WP3: The first catalogue

The agreed technologies, with the facts decision 7 lists wherever the source gives them. Where a source doesn't say, leave the fact out (decision 10).

⏸ **Check-in:**
- counts by part and by fact kind;
- the facts missing most often;
- 25 facts chosen at random by a seeded script, each with its source URL, for the reviewer to check against the sources.

### WP4: The Technologies page (decisions 9 and 11)

With browser tests and an accessibility scan.

⏸ **Check-in:** screenshots at 2× of the list, and of one technology with a "check again" fact (from a test fixture, not the real catalogue). Then the pull request for Slice A.

## Slice B: Constraints and the engine (`workspace-5b-constraints`)

### WP5: Constraints in the model (decisions 12 and 20)

Workspace version 7, its migration, the model functions with unit tests, and validation: a constraint's findings must be in its own engagement, and a named technology in the catalogue.

### WP6: The engine (decisions 10, 13, 14 and 22)

- `src/engine/`: the rules for each constraint type, `evaluate`, the determinism test, the expected results for the role-played engagements, and the performance budget.
- ADR-0011: the engine, its rules, and how they're versioned.

### WP7: The Architecture page, part one (decision 15)

Constraints (add, edit, link findings, and delete after asking) and the options by part, with their reasons and sources. With browser tests and an accessibility scan.

⏸ **Check-in:** screenshots at 2× of Karoo Freight's constraints and its options for the mobile app and hosting, with one "doesn't fit" and one "can't tell" opened to show their reasons. Then the pull request for Slice B.

## Slice C: The architecture (`workspace-5c-architecture`)

### WP8: Compatibility and the proposal (decisions 16 to 18)

The rules between choices, the proposal and its order, with unit tests and the budget.

### WP9: Keeping an architecture (decisions 19 to 21)

The proposal and its alternatives side by side, keeping and editing one, checking it again after a catalogue change, and the export.

⏸ **Check-in:** screenshots at 2× of Harbour Bakery's proposal with two alternatives, and of a kept architecture after a catalogue change.

### WP10: Docs, roadmap and README

- the guide ("Technical constraints and architecture");
- `ARCHITECTURE.md` §13 (the catalogue and the engine);
- `DOMAIN-MODEL.md` (version 7) and `MVP.md`;
- `ROADMAP.md`: Phase 5 ✅; the AI quality slice named, with the canvas AI's fit and Phase 4's decision 19 extraction questions; Phase 6 next;
- the Phase 6 notes;
- the README (P9): the status, one new tour picture at most (still four screenshots in all), and a highlight on the engine, with evidence.

⏸ **Check-in:** every picture that changed, by path, and the README's new text in full.

### WP11: Review and hand-back

- An independent review of the whole of Phase 5, by a subagent that hasn't seen how it was built. It looks hardest at determinism (the same inputs give the same output), "missing means unknown", a source and a date on every fact shown, and companies never mixing. Fix what it finds, each fix with a test.
- `docs/phase-5/HANDOVER.md`, then the pull request.

⏸ **Check-in:** the pull request link and CI's result. After the merge: the version, the signed tag `v0.7.0` and the release, as for v0.6.0.

## Acceptance criteria

The roadmap's, refined:
- Every catalogue fact shows its source and the date it was checked. Facts checked over 12 months ago say "check again". Nothing in the app adds or changes a fact, and no AI is involved.
- Given an engagement's constraints, the engine lists, for each part, the options that fit, that don't, and that the catalogue can't tell, with the rule and the facts behind each. It gives the same result every time.
- A proposed architecture names a choice for each part the consultant ticked. It shows that the choices are compatible with each other and with the constraints, or names what can't be told, and links each choice to the constraints, findings and rules it rests on. Up to two alternatives are shown beside it, with what differs.
- A kept architecture records the catalogue and engine versions it was checked with, and says what changed when either has.
- The Markdown export includes the constraints and the kept architectures, with their sources.
- Companies never mix, and the catalogue holds no client data.
- The inherited items in decision 24 are done, each with a test.

## Definition of done

- CI is green on every slice, with no check weakened and no test retried, and the unit and browser tests are counted at each slice's end.
- The reviewer has reviewed each slice, and an independent subagent has reviewed the whole phase, with its findings fixed.
- ADR-0010 and ADR-0011 are accepted; the docs and README are updated (P9); `docs/phase-5/HANDOVER.md` is written.
- After the merge: `package.json` at 0.7.0, the signed tag `v0.7.0` and its release (R21).
