# Sharef update: Phase 2 (rewards plumbing, program ships OFF)

Apply **on top of Phase 1**. `index.js` here already contains the Phase 1 routes.

## Deploy order
1. **Back up D1, then run the migration** (additive: every new column has a default, nothing is altered or dropped):
   `npx wrangler d1 execute <db> --remote --file=./src/db/migrations/004_incentives.sql`
   then, optionally and separately (so a trigger-parsing hiccup can't block the main migration):
   `npx wrangler d1 execute <db> --remote --file=./src/db/migrations/004b_incentive_audit_triggers.sql`
2. Deploy the backend (files in this zip; `phase2.patch` is the same change as a diff).
3. Deploy the frontend zip (it now also sends a file hash when a moderator approves).

The seeded status is **off**. While off, students and moderators see no difference: every student `/incentives`
endpoint except `/config` answers 403 "not open yet", the moderation queue and My Uploads are byte-identical to
before, and nothing is paid or recorded as a reward.

## What Phase 2 adds
- **Schema:** reward balances on `users`; `incentive_config` (one row), `bounties`, `referrals`, `reward_ledger`,
  `incentive_flags`, `incentive_audit` (append-only via triggers); `resources.file_hash/bounty_id`; `transactions.from_rewards`.
- **All 13 `/api/admin/incentives/*` endpoints** and **all 4 `/api/incentives/*` student endpoints**.
- **Reversal engine** (used by "Reverse" and by flag "Reverse all"): one atomic batch per reward; safe against double-clicks and two moderators racing.
- **Silent data capture** so Phase 3 has history: a request id on uploads (validated), `file_hash` at approval,
  a salted IP hash at signup, referral links + `signed_up → verified`.
- **Moderation queue** gets `bounty` and `uploaderRisk` (only when status is not off); approve accepts `rewardTier`/`rewardNote`/`fileHash` (validated, not yet paid).
- **My Uploads** gets the `reward` chip (live/paused only).
- **Account/resource deletion cascades** for the new tables (see below, this one matters).

## Verified here
`node --experimental-sqlite test/phase6b-incentives-{student,admin,hooks}.test.js`: **213 checks pass** (38 + 100 + 75),
plus 29 from Phase 1, running the real controllers against the real `schema.sql` in SQLite. The migration was also run
on a populated copy of your *original* schema and produces identical columns to a fresh install.
Two control experiments confirm the cascade edits are required: with the **original** deletion code, deleting an
account or resource that has reward rows fails with a foreign-key error.
**Not verified:** the Hono router wiring/middleware (I can't install Hono offline), your 14 existing test files, real zod
validation rules (stubbed in my sandbox; fixtures were checked against your real schema by reading it), and nothing was
tried in a browser. Please run your full suite, especially `auth`, `phase4e-*` (deletion) and `phase5a-payments`.

## Contract differences between the guide and the frontend code (I followed the code)
1. `POST /requests` (publish a request) sends **no `reason`**, although the guide says every write needs one. Required everywhere else; optional here.
2. `POST /flags/:id/resolve` sends the reason as **`note`**. (`reason` is accepted as a fallback.)
3. `/flag-count` returns **`flagsOpen`**, and `/summary` also uses `flagsOpen`.
4. The weekly cap is a **rolling 7 days** (guide §6.2); the leaderboard/challenge use **Monday 00:00 Lagos** (§6.7). The guide mixes these; the Earn page labels the cap "this week". Say if you'd rather the cap reset on Monday.

## Decisions to confirm
- **`reward_balance` has no `>= 0` check:** a reversal after the student spent it makes it negative (which blocks downloads until they top up). `reward_pending` keeps its check.
- **Rules are validated strictly:** whole naira only, hold ≤ 30 days, share ≤ 100%, every field required; tiers above "largest single payout" are **capped** and the cap is written to the audit log. Defaults are inert (all rewards ₦0, budget ₦0), and **going live is refused until a monthly budget is set**.
- **`signup_ip_hash`** is SHA-256 of the IP salted with `JWT_SECRET`, truncated to 128 bits. It's only for spotting referral rings. **Rotating `JWT_SECRET` makes old and new hashes incomparable.** You may want a line about this in your privacy notice.
- **Unique index** `(resource, user, tier)` on rewards means the same student can never be paid twice for the same resource/tier, even if approval is retried. A reversed reward also blocks re-paying that same pair.
- **Admin summary** counts shadow rows toward "paid this month" only while status is `shadow`.
- A stale or wrong request id on an upload is **silently dropped** (the upload still goes through); the payout step will re-check it.

## Known limits
- `reverse_all` works in chunks of 15 rewards per atomic batch. If a later chunk fails, the flag stays open and the action is safe to re-run (already-reversed rows are skipped).
- `/summary` scans `users` once for the "owed to students" total; fine now, worth a cached counter if you pass ~100k users.
- Referral **codes** are created the first time a student opens Earn while the program is live/paused, so referrals can't be captured before launch.

## Phase 3 (next): the part that moves money
Payout engine inside `approve` (shadow first, then live; weekly cap, monthly budget, per-moderator limit, first-upload bonus,
bounty payment, duplicate check via `file_hash`, `rewardPreview`), the **charge split** (rewards + funded cash, `maxRewardShare`)
together with `/wallet/balance` = funded + rewards, hourly clearing and daily flag-detection cron jobs (needs a `[triggers] crons` block),
admin transaction list showing `reward`/`reward_reversal` as virtual types, referral payouts, a safe default for quick-approve from the notification panel, and then removing `continue-learning`.
