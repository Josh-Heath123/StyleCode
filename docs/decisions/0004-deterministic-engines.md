# ADR-0004: Deterministic engines for cost, compatibility and constraints; AI proposes and explains

- **Status:** Proposed
- **Date:** 2026-11-04

## Context

The vision asks for technology, architecture and cost recommendations that are "consistent, transparent and technically defensible" (vision §7), with cost estimates "based on identifiable pricing information and clearly stated usage assumptions rather than presenting speculative figures as guaranteed costs" (vision §6). It also asks the app to distinguish "information extracted from a conversation, verified technical information, calculated results and AI-generated suggestions" (vision §7).

Language models are good at interpreting conversations and explaining trade-offs. They aren't reliable sources of current prices, exact compatibility facts or arithmetic. StyleCode already follows this split: the AI proposes validated operations that the user accepts or rejects, and code is compiled from the document deterministically (`docs/ARCHITECTURE.md` §8 and §9).

The user decided this before Phase 0 (Phase 0 brief, "Decisions already made", 4).

## Decision

- Costs, compatibility and constraint checks are calculated by code, from sourced and dated data. The same inputs always give the same result, and each result can show the data and assumptions it came from.
- The AI interprets (for example, extracting findings from a transcript), proposes (findings, design changes, candidate architectures) and explains (trade-offs, results). It never supplies a price, and never marks anything as verified or confirmed.
- Every finding carries its status and its provenance (said in a session, entered by the consultant, verified technical information, calculated, or AI-suggested), and the interface never blurs them.
- AI output is a proposal. The consultant accepts, edits or rejects it, and each change is undoable.

## Options considered

- **Deterministic engines, with AI proposing and explaining (chosen).** Recommendations can be checked and repeated, prices are traceable to a source and a date, and the AI is used where it is strong. Against: the pricing and technology data must be curated and kept current, and the rules engine is real work (Phases 5 and 6).
- **AI recommends directly.** Fast to build and flexible. Against: prices and compatibility claims can be invented or out of date, results change between runs, and nothing is defensible in front of a client. Contradicts vision §6 and §7.
- **Fully deterministic, no AI.** Fully predictable. Against: can't interpret free conversation or explain trade-offs in context, which is most of the vision's value (§2, §3).

## Consequences

- The domain model (WP3) keeps status and provenance as two separate fields on every finding, with "calculated" and "verified technical information" as provenances the AI can't assign.
- The technology catalogue (Phase 5) and cost engine (Phase 6) store each fact or price with its source and the date it was checked. Results show both.
- Data that is out of date or unsourced is shown as such, not silently used.
- Extraction quality is measured with an evaluation harness (opening Phase 2), because AI-proposed findings are only useful if their accuracy is known.
