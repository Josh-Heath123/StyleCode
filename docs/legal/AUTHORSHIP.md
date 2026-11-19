# How StyleCode is made, and who controls it

This is a factual record, not legal advice. It is written so the owner can check every statement in it against the repository, and it isn't final until the owner has confirmed it. Where it refers to the law, it reports what the sources say, listed under **Sources**, and draws no conclusion from them.

## The owner

StyleCode's owner is Joshua Heath (GitHub account `Josh-Heath123`). The repository's first commit is dated 17 February 2026.

## What the owner decides

- **The product and its direction:** what StyleCode is for and what it becomes, as written in `docs/vision/` and `docs/ROADMAP.md`.
- **The decisions in each brief:** a reviewer (below) writes each phase's brief and decides most of its questions on the owner's behalf, and says so in the brief. At each check-in, the owner can accept or overrule any decision, and work goes on only after the owner's answer.
- **Every merge:** a change reaches `main` only through a pull request that the owner merges.

## Where the record is kept

- `docs/vision/`: what StyleCode is for.
- `docs/decisions/`: the architecture decision records (ADRs).
- `docs/phase-*/`: each workspace phase's brief and handover, from Phase 0 (4 November 2026).
- `docs/repository/`: the brief for the repository's checks and these papers.
- The git history, with its pull requests on GitHub.

The editor's five phases came first. They arrived as one pull request each, #1 to #5, on 3 and 4 November 2026. Their briefs and handovers aren't in the repository.

All of these are dated. From the repository brief onwards (18 November 2026), every commit on a branch is signed with the owner's signing key. GitHub signs the merge commits it makes with its own key, and shows both as "Verified".

## The AI tools used under the owner's direction

- **Claude Code**, Anthropic's coding tool, writes code and documents to the briefs, on the owner's computer and under the owner's account. Some commits say so in a `Co-Authored-By: Claude` line.
- **A Claude chat acts as reviewer.** It writes the briefs, decides their questions on the owner's behalf as described above, and reviews the work after each merge.
- **Images:** the logo (`public/favicon.svg`), the screenshot `docs/editor.png` and the three demo GIFs in `docs/media/` carry a Content Credentials (C2PA) record. It says: "Claude provided this file at the request of a user and may have created or modified the file contents."
- **Outputs:** Anthropic's Consumer Terms say: "Subject to your compliance with our Terms, we assign to you all of our right, title, and interest—if any—in Outputs." The words "if any" leave open how far AI output is protected at all.

No one other than the owner directs the work.

## The law this rests on

These are statements of the sources, not conclusions drawn from them.

- **South Africa: the Act.** The Copyright Act 98 of 1978 defines the author of a computer program as "the person who exercised control over the making of the computer program" (s 1(1), "author", paragraph (i)). Copyright vests in the author (s 21(1)(a)), except where the Act provides otherwise, as it does for works made in the course of employment (s 21(1)(d)).
- **South Africa: *Haupt t/a Softcopy v Brewers Marketing Intelligence (Pty) Ltd*.** The Supreme Court of Appeal considered a person who instructed an independent programmer on the result to be achieved, and controlled the work.
  - It held that this person was the author of the programs.
  - It said that "one does not need to be a computer programmer to be able to control the writing of a computer program" (para 41).
- **South Africa: *King v South African Weather Service*.** The same court explained that "author" has a technical meaning, and that the author is usually, but not necessarily, the first owner of copyright (paras 8 and 9).
  - It held that programs an employee wrote were made in the course of his employment, so his employer owned them.
- **United States.** The US Copyright Office's report *Copyright and Artificial Intelligence, Part 2: Copyrightability* (January 2025) says that human authorship is an essential requirement for copyright protection.
  - It concludes that "prompts alone do not provide sufficient human control to make users of an AI system the authors of the output."

## Third-party code and data

- **Third-party code:** StyleCode's only third-party code is the dependencies listed in [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md), each under its own licence.
- **Test data and test voices:** these are synthetic or role-played. No real client's data or recording is in the repository.

## Sources

All consulted on 18 November 2026.

- Copyright Act 98 of 1978 (South Africa), s 1(1) "author" and s 21, as consolidated at 1 October 1997: https://en.wikisource.org/wiki/Copyright_Act,_1978/1997-10-01
- *Haupt t/a Softcopy v Brewers Marketing Intelligence (Pty) Ltd* 2006 (4) SA 458 (SCA), [2006] ZASCA 40, 29 March 2006: https://www.saflii.org/za/cases/ZASCA/2006/40.html
- *King v South African Weather Service* 2009 (3) SA 13 (SCA), [2008] ZASCA 143, 27 November 2008: https://www.saflii.org/za/cases/ZASCA/2008/143.html
- US Copyright Office, *Copyright and Artificial Intelligence, Part 2: Copyrightability*, 29 January 2025: https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf
- Anthropic, Consumer Terms of Service, effective 8 October 2025, section 4: https://www.anthropic.com/legal/consumer-terms
- Content Credentials (C2PA) in the image files, read on 18 November 2026.
