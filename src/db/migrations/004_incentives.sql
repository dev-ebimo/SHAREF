-- ============================================================================
-- Save point 4 — incentive program data model (program ships switched OFF)
-- Run ONCE against the existing production database (after 001, 002, 003):
--   npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/004_incentives.sql
-- Then (optional, separate file so a trigger-parsing hiccup can never block this one):
--   npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/004b_incentive_audit_triggers.sql
-- Deploy this BEFORE (or together with) the new code. It is purely additive:
-- every new column has a default, nothing existing is altered or dropped.
-- ============================================================================

ALTER TABLE users ADD COLUMN reward_balance REAL NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN reward_pending REAL NOT NULL DEFAULT 0 CHECK (reward_pending >= 0);
ALTER TABLE users ADD COLUMN rewards_frozen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN referred_by TEXT;
ALTER TABLE users ADD COLUMN signup_ip_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_signup_ip_hash ON users (signup_ip_hash) WHERE signup_ip_hash IS NOT NULL;

ALTER TABLE resources ADD COLUMN file_hash TEXT;
ALTER TABLE resources ADD COLUMN bounty_id TEXT;
CREATE INDEX IF NOT EXISTS idx_resources_file_hash ON resources (file_hash) WHERE file_hash IS NOT NULL;

ALTER TABLE transactions ADD COLUMN from_rewards REAL NOT NULL DEFAULT 0;

-- ----------------------------------------------------------------------------
-- Incentive program (see BACKEND_INTEGRATION.md in the update package)
--   status 'off' (the default) = nothing observable changes for students or moderators.
-- ----------------------------------------------------------------------------

-- Single-row settings table (id is forced to 1). `rules` is a JSON object of the
-- numeric limits and reward amounts; the app merges it over safe defaults.
CREATE TABLE IF NOT EXISTS incentive_config (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  status           TEXT NOT NULL DEFAULT 'off' CHECK (status IN ('off','shadow','live','paused')),
  rules            TEXT NOT NULL DEFAULT '{}',
  season_name      TEXT,
  season_ends_at   TEXT,
  updated_by       TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO incentive_config (id, status, rules) VALUES (1, 'off', '{}');

-- Requests ("Wanted") that pay a fixed reward for a specific missing resource.
CREATE TABLE IF NOT EXISTS bounties (
  id            TEXT PRIMARY KEY,
  course        TEXT NOT NULL,                    -- as displayed, e.g. 'CSC 305'
  course_key    TEXT NOT NULL,                    -- normalised for matching: upper-case, letters+digits only ('CSC305')
  type          TEXT NOT NULL CHECK (type IN ('Past Questions','Lecture Notes','Revision Sheet')),
  level         TEXT NOT NULL,                    -- '300 Level'
  reward        REAL NOT NULL CHECK (reward > 0),
  max_payouts   INTEGER NOT NULL DEFAULT 1 CHECK (max_payouts BETWEEN 1 AND 3),
  paid          INTEGER NOT NULL DEFAULT 0,
  note          TEXT NOT NULL DEFAULT '',
  expires_at    TEXT NOT NULL,                    -- ISO8601 (end of the chosen day, Africa/Lagos)
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','fulfilled')),  -- 'expired' is derived from expires_at
  created_by    TEXT,                             -- admin id (no FK: an admin deleting their account must not fail)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bounties_status_expires ON bounties (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_bounties_course_key ON bounties (course_key);

-- Referral relationships. One inviter per invitee. Statuses move signed_up -> verified -> contributed.
CREATE TABLE IF NOT EXISTS referrals (
  id          TEXT PRIMARY KEY,
  inviter_id  TEXT NOT NULL REFERENCES users(id),
  invitee_id  TEXT NOT NULL UNIQUE REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'signed_up' CHECK (status IN ('signed_up','verified','contributed')),
  earned      REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals (inviter_id, created_at DESC);

-- Every reward and every reversal. Reversals are separate NEGATIVE rows so history is never rewritten.
-- user_id / resource_id are nullable for the same reason as transactions: financial history
-- must outlive a deleted account or resource (see deleteMyAccount / permanentlyDeleteResource).
CREATE TABLE IF NOT EXISTS reward_ledger (
  id               TEXT PRIMARY KEY,
  user_id          TEXT REFERENCES users(id),
  type             TEXT NOT NULL CHECK (type IN ('reward','reversal')),
  amount           REAL NOT NULL,                 -- reversals are negative
  status           TEXT NOT NULL CHECK (status IN ('pending','cleared','reversed','shadow')),
  tier             TEXT CHECK (tier IS NULL OR tier IN ('bounty','standard','high','rare','first','referral','challenge')),
  label            TEXT NOT NULL DEFAULT '',
  resource_id      TEXT REFERENCES resources(id),
  bounty_id        TEXT,
  referral_id      TEXT,
  approved_by      TEXT,                          -- admin id (no FK)
  note             TEXT NOT NULL DEFAULT '',
  clears_at        TEXT,                          -- when a pending reward becomes spendable
  reversed_at      TEXT,
  reversed_by      TEXT,
  reversal_reason  TEXT NOT NULL DEFAULT '',
  reverses_id      TEXT,                          -- on a reversal row: the reward it cancels
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_user_created ON reward_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_status_clears ON reward_ledger (status, clears_at);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_created ON reward_ledger (created_at);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_approver ON reward_ledger (approved_by, created_at);
-- Idempotency: the same student can never be paid twice for the same resource and tier,
-- however many times an approval is retried, re-approved, or raced.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_ledger_once
  ON reward_ledger (resource_id, user_id, tier) WHERE type = 'reward' AND resource_id IS NOT NULL;
-- A reward can be reversed at most once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_ledger_one_reversal
  ON reward_ledger (reverses_id) WHERE reverses_id IS NOT NULL;

-- Fraud signals raised by the nightly job (Phase 3) and resolved by a moderator.
CREATE TABLE IF NOT EXISTS incentive_flags (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  signals      TEXT NOT NULL DEFAULT '[]',        -- JSON array of plain-English lines
  exposure     REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','frozen','reversed')),
  note         TEXT NOT NULL DEFAULT '',
  resolved_by  TEXT,
  resolved_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_incentive_flags_status ON incentive_flags (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incentive_flags_user ON incentive_flags (user_id);

-- Append-only record of every consequential admin action. admin_name is a snapshot so
-- the log stays readable after an account is deleted; admin_id is NULL for system events.
CREATE TABLE IF NOT EXISTS incentive_audit (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT,
  admin_name  TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_incentive_audit_created ON incentive_audit (created_at DESC);
