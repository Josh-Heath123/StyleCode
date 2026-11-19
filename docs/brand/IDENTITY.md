# StyleCode's identity

The look every new interface follows. The decisions behind it are in `docs/presentation/PRESENTATION-BRIEF.md` (I1 to I13, November 2026); the values live in `src/styles/app.css`, and `npm run check:tokens` (`scripts/tokens.ts`) enforces what it can.

## One line

**Charcoal is the canvas, warm white is you, orange is the AI.** You decide; the AI proposes. Orange appears on what the AI proposes or does, and nowhere else.

## Colours, by role

| Role | Token | Value | Used for |
| --- | --- | --- | --- |
| Wells | `--well` | `#0B0B0B` | Recessed areas: the code view |
| The ground | `--surface-1` | `#121212` | Body, top bar, canvas |
| Raised | `--surface-2` | `#1A1A1A` | Panels, cards, menus |
| | `--surface-3` | `#222222` | Fields, buttons |
| | `--surface-4` | `#2B2B2B` | Hover, the active tab |
| | `--surface-5` | `#333333` | Pressed buttons and tooltips only |
| You | `--text`, `--you` | `#FDF9EA` | Text; primary buttons (warm-white fill, `--on-you` charcoal text); selection, handles, focus rings, links (underlined); the consultant's marks |
| | `--text-muted` | `#B9B5A8` | Secondary text |
| | `--text-subtle` | `#8F8C82` | Hints, labels, code comments |
| | `--text-disabled` | `#5E5B54` | Disabled controls only |
| The AI | `--ai` | `#FE5105` | The proposal on the canvas, the assistant's accent and sparkle, AI-proposed findings under review, an AI run |
| | `--ai-soft` | orange at 14% | The proposal's fill, a quoted passage |
| | `--ai-selected` | orange at 8% | A selected proposal |
| Saved, done | `--ok` | `#3DD68C` | The saved dot, success |
| Danger | `--danger` | `#FF5C8A` | Delete, withdraw, errors; a filled danger button has `--on-danger` charcoal text |
| Warning | `--warn` | `#F2C94C` | Consent warnings, read-only states, "Suggested (not agreed yet)" |

Surfaces differ by lightness alone. There is one theme, dark.

## Contrast rules

Measured with WCAG 2.x; every pair is in the brief (I2, I10, I11).

- Text on an orange fill is charcoal. Warm white on orange only for display text of 24 px and up, or 18.7 px bold.
- Orange text only on surfaces up to `#222222` (4.84:1); it fails on `#2B2B2B` (4.31:1).
- **Never orange text on the orange soft fill** (4.49:1 over `#1A1A1A`). The AI's badge, the open AI button and the welcome screen's AI point are outlined in orange instead.
- The subtle grey only on surfaces up to `#222222` (4.72:1), never on `#2B2B2B` or `#333333`.
- A filled danger button takes charcoal text: warm white on danger is 2.78:1.
- Danger is 35° of hue from orange and almost the same lightness, so every danger, warning and AI colour comes with its word or icon. Nothing depends on colour alone.

## Type

- **Inter** for everything read.
- **The display voice:** Inter 800 in its true italic, with tight tracking (`.display`), for the wordmark and one large moment per screen: the welcome screen's title, a client's name on its page, and the clients list's empty state. The small empty states inside cards stay plain.
- Never slanted body text, and never a faked italic.

## The construction grid

Hairlines in warm white at very low opacity, with one guide slanted at the italic's angle (`.motif`). It appears on the welcome screen, the clients list's empty state and the recovery screen, and on the README's hero and the social preview; **never behind data, the canvas or a form.**

## The canvas

- Its affordances (selection, handles, marquee, guides, distances, drop and insert lines, a note's arrow, frame labels) are warm white with a charcoal halo, so they show on light designs too, and never orange.
- Notes are the user's instructions: new notes are warm-white paper with charcoal text. A note keeps the colour it was saved with, and the other note colours stay on offer.
- The AI's proposal is orange: changed and new layers outlined, deleted ones dashed.

## The mark

A warm-white square, yours, and an orange dot, the AI's (`docs/brand/mark.svg`, `public/favicon.svg`, `src/ui/Mark.tsx`). The wordmark is "StyleCode" in the display voice beside the mark.

- **The drawing:** `src/ui/Mark.tsx` sets the proportions (a 15-unit square with a 2.6 stroke, and a dot of radius 6, in a 32-unit box). `docs/brand/mark.svg` and the rendered hero and social preview follow it.
- **The favicon keeps its own drawing** (a 12-unit square with a 2.4 stroke, and a dot of radius 5), because it reads better at 16 px. Checked on 19 November 2026 at 16 px on light and dark tabs: the favicon's square lands on whole pixels in full warm white, while the app's proportions blur two of its sides to grey and crowd the edge.

*Note, 19 November 2026:* there is no outlined `wordmark.svg`, and no font library to make one. The wordmark is set live in Inter 800 italic in `docs/brand/`'s HTML pages (`hero.html`, `social.html`), which `npm run demos` renders to PNG with Playwright.

## Design content isn't chrome

The example design, the blocks, the colours new layers start with, and every user's design keep their own colours: they are the user's work, not StyleCode's. A line of chrome that sets one says why with a `token-check: <reason>` comment.
