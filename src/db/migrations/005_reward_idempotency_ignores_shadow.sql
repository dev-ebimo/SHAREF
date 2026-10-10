-- ============================================================================
-- Save point 5 — shadow-mode rows must not block a real payment
-- Run ONCE after 004 (safe to run on a DB where no rewards exist yet):
--   npx wrangler d1 execute <db> --remote --file=./src/db/migrations/005_reward_idempotency_ignores_shadow.sql
--
-- The one-reward-per-(resource, student, tier) rule exists to stop double payment. Shadow rows
-- never move money, so they must not occupy that slot: otherwise an upload approved during the
-- shadow week, then restored and re-approved after going live, could never be paid.
-- ============================================================================
DROP INDEX IF EXISTS idx_reward_ledger_once;
CREATE UNIQUE INDEX idx_reward_ledger_once
  ON reward_ledger (resource_id, user_id, tier) WHERE type = 'reward' AND resource_id IS NOT NULL AND status != 'shadow';
