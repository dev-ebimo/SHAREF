# Sharef API — Cloudflare Workers + D1

Phase 1–2 of the migration: project skeleton, schema, and a verified D1
binding. Auth and the rest of the routes come in the next phase.

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
  (preview generation is lazy — first-view-computes-and-caches, not eager at upload)
- Resource CRUD (read side): list/search with filters+pagination, my-uploads, get-by-id
- Resource upload: Cloudinary (signed REST upload, no SDK), page counting, PDF/DOCX/PPTX
  preview extraction (`pdf-parse` swapped for `unpdf`)
- Wallet + Paystack: balance, fund/initialize, fund/verify, webhook (HMAC-SHA512 signature
  check via Web Crypto), charge-for-download — every balance change uses a single atomic
  conditional `UPDATE` rather than a separate read-check-write, closing race windows the
  original had (double-credit on verify+webhook both firing, and a balance race on
  simultaneous downloads)
- Admin moderation: queue (with Lagos-timezone "today" stats), approve/reject (atomic
  status guard — closes a double-approve/duplicate-notification bug the original had),
  admin full-document preview (aware of the new `preview_type: 'pending'` state, which
  didn't exist in the original app), pending-count badge
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

**The entire backend is now code-complete — every route from all 12 of the original
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

Run all tests:
```
node --experimental-sqlite test/auth.test.js
node --experimental-sqlite test/phase4a.test.js
node --experimental-sqlite test/phase4b.test.js
node --experimental-sqlite test/phase4c.test.js
node --experimental-sqlite test/phase4d.test.js
node --experimental-sqlite test/phase4e-i.test.js
node --experimental-sqlite test/phase4e-ii.test.js
node --experimental-sqlite test/phase4e-iii.test.js
node --experimental-sqlite test/phase4f.test.js
```

## Project layout

```
src/
  index.js          Hono app entry, CORS, route mounting, error handling
  routes/            (empty for now — filled in during the auth slice)
  middleware/         "
  utils/               "
  db/schema.sql       The validated D1 schema
test/
  mockD1.js          Dev-only D1 mock (real SQLite) for testing without wrangler
  skeleton.test.js   Verifies the app boots, D1 binding works, CORS behaves
```

Run the test file directly with `node --experimental-sqlite test/skeleton.test.js`.
