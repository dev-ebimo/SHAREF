# Sharef update: Step 1 (merged frontend) + Step 2 (Phase 1 backend)

## What's in this delivery

| File | What it is |
|---|---|
| `Sharef-Frontend-merged.zip` | Your **current** frontend + the update's features, merged. Replace your `Frontend/` folder with it. **Do not use the `Frontend/` from Sharef-Update-Package.zip**: it was built from an older snapshot and would break uploads, approvals and password change. |
| `Sharef-Backend-Phase1.zip` | Changed/new backend files (same paths as your project) + `phase1.patch` (unified diff vs your original zip). |

## Step 1: how the frontend was merged

Base = your current files. The update's changes were applied only where I read the diff and confirmed
it was feature work. Every hand edit was applied through anchored replacements that fail loudly if the anchor isn't unique.

**Added (11, from the update):** `earn.*`, `admin-incentives.*`, `downloads.*`, `incentives.js`, `dashboard-home.js`

**Taken from the update (diff verified feature-only):** `dashboard.html/js/css`, `bookmarks.html/js/css`, `admin-shared.js`,
`signup.js`, `users.js`, `profile.js`, `past-questions.js`, `my-uploads.js`, and the sidebar/"Wishlist"/`incentives.js`
edits in 5 admin pages and 9 student pages.

**Hand-merged (kept your logic, added theirs):**
- `upload.js`: kept the permit -> Cloudinary -> complete flow; added the bounty banner and `bountyId` in the permit body.
- `admin-moderation.js/.html/.css`: kept the DocAnalyzer page-count review and `{pages, snippet}` approve body; added the reward picker, queue badges, and "always show the dialog for requested/risky uploads".
- `admin-notification.html`: kept the page-count input and `doc-analyzer.js`; added the sidebar link only.

**Kept yours (the update's version would regress):** `settings.js`, `admin-settings.js` (token rotation after password change), `admin-notification.js`, `doc-analyzer.js`, and `signup/help/profile.css` (the update's extra rules there are unused even by the update itself).

**Deleted:** `community.html/js/css`.

**Checks run on the merged result:** all 34 JS files parse; every `<script>`/`<link>` target exists; no leftover `community.*`
references; regression guards (token rotation, permit flow, doc-analyzer tags, pages in approve body) all present;
element-ID audit vs your baseline shows only guarded lookups.
**Not done:** I haven't opened any page in a browser.

## Step 2: Phase 1 backend

New: `GET /api/downloads`, `GET /api/downloads/:resourceId/file`, `GET /api/resources/recommended`.
Extended: `GET /api/bookmarks` (adds `owned`, `savedAt`, `fileExtension`; `level` is now `"300 Level"`).

**Verification:** 29 checks passed running the real controllers against the real `schema.sql` in SQLite (ownership rules,
403 for non-owners incl. unknown ids, wallet and transactions untouched by `/file`, ranking, clamping, empty-profile cases).
That used a stand-in for `hono/jwt` and a fake request context, because Hono can't be installed in my sandbox.
**Not verified here:** the Hono route wiring and your existing 14 test files. Please run:

    node --experimental-sqlite test/phase6a-downloads.test.js   # new, same checks over HTTP
    node --experimental-sqlite test/phase5a-payments.test.js    # wallet, since walletController.js was touched (1 word: `export`)
    node --experimental-sqlite test/phase4b.test.js             # browse + bookmarks

### Decisions I made (easy to change)
1. **Ownership** = a successful `purchase` transaction (the same record `/wallet/charge` uses for `alreadyOwned`). There is no "granted" concept yet.
2. **Removed resources stay in `/downloads`** as `available:false` (titled from the purchase description) so a student's spend history stays accurate.
3. **`/downloads/:id/file` records the download** (log row + counter), exactly like the already-owned branch of `/wallet/charge`. It never touches the wallet.
4. **`recommended` ranking** = downloads in the last 30 days, then recency. Matches department AND level; excludes owned. A student's own uploads are not excluded (say if you want that).
5. **`/bookmarks` `level`** changed from `"300"` to `"300 Level"`. I checked: only the new wishlist page reads it.

### Deploy order
1. Deploy backend Phase 1 (additive; the old frontend keeps working).
2. Deploy the merged frontend.
3. **Then** delete `GET /resources/continue-learning` (route + `getContinueLearning`). I left it in on purpose; the old dashboard still calls it.

## Heads-up for Phase 2/3
- `transactions.type` has `CHECK (type IN ('deposit','purchase'))`, and SQLite can't alter a CHECK. Plan: keep rewards in their own ledger table and present `reward`/`reward_reversal` as virtual types in the admin transaction endpoints. No rebuild of your money table, and rewards are excluded from revenue by construction.
- Quick-approve from the admin **notification panel** has no reward picker. The server must apply a safe default there (e.g. no reward when the uploader is high-risk).
- `fileHash`: the Worker can't hash files under the CPU cap. Proposal: the admin's browser (which already downloads the file for page counting) computes SHA-256 and sends it with `approve`.
