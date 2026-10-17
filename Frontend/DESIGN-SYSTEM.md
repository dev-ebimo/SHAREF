# Sharef design system: "the exercise book"

Sharef is where students find past questions and notes **by course code**, usually on a phone, usually before an exam.
So the look is school stationery: cool white paper, navy ink, blue biro, yellow highlighter, a red margin line.
Course codes (`CSC 201`) are the product's own vocabulary, so they are set as display type.

Everything lives in **`sharef-theme.css`** (site-wide) and **`dashboard-v2.css`** (this page only).

## The six colours

| Token | Value | Use it for | Never for |
|---|---|---|---|
| `--paper` | `#f3f5fa` | page background (the desk) | cards |
| `--sheet` | `#ffffff` | every surface that holds content | page background |
| `--ink` | `#0c1633` | text; the **one** dark block per page; active nav | decoration |
| `--biro` | `#2338f0` | anything you can act on: primary buttons, links, course codes | body text |
| `--highlighter` | `#ffd84a` | money (prices, balance) and "look here" (nudges) | large areas |
| `--margin` | `#e5484d` | the margin line, errors | success states |
| `--rule` | `#d6ddee` | every hairline border and ruled line | text |

Muted text is `--text-muted` (`#566180`, 5.6:1 on paper). Faded text is `--text-faint` (`#68738f`, 4.3:1+). Both pass WCAG AA.
Do not introduce new colours. If something needs emphasis, use ink, biro or highlighter.

## Type

- **Bricolage Grotesque** (700/800): headlines, section titles, **course codes**, prices, numbers. Tight tracking (`-0.02em` to `-0.04em`).
  Course codes also use `font-variation-settings: "wdth" 85` to be slightly condensed.
- **Instrument Sans** (400-700): everything else. 16px base.
- Sentence case everywhere. No ALL-CAPS labels, no letter-spaced eyebrows.
- Scale: 12.5 / 14 / 16 / 20 / 22 / 28 / 40 / 56-64px (the greeting is fluid: `clamp(2.15rem, 4.8vw, 3.7rem)`).

## Shape and space

- Controls 8-10px radius, rows/inputs 12px, panels/modals 16px, the hero sheet 10px, tags are pills. Different jobs, different corners.
- Hairline borders (`1px var(--rule)`) instead of shadows. The only shadows are on things that float (menus, modals, the upload button).
- Page content max width 1180px, centered. Sections separated by space (2.5rem), not by boxes.

## Component recipes

- **Primary action**: biro fill, white text, 10px radius. One per view. **Secondary**: white, 1px rule border (or 2px ink border for the wallet). **Quiet**: underlined text.
- **Price**: highlighter chip, Bricolage 700. **Balance**: Bricolage 800 with a highlighter swipe behind the lower half of the numerals.
- **Type tag** (by meaning, set via `data-type`): Past Question = ink outline, Lecture Note = biro tint, Revision Sheet = highlighter tint, Assignment Material = margin-red tint.
- **Nudge / attention strip**: `#fff1b3` background, ink text, ink button. Never a coloured banner.
- **The dark block**: ink background, white text, highlighter button. Once per page, at the end ("Upload a resource").
- **Ranked list** (anything ordered by a number): numeral + code + title + inline bar + price + action; rows divided by hairlines.
- **Timeline** (anything ordered by time): 2px rule down the left, 12px dot per entry, the newest filled in biro.
- **Hero sheet** (use once, on the landing page only): ruled lines, a red margin line that draws in on load, a dashed "tear-off" edge.

## Rolling it out to another page

1. In `<head>`, replace the Poppins link with:
   `https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800&family=Instrument+Sans:wght@400..700&display=swap`
2. Add `<link rel="stylesheet" href="sharef-theme.css" />` **after** the page's own stylesheet and `responsive.css`.
3. That alone re-skins the shell (sidebar, top bar, search, menus), buttons, modals, toasts and tokens. Verified on `resources.html`.
4. Then clean up what the page's own stylesheet hard-codes. Search it for `168, 85, 247`, `#a855f7`, `#8b5cf6`, `text-transform: uppercase` and replace
   with `var(--biro)` / `rgba(35, 56, 240, 0.1)` / sentence case. Approximate counts of hard-coded purples left:
   lecture-notes 12, past-questions 11, resources 10, help 8, upload 6, settings 6, profile 5, bookmarks 5, downloads 3, others 1-2.
5. Pages that do **not** load `dashboard.css` (login, signup, verify, the admin pages) have their own shell and need their own pass.

## Rules of thumb

- Spend boldness in **one** place per page (here: the hero search). Everything else stays flat and quiet.
- Give each kind of content the shape that suits it (list, timeline, index card) instead of one card repeated.
- Rank, time and money are information, so they get numerals, a timeline and a highlighter. Decoration does not.
- Every motion respects `prefers-reduced-motion` (handled once, in the theme).
