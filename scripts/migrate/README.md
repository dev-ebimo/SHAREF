# MongoDB → D1 data migration

A one-time script. Reads every collection from your live MongoDB (read-only),
transforms each document into the D1 schema's shape, and writes a single,
reviewable `.sql` file — it does not touch D1 directly itself.

Kept as its own package, separate from the Worker (`../../package.json`) —
the `mongodb` driver is a heavy, Node-specific dependency with no reason to
be bundled into a Workers deployment.

## Prerequisites

- The D1 database already created and the schema already applied (see the
  main project README's "First-time setup").
- Your production `MONGODB_URI` connection string.
- `npx wrangler login` already done (or `CLOUDFLARE_API_TOKEN` set).

## Running it

```bash
cd scripts/migrate
npm install

MONGODB_URI='mongodb+srv://...' npm run export
```

This connects **read-only** in spirit (it only ever calls `.find()`, never
writes to MongoDB) and writes `migration-data.sql` in this directory. It
does not touch D1. Nothing is applied until you explicitly run the next
step.

The script prints a per-collection row count when it finishes — keep that
output, you'll compare it against `verify.sql`'s counts in a moment.

## Before applying: actually read the file

`migration-data.sql` is plain, readable SQL — every row is its own
`INSERT OR REPLACE` statement, in the same order as your MongoDB
collections. Skim it. This is real production data about to be written to
a new database; a five-minute read is cheap insurance.

## Applying it

```bash
npx wrangler d1 execute sharef-db --remote --file=migration-data.sql
```

`--remote` targets your actual production D1 database — this is the real
cutover, not a local dry run. If you want to sanity-check against a local
D1 instance first, drop `--remote` (and make sure you've run the local
schema migration from the main README first).

## Verifying

```bash
npx wrangler d1 execute sharef-db --remote --file=verify.sql
```

Every "orphaned" count in the output should be `0`. The row counts at the
bottom should match what `export.js` printed per collection. If anything's
off, see "Troubleshooting" below before pointing the frontend at this
database.

## Why FK enforcement is toggled off/on around the import

`export.js`'s generated file wraps everything in
`PRAGMA foreign_keys = OFF; ... PRAGMA foreign_keys = ON;`. This is a
standard bulk-load pattern: it means the insert order across tables
doesn't have to perfectly respect every foreign-key dependency (MongoDB
never enforced these relationships either, so there was never a
guarantee the source data satisfies them exactly), and any genuinely
orphaned reference in the real data gets caught explicitly by
`verify.sql` afterward — a clear report — rather than aborting the import
partway through with an opaque constraint-violation error.

## A deliberate data change: OTP fields are cleared

`transform.js`'s `transformUser` always writes `NULL` for
`verification_otp`, `verification_otp_expires`, `reset_password_otp`, and
`reset_password_otp_expires`, regardless of what's actually in the source
document. Anyone with an in-flight email-verification or password-reset
flow at the exact moment of migration will need to request a new code
after cutover — a one-time, low-stakes disruption traded for not carrying
forward stale, unencrypted verification codes into the new system. If you'd
rather preserve them, remove that override in `transform.js`.

## Re-running safely — and when NOT to

Every statement is `INSERT OR REPLACE`, keyed by the row's original
MongoDB `_id` (which is also YOUR row's `id` — see the main README's
schema notes for why TEXT primary keys were chosen). Running `export.js`
again and re-applying the result overwrites existing rows with fresh data
rather than erroring on a duplicate key — safe to re-run after fixing a
problem, or to re-sync right before the actual frontend cutover if time
passed between your first export and going live.

**The dangerous direction: never re-apply after the cutover.** The moment the
frontend points at the Worker, D1 holds the live data and MongoDB is the stale
copy. `INSERT OR REPLACE` doesn't know that — re-applying an export then would
overwrite real, current wallet balances, accounts, and transactions with old
values. Treat the flip as one-way for this script.

**Never commit the output.** `migration-data.sql` contains every user's email,
bcrypt password hash, and full financial history. The project `.gitignore`
excludes it; since your repos auto-deploy from GitHub, don't override that.
Delete the file once the migration is verified.

## Rollback

Nothing on the Render/MongoDB side is touched by any of this — the export
is read-only. If something looks wrong after applying and verifying,
simply don't cut the frontend over to the Workers API yet; the original
backend keeps working exactly as before. To retry cleanly, either fix the
issue and re-run (safe, per above), or manually clear the D1 tables
(`DELETE FROM <table>;` for each, children before parents) and re-apply
from scratch.

## Testing

```bash
npm test
```

Runs two suites:
- `test/transform.test.js` — unit tests for every transform function
  against synthetic MongoDB-shaped documents, including the sparse/missing
  `preferences` case that's the main reason this migration is a tested
  script rather than a quick one-off (Mongoose applies schema defaults at
  read time, in the application layer — a raw driver query, used
  deliberately here instead of pulling in Mongoose, does not).
- `test/end-to-end.test.js` — generates real SQL from a realistic,
  cross-referenced synthetic dataset covering all 8 tables, executes it
  against the actual production `schema.sql`, runs the same integrity
  checks `verify.sql` does, and finally runs the migrated data through a
  real route in the actual app (`GET /api/bookmarks`) to confirm it's not
  just schema-valid but genuinely functional.

Neither suite needs a real MongoDB or D1 connection.
