# Sharef API — Cloudflare Workers + D1

Hono API on Cloudflare Workers with D1 (SQLite), a vanilla HTML/JS frontend (`Frontend/`), Cloudinary for files,
Paystack for payments and SendGrid for email. The backend is code-complete and covered by `npm test`
(27 files, 1,300+ checks). See `GO-LIVE.md` for the deployment checklist and `CHANGES-CONSISTENCY.md` for the
latest round of fixes.

## First-time setup

```bash
npm install

# Log into your Cloudflare account (opens a browser)
npx wrangler login
# If this hangs on "Waiting for authorization code" and crashes (Windows
# especially): check Defender/firewall isn't blocking the localhost:8976
# callback, try a different default browser, or skip OAuth entirely with
# a manually-created API token — see "Troubleshooting" below.

# Create the actual D1 database in your Cloudflare account
npx wrangler d1 create sharef-db
# ^ copy the database_id it prints into wrangler.toml's database_id field

# Apply the schema to your LOCAL dev database (no Cloudflare account traffic)
npm run db:migrate:local

# Run it locally
npm run dev
# then in another terminal:
curl http://localhost:8787/api/health
```

## Secrets (not in wrangler.toml — set individually)

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put PAYSTACK_SECRET_KEY
npx wrangler secret put SENDGRID_API_KEY
npx wrangler secret put CLOUDINARY_CLOUD_NAME
npx wrangler secret put CLOUDINARY_API_KEY
npx wrangler secret put CLOUDINARY_API_SECRET
```

Also set `FRONTEND_URL`, `SENDGRID_FROM_EMAIL` and (optionally)
`SENDGRID_FROM_NAME` in `wrangler.toml`'s `[vars]` — they aren't secret. This
list was checked against every `env.*` the code actually reads; a wrong or
missing `SENDGRID_FROM_EMAIL` in particular fails *silently* (no email ever
sends, nothing surfaces an error). **See `GO-LIVE.md` for the full ordered
checklist**, including the Paystack webhook URL and cutover sequencing.

## Applying the schema to production D1 (once you're ready to go live)

```bash
npm run db:migrate:remote
```

## Deploying

```bash
npm run deploy
```

## Troubleshooting: `wrangler login` hangs / crashes

If it times out waiting for the authorization code (sometimes with a
Windows `UV_HANDLE_CLOSING` assertion crash), skip the interactive OAuth
flow entirely:

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → use
   the "Edit Cloudflare Workers" template (or a custom token with
   Workers Scripts, D1, and Account Settings edit permissions).
2. Set it as an environment variable instead of running `wrangler login`:
   - Windows (cmd): `set CLOUDFLARE_API_TOKEN=your_token_here`
   - Windows (PowerShell): `$env:CLOUDFLARE_API_TOKEN="your_token_here"`
   - macOS/Linux: `export CLOUDFLARE_API_TOKEN=your_token_here`

wrangler picks this up automatically — no browser step needed.

## Migration progress

**Done:**
- Schema (`src/db/schema.sql`)
- Auth: register, verify-otp, resend-otp, login, forgot-password, reset-password
- `protect` / `restrictTo` middleware (JWT verify + role cache)
- Bookmarks: toggle, list, check
- Student notifications: list mine, toggle read, mark all read
- Resource download streaming (`/api/resources/:id/stream`)
- Resource browsing: recent, trending, continue-learning, past-questions, preview
  (the preview snippet is stored at approval time — extracted by the reviewing admin's
  browser — so a student's preview request is a plain column read)
- Resource CRUD (read side): list/search with filters+pagination, my-uploads, get-by-id
- Resource upload: direct browser → Cloudinary using a short-lived signed permit
  (`POST /resources/upload/permit`, then `POST /resources/upload/complete`). File bytes never
  pass through the Worker (10 ms CPU limit on the free plan); `complete` verifies size and
  file signature with one ranged request. Abandoned uploads expire and are purged
  (`jobs/purgeStaleUploads.js`). Page counting and preview extraction happen in the admin's
  browser at review time (`Frontend/doc-analyzer.js`); the server only range-checks them
- Wallet + Paystack: balance, fund/initialize, fund/verify, webhook (HMAC-SHA512 signature
  check via Web Crypto), charge-for-download — every balance change uses a single atomic
  conditional `UPDATE` rather than a separate read-check-write, closing race windows the
  original had (double-credit on verify+webhook both firing, and a balance race on
  simultaneous downloads)
- Admin moderation: queue (with Lagos-timezone "today" stats), approve/reject (atomic
  status guard — closes a double-approve/duplicate-notification bug the original had),
  admin review preview (the Worker hands out a signed link; the admin's browser reads the
  file, counts pages and extracts the preview — approval requires the confirmed page count),
  pending-count badge
- Admin resource management: approved/rejected lists with filters+pagination, resource
  details, remove-from-approved, restore-to-pending (both status-guarded), and
  permanent delete — a genuinely atomic cascade via D1's `batch()` (bookmarks deleted,
  download logs deleted, transactions/notifications detached via nulled `resource_id`
  rather than deleted, preserving financial and notification history)
- Announcements: department/level-targeted fan-out, in-app notifications bulk-inserted
  via `batch()`, emails sent in small concurrent chunks (each recipient's own
  preferences decide in-app vs. email vs. both)
- Admin notification feed: shared queue handling both new-upload and account-deletion
  notifications, mark-read/mark-all-read, and quick approve/reject/preview that
  delegate to the same underlying moderation logic as the full queue (refactored
  moderationController.js to expose `*ById` functions for this, replacing the
  original's Express-only trick of overwriting `req.params.id`)
- Admin user management: filter options, paginated user list with computed
  "effective status" (suspended > inactive-by-login-window > active — the original's
  MongoDB aggregation pipeline translated to a SQL CTE, since SQLite doesn't reliably
  support referencing SELECT-list aliases in WHERE the way it does in ORDER BY), user
  profile with upload/transaction stats, suspend/reactivate, deleted-account log
- Admin transactions: category-breakdown summary and filterable transaction list,
  reusing the same effective-status CTE as user management (both queries were
  validated directly against real SQLite with realistic multi-user data before the
  route/test layer was even written, given how much more complex this SQL is than
  anything earlier in the migration)
- User settings/profile: profile view/update (role-filtered preferences), preferences
  deep-merge (with the original's prototype-pollution guard ported verbatim — verified
  by actually attempting a `__proto__` injection in a test and confirming
  `Object.prototype` was genuinely untouched afterward, not just that the request
  didn't error), password change, and account deletion — by far the largest cascade in
  the app (a user's own resources, bookmarks, download logs, transactions, received
  notifications, *and* — if they're an admin — every `reviewed_by`/`created_by`
  attribution on other people's records). Required relaxing two schema columns
  (`transactions.user_id`, `announcements.created_by`) from `NOT NULL` to nullable,
  clearly commented in `schema.sql`, so that financial and audit history can outlive
  the account itself rather than being deleted or blocked by the deletion.

**History - the migration notes below are kept for context. The entire backend is code-complete — every route from all 12 of the original
Express route files has a tested D1/Workers equivalent.** 385 tests pass across 9 test
files, with no known gaps. What's left is no longer "port more code" — it's the two
steps that turn this from a parallel implementation into the live site:

1. **Data migration** — done: see `scripts/migrate/README.md`. A standalone script
   (kept separate from the Worker's own dependencies) that exports every MongoDB
   collection, transforms it into this schema's shape, and writes a single reviewable
   `.sql` file — nothing is applied automatically. Covered by 73 tests of its own,
   including one that generates real SQL from synthetic data, applies it to the actual
   production schema, and runs the migrated data through a real app route end to end.
2. **Frontend cutover** — point `API_BASE` at the new Workers URL. Every response
   shape here was deliberately kept identical to the original throughout the
   migration specifically to make this step small.

**Not yet ported:** nothing. Everything below is context for what's already done, not
a to-do list.

**Two real operational ceilings worth knowing about, both specific to Workers and
deliberately not engineered around yet:**
- **Announcement emails on the free plan.** Each email is its own `fetch()` call to
  SendGrid, and Workers' free plan allows only ~50 subrequests per request in total.
  An announcement emailing more than ~50 students in one call will hit that cap and
  fail partway through. The in-app notification fan-out doesn't have this problem — a
  single `batch()` call, however many statements it holds, counts as roughly one
  subrequest, not one per row (this is also *why* it's implemented via `batch()`
  rather than a loop). A real fix (e.g. queuing individual emails so each is its own
  invocation with its own subrequest budget) is worth building once an announcement of
  that size is an actual need, not before.
- **`batch()` trades away per-row fault isolation for atomicity.** The original used
  `insertMany(..., { ordered: false })` for the notification fan-out specifically so
  one malformed row wouldn't drop the rest of the batch. `batch()` is a real SQL
  transaction — one bad statement rolls back the whole chunk. Accepted here because
  these are simple, uniform, server-generated inserts with fresh UUIDs and no
  realistic per-row failure mode, but worth knowing if that ever changes.

**Worth a manual check before relying on it:** `utils/cloudinaryPreview.js`'s
URL builder was translated from the Cloudinary SDK's `.url()` call to a
plain template string. That's pure local string-building (no network call
either way), but it's the one piece here I couldn't verify end-to-end
without a real Cloudinary account — compare its output against what the
SDK actually produces before trusting it in production. The signed-upload
signing algorithm in `utils/cloudinaryUpload.js`, by contrast, is
implemented exactly per Cloudinary's published spec and is worth a real
test upload against your actual account before going live, since a wrong
signature fails loudly (401 from Cloudinary) rather than silently. The
Paystack webhook's HMAC-SHA512 signature check was cross-validated
byte-for-byte against Node's own `crypto` module output for the same
input, so that one is on solid ground.

**Design note on D1 and `RETURNING`:** the wallet-crediting logic
deliberately avoids SQLite's `RETURNING` clause, even though it worked
fine against the local test mock (same SQLite engine D1 uses) — Cloudflare
doesn't clearly document whether D1's HTTP API surfaces it, and this is
the one part of the app where getting that wrong silently would actually
cost money. It uses the well-documented `meta.changes`/`meta.rows_written`
pattern instead, at the cost of one extra query per successful claim.

## Running the tests

```bash
npm test                      # every file, one line each + a total
npm test -- consistency       # only files whose name contains "consistency"
node --experimental-sqlite --no-warnings test/consistency.test.js    # one file directly
node test/academic.test.js    # the pure-function suites need no flags
```

Needs Node 22+ (the tests run real controllers against the real `schema.sql` in Node's built-in SQLite, via
`test/mockD1.js`). No Cloudflare account or network is needed.

## Data consistency (department, course, matric number, session...)

Department, course, matric number and session are typed by hand, so the same thing used to be stored many ways
("computer science" / "Computer  Science" / "Computer Science Dept."), and exact-match filters then showed a student
nothing. The rules now live in **one place**, `src/utils/academic.js`:

- **Write time** - everything is stored in a canonical form: department `Computer Science`, course `CSC 305`,
  matric `CSC/2019/001`, session `2024/2025`, level `300`, semester `First`, type `Past Question`.
  Validators accept the obvious variants (`300 Level`, `1st`, `2024-25`, `past questions`, `csc305`) and normalise them.
- **Match time** - every filter, search, "For you" row, trending list and announcement audience compares
  **keys** (`departments.department_key`, `resources.course_key`), never the typed text, so even a legacy row stored
  in another style still matches.
- **Entry time** - the Settings, Profile and Upload forms suggest the spellings already in use
  (`GET /api/meta/options`). Anything can still be typed (new departments must be possible).

To teach it a new shorthand, add it to `DEPARTMENT_ALIASES` in `academic.js` (and add a test line).

## Project layout

```
src/
  index.js            Hono app entry, CORS, route mounting, error handling, cron
  routes/ controllers/ services/ middleware/ jobs/
  utils/              academic.js (canonical data), pagination.js, resourceFilters.js, rejectionReasons.js, ...
  db/schema.sql       Schema for a BRAND-NEW database (not re-runnable on an existing one)
  db/migrations/      One file per change for an EXISTING database (apply in order; 007 is the latest)
Frontend/             Static pages (deployed on Vercel); academic.js is shared by Resources/Lecture Notes/Upload/Settings
test/                 run-all.mjs, mockD1.js, *.test.js
docs/archive/         Old phase patches and notes (history only)
```
