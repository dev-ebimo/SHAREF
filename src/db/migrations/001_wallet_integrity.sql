-- ============================================================================
-- Save point 1 — wallet integrity
-- Run ONCE against the existing production database:
--   npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/001_wallet_integrity.sql
--
-- What it does: guarantees a user can never have two *successful purchase*
-- rows for the same resource. This is what makes concurrent double-clicks on
-- "Download" safe — the second request's batch hits this index, rolls back
-- (including its balance deduction) and is treated as "already owned".
--
-- BEFORE running, check your migrated data has no duplicates (the index
-- creation fails if it does):
--
--   SELECT user_id, resource_id, COUNT(*) AS n
--   FROM transactions
--   WHERE type = 'purchase' AND status = 'successful'
--     AND user_id IS NOT NULL AND resource_id IS NOT NULL
--   GROUP BY user_id, resource_id HAVING n > 1;
--
-- If that returns rows, tell me and we'll decide how to reconcile them
-- (don't delete financial rows blindly).
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_one_purchase_per_resource
  ON transactions (user_id, resource_id)
  WHERE type = 'purchase' AND status = 'successful'
    AND user_id IS NOT NULL AND resource_id IS NOT NULL;
