-- ============================================================================
-- Save point 2 — security hardening
-- Run ONCE against the existing production database (after 001):
--   npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/002_security_hardening.sql
-- Deploy this BEFORE (or together with) the new code — the new code reads
-- these columns. (Re-running fails with "duplicate column name"; that is safe.)
-- ============================================================================

-- Per-OTP wrong-guess counters (cap enforced in the database, so it holds
-- across Cloudflare isolates, unlike the in-memory rate limiter).
ALTER TABLE users ADD COLUMN verification_otp_attempts   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN reset_password_otp_attempts INTEGER NOT NULL DEFAULT 0;

-- Per-account login throttle.
ALTER TABLE users ADD COLUMN failed_logins  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN lockout_until  TEXT;

-- Tokens issued before this instant are rejected (set on password change/reset).
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

-- Any OTP currently stored in plaintext (6 digits) is discarded: new code
-- stores only an HMAC. Affected users simply tap "Resend code".
UPDATE users SET verification_otp = NULL, verification_otp_expires = NULL
 WHERE verification_otp IS NOT NULL AND length(verification_otp) <= 6;
UPDATE users SET reset_password_otp = NULL, reset_password_otp_expires = NULL
 WHERE reset_password_otp IS NOT NULL AND length(reset_password_otp) <= 6;
