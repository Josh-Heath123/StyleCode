# ADR-0010: The technology catalogue: shipped, sourced, dated, read-only, with no client data

- **Status:** Proposed
- **Date:** 2026-11-24

## Context

Workspace Phase 5 checks an engagement's technical constraints against technologies and proposes an architecture (`docs/ROADMAP.md`, "Workspace Phase 5"). ADR-0004 requires that compatibility and constraint checks are "calculated by code, from sourced and dated data", and that out-of-date or unsourced data is shown as such. The Phase 5 brief settles the catalogue's shape (decisions 4 to 11) and, at the WP0 check-in, that it serves users in any country, correctly (decision 27).

The catalogue is public knowledge about technologies, not about clients. StyleCode is local-first (ADR-0002) and free to run, so the catalogue can't depend on a hosted service.

## Decision

- **Shipped with StyleCode, the same for every client.** The catalogue is data in the repository, `catalogue/`, read by the app at build time. It is read-only in the app: nothing in the app adds or changes a fact. It never holds client data, and nothing in a client's workspace is written into it.
- **Its files.**
  - `CATALOGUE.json`: the catalogue's version (a whole number, raised by one in every pull request that changes the catalogue), its date, and every technology's id in the catalogue's own order.
  - `technologies/<id>.json`: one technology, the parts of a system it fills, one plain sentence on what it is, its sources, and its facts.
  - `countries.json`: the officially assigned ISO 3166-1 alpha-2 codes, with their source and date.
  - `groups/<id>.json`: a named group of countries (the EU, the EEA), its members, sources and date.
- **Facts are typed, sourced and dated.** A fact has a kind from a fixed list (`src/catalogue/vocabulary.ts`), a value from that kind's vocabulary, one or more sources from its technology's list, the date those were read, and an optional note. A source is a title, a publisher and an `https` URL: the vendor's or project's own page. A value and a note say what the source says in StyleCode's own words.
- **Missing means unknown.** A fact the sources don't give is left out, never guessed. A list fact (regions, the countries a service is offered in, compliance, languages, runtimes, platforms, SDKs, a host's runtimes and databases) holds the source's whole list, or isn't there. Nothing is inferred from another fact.
- **No country is built in.** Places are ISO codes, checked against `countries.json`. Groups of countries are data, sourced and dated like any fact.
- **Checked by CI.** `npm run check:catalogue` (`src/catalogue/validate.ts`) runs in Quick checks and refuses: an unknown part, kind or value; a fact without a source from its technology's list; a source that isn't `https`; a date that isn't real or is after today (the latest date anywhere on Earth); a country code not in `countries.json`; a reference to a technology that isn't there; a technology missing from the order, or listed twice; and any field the format doesn't have.
- **Checked again after a year.** A fact checked more than 12 months before today shows "check again"; the Technologies page lists every fact that's due.
- **How it's curated.** A technology is added, or a fact rechecked, by a pull request with its sources. The facts are gathered from the sources under the user's direction, and the reviewer checks a random sample against the sources at each catalogue check-in. The app shows a fact as "checked against <source> on <date>", never as verified by StyleCode.

## Options considered

- **Data in the repository, checked in CI, shipped with the app (chosen).** Every fact has a reviewable history in git, the same catalogue gives the same result everywhere, nothing runs on a server, and a result can name the catalogue version it used. Against: the catalogue is only as current as the last release, and keeping it current is work.
- **Fetched from a hosted service or the vendors' sites at run time.** Always current. Against: a hosted service costs money and contradicts ADR-0002; the vendors' pages aren't structured, change without notice, and would make results differ between runs (ADR-0004).
- **Edited by each consultant in the app.** Flexible. Against: facts would differ between consultants and lose their review; the brief leaves in-app editing out of Phase 5 (Clarifications).
- **Gathered by the AI.** Fast. Against: ADR-0004 rules it out; the AI never supplies a fact or marks one verified.

## Consequences

- The engine (ADR-0011, Slice B) reads the catalogue as plain data, and every result records the catalogue's version.
- The fact vocabulary is code: a new kind or value comes with the rule that uses it, and the check refuses anything else.
- The catalogue is small on purpose; a missing technology is fine, a wrong fact isn't. Where a source gives only part of a list, the fact is left out and the check-in says so.
- Some vendors' pages refuse automated reading. Those facts are left out, or read in a browser by the user, and the check-in names them.
