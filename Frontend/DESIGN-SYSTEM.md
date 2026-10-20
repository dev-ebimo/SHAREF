# Sharef design system: "the exercise book" (light and dark)

Sharef is where students find past questions and notes **by course code**, usually on a phone, usually before an exam.
The look is school stationery: cool white paper, navy ink, blue biro, yellow highlighter, a red margin line.
Dark mode is the same notebook at night: a navy desk, midnight-blue sheets, the same highlighter.

**Status: all 32 pages use it.** The dashboard is the showcase (`dashboard-v2.css`); the other 31 get the theme
(`sharef-theme.css`) plus their own stylesheet, converted to tokens.

## How a page is wired

```html
<head>
  <meta name="viewport" ... />
  <script src="theme.js"></script>                       <!-- first: applies the saved choice before paint -->
  <link href="...Bricolage+Grotesque...&family=Instrument+Sans..." rel="stylesheet" />
  <link rel="stylesheet" href="dashboard.css" />         <!-- the page's own stylesheets -->
  <link rel="stylesheet" href="responsive.css" />
  <link rel="stylesheet" href="sharef-theme.css" />      <!-- LAST: it overrides, it does not replace -->
</head>
```

## Light / dark / system

- Light tokens live on `:root`. Dark tokens apply under `:root[data-theme="dark"]` **and** under
  `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`. Both dark blocks are generated from one table, so a token
  can never exist in one mode and be missing in the other.
- **System** (default) follows the phone/PC setting. **Light** and **Dark** are explicit and always beat the OS.
  The choice is saved in `localStorage` (`sharef.theme`), shared between tabs, and applied before first paint (no white flash).
- Where the user changes it: the account menu (every page that has one), **Settings > Appearance** (student and admin), and a small floating
  button on pages with no menu (login, sign up, legal pages). `window.SharefTheme.set("dark" | "light" | "system")` does it from code.
- `theme.js` also keeps `<meta name="theme-color">` in sync, so the browser's address bar matches.

## Tokens (use these, never raw colours)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#f3f5fa` | `#0a1020` | page background (the desk) |
| `--sheet` | `#ffffff` | `#121a32` | every surface that holds content |
| `--surface-02` | `#edf0f8` | `#1a2342` | hover / recessed areas |
| `--rule` | `#d6ddee` | `#2a3660` | every hairline border |
| `--ink` / `--text-pure` | `#0c1633` | `#e8ecf9` | text |
| `--text-lead` / `--text-muted` / `--text-faint` | `#2a3557` / `#566180` / `#606b89` | `#c5cde6` / `#9aa6c6` / `#8e9abd` | secondary text (all >= 4.5:1) |
| `--biro` | `#2338f0` | `#93a0ff` | accent **as text, border, icon, link** |
| `--biro-fill` (= legacy `--purple`) | `#2338f0` | `#3b4ee8` | accent **as a background** (white text on top) |
| `--highlighter` + `--on-hl` | `#ffd84a` + `#0c1633` | same | money, "new", the one thing to look at |
| `--margin` / `--margin-text` | `#e5484d` / `#b3262c` | `#ff6b72` / `#ff8a90` | margin line / red text |
| `--red --ok --amber --teal --info` (+ `-rgb`, `-fill`) | deep, readable on white | bright, readable on navy | status text and tints |
| `--fill-ink` + `--on-fill-ink` | navy + white | pale + navy | inverse blocks (active nav pill, toast) |
| `--feature-bg` + `--feature-fg` | navy + white | blue + white | the one feature block per page |
| `--ink-rgb --biro-rgb --shadow-rgb --scrim-rgb ...` | | | for `rgba(var(--x-rgb), 0.12)` tints |

**Why two blues?** On a dark surface no single blue can both hold white button text *and* be readable as link text; the contrast maths
forbids it. So a *fill* (a background with white text on it) and an *accent* (text/border) are separate tokens.
Rule: `background` -> `--biro-fill`; everything else -> `--biro`.

**The on-fill scope.** A container painted with a solid colour (the wishlist banner, the profile header) holds white text in both modes.
Each stylesheet ends with a generated `ON-FILL SCOPE` block that re-declares the text tokens as white for those containers, so every
descendant using `var(--text-*)` or `rgba(var(--ink-rgb), x)` follows automatically. When you add a new filled container, add its selector
to that block (or set a literal `color: #fff`).

## Type, shape, motion

- **Bricolage Grotesque** (700/800): headlines, section titles, **course codes**, prices, numbers. **Instrument Sans**: everything else.
- Sentence case. No all-caps labels or letter-spaced eyebrows (tiny status badges excepted).
- Radius: controls 8-10px, rows/inputs 12px, panels/modals 16px, tags are pills. Hairline borders, not shadows; shadows only on floating things.
- One orchestrated motion per page (the dashboard's margin draws in). `prefers-reduced-motion` is honoured globally.

## Component recipes

- **Primary action**: biro fill, white text, 10px radius; one per view. **Secondary**: sheet + 1px rule border. **Quiet**: underlined text.
- **Price**: highlighter chip. **Balance**: Bricolage 800 with a highlighter swipe (`--swipe`) behind the lower half.
- **Type tag** (via `data-type`): Past Question = ink outline, Lecture Note = biro tint, Revision Sheet = highlighter tint, Assignment Material = red tint.
- **Ranked list** (ordered by a number) and **timeline** (ordered by time): see `dashboard-v2.css`.
- **Hero sheet**: ruled lines + a red margin line; use once, on the app's landing page.

## Adding or changing a page

1. Use tokens. No `rgba(255,255,255,x)` surfaces, purple hex, or raw status colours.
2. Text on a coloured fill: literal `color: #fff`, or add the container to the on-fill scope.
3. A decorative overlay that must stay white (a button shine) stays `rgba(255, 255, 255, x)`; a translucent *surface* uses `rgba(var(--ink-rgb), x)`.
4. Do not use `opacity` to "dim" text or a whole card: it lowers contrast below AA. Use `--text-muted`.
5. Verify with the audit in `tools/` (loads every page in both modes and checks real contrast).

## Tooling (`tools/`)

- `convert_css.py`: the property-aware converter used for the roll-out (old dark-purple CSS -> tokens).
- `qa.mjs`: loads every page in light and dark at any width and checks real WCAG contrast of every visible piece of text against its
  composited background (gradients included), horizontal overflow, redirects and script errors; saves screenshots.
