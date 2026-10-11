# Mobile responsiveness pass — what changed

Everything is inside `Frontend/`. Backend (`src/`, patches, tests) is untouched.

## New files
- `Frontend/responsive.css` — shared mobile layer, linked LAST on all 32 pages. Each section is commented.
- `Frontend/responsive-dates.js` — toggles an `.is-empty` class on the date filter wrapper (approved/rejected resources).
- `Frontend/responsive-tables.js` — adds column labels to table cells so admin tables can render as cards on phones. Included on: users, approved-resources, rejected-resources, admin-incentives.

## Edited in every HTML page
- viewport meta now has `viewport-fit=cover` (safe-area support on notched phones)
- `<link rel="stylesheet" href="responsive.css">` after the last stylesheet

## Bulk edits in existing CSS (all 27 files)
- Bare `fr` grid tracks -> `minmax(0, Nfr)` so grid children can shrink (root cause of the dashboard being wider than the screen)
- `minmax(Npx, 1fr)` card grids -> `minmax(min(Npx, 100%), 1fr)` (no overflow below ~330px)
- Every `100vh` height now has a `100dvh` line right after it (fallback preserved)

## Fixed by responsive.css
1. Background glows no longer widen the page; animated 150px blur removed on phones (battery/perf)
2. Inputs/selects/textareas are 16px on touch (stops iOS auto-zoom)
3. Student top bar fits at 320-480px (avatar was pushed off-screen at 360px)
4. Drawer scrolls on short screens and respects the notch; upload button clears the home indicator
5. Dialogs fit the visible viewport and scroll internally
6. Tab bars scroll sideways instead of clipping
7. Admin tables become labelled cards at <= 700px
8. Date filter (approved/rejected resources): on screens <= 860px the "Approval/Rejection Date" label is shown and the browser's own dd/mm/yyyy text is hidden while the field is empty (no more overprint). On desktop the label is hidden and the native field shows. Uses new `responsive-dates.js`.
9. Upload form section headings no longer collide with card borders (all screen sizes)
10. fieldset min-width quirk, searchable-select hidden element, queue sort dropdown, segmented controls, moderation action buttons

## Deliberately kept
- `overflow-x: hidden` on `body` stays as a safety net. The real causes are fixed, so it no longer hides anything.

## Behaviour changes on desktop (intentional)
- Tables with long emails now fit their container instead of cutting off Status/Action columns
- Upload headings sit inside their cards

## How it was tested
Headless Chromium, 32 pages x 6 widths (320, 360, 390, 768, 1024, 1280) with the overflow mask removed: 0 pages overflow. Also checked: open drawers, wallet modal, 7 dialog types on a 640px-tall screen, landscape (740x360), desktop pixel-diff vs original.
NOT tested: real devices, Safari/iOS, live API data.

## Round 2 fixes
- `admin-incentives.js`: the hamburger button and avatar (profile) menu did nothing on the Incentives page. The other 7 admin pages wire these in their own scripts; this one never did (bug existed in the original upload). Handlers added, matching the other pages.
- Date filters on approved/rejected resources: label restored on phones/tablets only (see item 8). New file: `Frontend/responsive-dates.js`, included on those two pages.
