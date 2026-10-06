# Go-live checklist

Everything in `src/` is tested against mocks and real SQLite — but never
against your real MongoDB, Cloudflare account, Paystack, Cloudinary, or
SendGrid, because those need your credentials. The riskiest remaining pieces
are the ones that live *outside* the code, so they're written down here in
the order to do them.

## 0. Rehearse locally first (touches nothing in production)

Because the CORS allow-list already includes `http://localhost:5000`, you can
run the whole stack on your own machine against a snapshot of your real data:

1. Copy `.dev.vars.example` to `.dev.vars` and fill it in. **Use Paystack TEST
   keys.**
2. `npm run db:migrate:local` (creates the schema in a local D1).
3. Run the export (see `scripts/migrate/README.md`), then load it *locally* —
   note **no `--remote`**:
   `npx wrangler d1 execute sharef-db --local --file=scripts/migrate/migration-data.sql`
4. `npm run dev` (Worker on `http://localhost:8787`).
5. In a *scratch copy* of the frontend, set `API_BASE` to
   `http://localhost:8787/api` and serve it on port 5000.
6. Run the smoke test at the bottom of this file.

## 1. Configure the Worker

- **Secrets** (`npx wrangler secret put <NAME>`): `JWT_SECRET`,
  `PAYSTACK_SECRET_KEY`, `SENDGRID_API_KEY`, `CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Copy the values from your
  Render service's Environment tab.
- **Vars** (in `wrangler.toml`): set `FRONTEND_URL` to your real Vercel URL
  and `SENDGRID_FROM_EMAIL` to a sender you've verified in SendGrid.
  - If `SENDGRID_FROM_EMAIL` is wrong, **no email will ever send and nothing
    will tell you** — email sends are deliberately fire-and-forget, so failures
    are only logged. This is why "verification email arrives" is in the smoke
    test.
- **`JWT_SECRET` decides whether people stay logged in.** Token shape and
  algorithm (HS256, `{id, role, iat, exp}`) match the original. Reuse Render's
  exact `JWT_SECRET` and existing sessions keep working across the cutover.
  Use a different one and everyone is logged out once and must sign in again —
  not harmful, just worth choosing deliberately.

## 2. Deploy the Worker and note its URL

`npm run deploy`. The URL will be
`https://sharef-api.<your-workers-subdomain>.workers.dev`.

## 3. Update Paystack's webhook URL — easy to forget, involves money

In your Paystack dashboard's API/webhook settings, the webhook URL currently
points at Render. Change it to
`https://sharef-api.<your-subdomain>.workers.dev/api/wallet/webhook`.

If you skip this, deposits made after cutover are still credited *if the user
returns to the payment-callback page* (that path calls verify directly) — but
anyone who pays and then closes the tab never gets credited, because the
webhook is what covers that case.

## 4. Migrate the data

Follow `scripts/migrate/README.md`. Sequencing matters:

- **Data freshness.** The export is a snapshot. Anything written to Render
  after you export (signups, deposits, purchases, uploads) isn't in it. Since
  every statement is `INSERT OR REPLACE`, you can safely re-export and
  re-apply *right before* flipping the frontend to catch up. Do the final sync
  and the flip in one sitting, at a quiet time.
- **Never re-run the migration after the flip.** Once the frontend points at
  the Worker, D1 holds the live data and MongoDB is stale. Re-applying the
  export would overwrite real balances and accounts with old ones.
- **Never commit `migration-data.sql`.** It contains every user's email,
  password hash, and financial history. `.gitignore` covers it — don't
  override that.

## 5. Flip the frontend

Set `API_BASE` in `Frontend/api-config.js` to the Worker URL (ends in `/api`),
commit, push. Vercel auto-deploys on push, so **this push is the cutover
moment** — do it last, after everything above is verified.

## 6. Smoke test (do this locally in step 0, and again against production)

- [ ] Register a new account → **the verification email actually arrives**
- [ ] Verify with the code, log in
- [ ] Log in with an existing migrated account (proves password hashes carried over)
- [ ] Fund the wallet with a small real amount → balance updates
- [ ] Download a resource → correct amount deducted, file downloads with a sensible filename
- [ ] Upload a small PDF → appears for admin review (this exercises the direct-to-Cloudinary permit/complete flow)
- [ ] As admin: open the review → page count is detected and prefilled; approve it → uploader gets a notification
- [ ] Open the approved resource's preview as a student
- [ ] Admin pages: users list, transactions summary, announcements

## Rollback — and its honest limit

Rolling back is one line: point `API_BASE` back at Render. But **anything
written to D1 after the flip** (new signups, deposits, purchases) does not
exist in MongoDB, so a rollback silently drops it. A quick rollback (minutes,
before meaningful activity) is clean; a late one is not, and would need a
manual reverse-sync. This is the main reason to run the smoke test
thoroughly *before* pushing the frontend change.

## Known ceilings (documented in README.md, restated for planning)

- Announcement emails: the Workers free plan allows ~50 subrequests per
  request, so emailing more than roughly 50 students in one announcement
  will fail partway through. Fine at small scale; needs a queue later.
- The Worker does no file parsing: uploads go browser → Cloudinary, and page counting /
  preview extraction run in the reviewing admin's browser. Watch the Workers dashboard
  (Metrics → CPU time) after real traffic to confirm requests stay under the 10 ms cap.
