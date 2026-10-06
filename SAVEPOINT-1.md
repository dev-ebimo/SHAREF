# Save point 1 — Payments

Overlay zip: unzip over your repo root (same relative paths). Only changed/new files are included.

## Deploy order
1. (Optional but recommended) run the duplicate check at the top of `src/db/migrations/001_wallet_integrity.sql`.
2. `npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/001_wallet_integrity.sql`
3. `npm run deploy`

Deploy the migration BEFORE (or together with) the code — the new charge flow relies on
the schema's `CHECK (wallet_balance >= 0)` (already in your schema) and the new unique index.

## What changed
- Charge: single atomic batch (deduct + purchase row + counter + log + read balance).
- Deposit settlement: single atomic batch; amount/user read from the recorded row, never from the caller.
- Verify/webhook compare Paystack's amount + currency + reference to what we recorded; mismatches are never credited and are flagged (description starts with "Flagged:").
- verify is scoped to the caller's own references; "still processing" payments are no longer wrongly marked failed (HTTP 202, success:false, pending:true).
- Webhook: constant-time signature check, rejects malformed signatures, acks unknown refs with 200, returns 500 only on real failures so Paystack retries.
- Funding: strict integer ₦100–₦500,000, random unguessable reference, failed Paystack init marks the row failed, 10 attempts / 10 min per user.
- Wallet endpoints no longer leak raw error messages.
