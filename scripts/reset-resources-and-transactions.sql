-- ============================================================================
-- ONE-TIME CLEAN-UP: removes test RESOURCES and TRANSACTIONS, keeps EVERY user account.
-- DESTRUCTIVE. Save a Time Travel bookmark first. Do NOT run this once real money / real uploads exist.
--
--   npx wrangler d1 execute sharef-db --remote --file=./scripts/reset-resources-and-transactions.sql
--
-- REMOVES: resources, upload permits, transactions, downloads, bookmarks, resource notifications,
--          reward history (ledger, flags, audit log), requests (bounties), referral reward records.
-- KEEPS:   all users exactly as they are (name, email, password, matric, department, level, role, status,
--          verification, preferences, referral code...), announcements, deleted-account records,
--          and the incentive program settings.
-- RESETS:  every user's wallet_balance, reward_balance and reward_pending to 0. Those balances were built
--          from the test transactions being deleted; leaving them would be money with no history.
-- Does NOT touch Cloudinary (delete the test files there AFTER this runs) or Paystack.
-- ============================================================================

DELETE FROM incentive_flags;
DELETE FROM reward_ledger;
DELETE FROM referrals;
DELETE FROM bounties;
DELETE FROM download_logs;
DELETE FROM bookmarks;
DELETE FROM notifications WHERE resource_id IS NOT NULL;
DELETE FROM upload_intents;
DELETE FROM transactions;
DELETE FROM resources;

-- The reward audit log is append-only (triggers block DELETE): lift the trigger, empty it, put it back.
DROP TRIGGER IF EXISTS incentive_audit_no_delete;
DELETE FROM incentive_audit;
CREATE TRIGGER incentive_audit_no_delete BEFORE DELETE ON incentive_audit
BEGIN SELECT RAISE(ABORT, 'incentive_audit is append-only'); END;

UPDATE users SET wallet_balance = 0, reward_balance = 0, reward_pending = 0;
