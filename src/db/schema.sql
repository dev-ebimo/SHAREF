-- ============================================================================
-- Sharef — Cloudflare D1 schema
-- Direct relational translation of the 8 Mongoose models. IDs are kept as
-- TEXT and populated with the original MongoDB ObjectId hex strings during
-- migration, so every foreign key reference in existing data stays valid
-- with no id-remapping step.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- users  (models/User.js)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id                        TEXT PRIMARY KEY,
  full_name                 TEXT NOT NULL,
  email                     TEXT NOT NULL UNIQUE,
  password                  TEXT NOT NULL,
  matric_number             TEXT UNIQUE,                 -- sparse: NULLs don't collide, matches old unique+sparse index
  university                TEXT,
  faculty                   TEXT,
  department                TEXT,
  level                     TEXT CHECK (level IN ('100','200','300','400','500','600')),
  gender                    TEXT CHECK (gender IN ('Male','Female','Other')),
  community_survey          TEXT DEFAULT '',
  role                      TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
  wallet_balance             REAL NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
  account_status            TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','suspended','inactive')),
  last_login_at             TEXT,                         -- ISO8601
  suspension_reason         TEXT DEFAULT '',
  suspended_at              TEXT,
  is_verified               INTEGER NOT NULL DEFAULT 0,    -- 0/1 boolean
  verification_otp          TEXT,
  verification_otp_expires  TEXT,
  reset_password_otp        TEXT,
  reset_password_otp_expires TEXT,
  preferences               TEXT NOT NULL DEFAULT '{}',    -- JSON blob, see below
  -- Security columns (see migrations/002_security_hardening.sql)
  verification_otp_attempts   INTEGER NOT NULL DEFAULT 0,
  reset_password_otp_attempts INTEGER NOT NULL DEFAULT 0,
  failed_logins               INTEGER NOT NULL DEFAULT 0,
  lockout_until               TEXT,
  password_changed_at         TEXT,
  -- Incentive columns (see migrations/004_incentives.sql)
  reward_balance              REAL NOT NULL DEFAULT 0,       -- spendable rewards. NO >= 0 check: a reversal after the student spent it may legitimately go negative
  reward_pending              REAL NOT NULL DEFAULT 0 CHECK (reward_pending >= 0),  -- rewards still inside the hold period
  rewards_frozen              INTEGER NOT NULL DEFAULT 0,    -- 0/1: moderator froze this student's rewards
  referral_code               TEXT,                          -- unique (partial index below), created lazily
  referred_by                 TEXT,                          -- inviter's user id (informational, no FK so deletes stay simple)
  signup_ip_hash              TEXT,                          -- salted SHA-256 of the signup IP, for referral-ring detection only
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_users_role_lastlogin ON users (role, last_login_at DESC);
CREATE UNIQUE INDEX idx_users_referral_code ON users (referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX idx_users_signup_ip_hash ON users (signup_ip_hash) WHERE signup_ip_hash IS NOT NULL;

-- Default shape written into `preferences` for a brand-new user (app-layer
-- default, since SQLite's column DEFAULT can't express nested JSON structure):
-- {
--   "landingPage": "dashboard",
--   "moderation": {
--     "landingPage": "pending", "itemsPerPage": 25,
--     "autoOpenNext": true, "confirmBeforeApproval": false, "confirmBeforeRejection": true
--   },
--   "review": { "defaultSort": "oldest" },
--   "notifications": {
--     "uploadStatus": { "email": true, "inApp": true },
--     "announcements": { "email": true, "inApp": true }
--   }
-- }

-- ----------------------------------------------------------------------------
-- resources  (models/Resource.js)
-- ----------------------------------------------------------------------------
CREATE TABLE resources (
  id                         TEXT PRIMARY KEY,
  title                      TEXT NOT NULL,
  type                       TEXT NOT NULL CHECK (type IN
                               ('Lecture Note','Past Question','Assignment Material','Textbook','Revision Sheet','Other')),
  department                 TEXT NOT NULL,
  course                     TEXT NOT NULL,
  level                      TEXT NOT NULL CHECK (level IN ('100','200','300','400','500','600')),
  semester                   TEXT NOT NULL CHECK (semester IN ('First','Second')),
  session                    TEXT NOT NULL,                -- e.g. "2024/2025"

  uploader_id                TEXT NOT NULL REFERENCES users(id),

  file_name                  TEXT NOT NULL,
  file_url                   TEXT NOT NULL,
  cloudinary_public_id       TEXT NOT NULL,
  cloudinary_resource_type   TEXT NOT NULL DEFAULT 'raw' CHECK (cloudinary_resource_type IN ('raw','image')),
  preview_image_public_id    TEXT,
  preview_type               TEXT NOT NULL DEFAULT 'pending' CHECK (preview_type IN ('image','text','none','pending')),
  preview_snippet            TEXT NOT NULL DEFAULT '',
  preview_message            TEXT NOT NULL DEFAULT '',

  file_size_bytes            INTEGER NOT NULL,
  file_extension              TEXT NOT NULL,
  pages                      INTEGER NOT NULL DEFAULT 1,   -- placeholder (1) while pending; the REAL count is set by the admin at approval

  status                     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason           TEXT NOT NULL DEFAULT '',

  downloads                  INTEGER NOT NULL DEFAULT 0,

  reviewed_by                TEXT REFERENCES users(id),
  reviewed_at                TEXT,
  description                TEXT NOT NULL DEFAULT '',

  -- Incentive columns (see migrations/004_incentives.sql)
  file_hash                  TEXT,                          -- SHA-256 hex, computed in the moderator's browser at review time; used for duplicate detection
  bounty_id                  TEXT,                          -- the request (bounty) this upload answers, validated at upload time

  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_resources_file_hash ON resources (file_hash) WHERE file_hash IS NOT NULL;

-- ----------------------------------------------------------------------------
-- upload_intents — permits for direct browser -> Cloudinary uploads
-- ----------------------------------------------------------------------------
-- The Worker never touches file bytes (10 ms CPU limit on the free plan). It
-- issues a signed permit for ONE server-chosen public_id and remembers the
-- validated metadata here; POST /resources/upload/complete later verifies the
-- file really exists, then turns the intent into a `resources` row whose id
-- equals the intent id (so completing twice can never create two resources).
-- Rows that are never completed expire and are purged (with their Cloudinary
-- file) by jobs/purgeStaleUploads.js.
CREATE TABLE upload_intents (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_id        TEXT NOT NULL UNIQUE,
  file_name        TEXT NOT NULL,
  file_extension   TEXT NOT NULL,
  declared_size    INTEGER NOT NULL,
  metadata         TEXT NOT NULL,                     -- JSON: validated title/type/department/...
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL
);
CREATE INDEX idx_upload_intents_user    ON upload_intents (user_id, expires_at);
CREATE INDEX idx_upload_intents_expires ON upload_intents (expires_at);

-- Every one of these matches an existing Mongoose compound index 1:1.
CREATE INDEX idx_resources_status_created   ON resources (status, created_at DESC);
CREATE INDEX idx_resources_status_reviewed  ON resources (status, reviewed_at DESC);
CREATE INDEX idx_resources_status_dept      ON resources (status, department);
CREATE INDEX idx_resources_uploader_created ON resources (uploader_id, created_at DESC);
CREATE INDEX idx_resources_status_downloads ON resources (status, downloads DESC);
CREATE INDEX idx_resources_status_course    ON resources (status, course);

-- ----------------------------------------------------------------------------
-- transactions  (models/Transaction.js)
-- ----------------------------------------------------------------------------
CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,
  -- Nullable, not NOT NULL: when an account is deleted, its financial
  -- history is preserved (user_id set to NULL) rather than deleted along
  -- with it — same principle as resource_id below, which already survives
  -- a deleted resource. See userSettingsController.js's deleteMyAccount.
  user_id      TEXT REFERENCES users(id),
  type         TEXT NOT NULL CHECK (type IN ('deposit','purchase')),
  amount       REAL NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','successful','failed')),
  reference    TEXT UNIQUE,                    -- sparse-unique: SQLite treats each NULL as distinct, same as Mongo
  resource_id  TEXT REFERENCES resources(id),  -- only set for purchases
  description  TEXT NOT NULL DEFAULT '',
  from_rewards REAL NOT NULL DEFAULT 0,        -- portion of a purchase paid from reward balance (funded part = amount - from_rewards)
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_transactions_user_created     ON transactions (user_id, created_at DESC);
CREATE INDEX idx_transactions_user_type_status ON transactions (user_id, type, status);

-- A user can hold at most one successful purchase per resource. Makes the
-- charge flow race-safe: a concurrent duplicate purchase violates this index,
-- its whole batch (including the balance deduction) rolls back. See
-- migrations/001_wallet_integrity.sql for applying this to an existing DB.
CREATE UNIQUE INDEX idx_transactions_one_purchase_per_resource
  ON transactions (user_id, resource_id)
  WHERE type = 'purchase' AND status = 'successful'
    AND user_id IS NOT NULL AND resource_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- announcements  (models/Announcement.js)
-- ----------------------------------------------------------------------------
CREATE TABLE announcements (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  message             TEXT NOT NULL,
  target_departments  TEXT NOT NULL DEFAULT '[]',   -- JSON array; empty array = "everyone"
  target_levels       TEXT NOT NULL DEFAULT '[]',   -- JSON array; empty array = "everyone"
  -- Nullable: if the admin who created this later deletes their own
  -- account, the announcement itself is still real history worth keeping
  -- — only the attribution is lost, same reasoning as transactions.user_id above.
  created_by          TEXT REFERENCES users(id),
  recipient_count     INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ----------------------------------------------------------------------------
-- deleted_account_logs  (models/DeletedAccountLog.js)
-- Self-contained snapshot — deliberately has no FK to users, since the whole
-- point is this row survives after the user row is gone.
-- ----------------------------------------------------------------------------
CREATE TABLE deleted_account_logs (
  id                          TEXT PRIMARY KEY,
  full_name                   TEXT NOT NULL,
  email                       TEXT NOT NULL,
  matric_number                TEXT NOT NULL DEFAULT '',
  university                  TEXT NOT NULL DEFAULT '',
  department                  TEXT NOT NULL DEFAULT '',
  level                       TEXT NOT NULL DEFAULT '',
  account_status              TEXT NOT NULL DEFAULT 'active',
  joined_at                   TEXT,
  wallet_balance_at_deletion   REAL NOT NULL DEFAULT 0,
  uploads_count                INTEGER NOT NULL DEFAULT 0,
  total_deposited              REAL NOT NULL DEFAULT 0,
  total_spent                  REAL NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) -- doubles as "deletedAt"
);

-- ----------------------------------------------------------------------------
-- notifications  (models/Notification.js)
-- ----------------------------------------------------------------------------
CREATE TABLE notifications (
  id                     TEXT PRIMARY KEY,
  resource_id            TEXT REFERENCES resources(id),
  announcement_id        TEXT REFERENCES announcements(id),
  deleted_account_log_id TEXT REFERENCES deleted_account_logs(id),
  recipient_id           TEXT REFERENCES users(id),  -- NULL = shared admin feed
  type                   TEXT NOT NULL DEFAULT 'new_upload' CHECK (type IN
                           ('new_upload','resource_approved','resource_rejected','announcement','account_deleted')),
  unread                 INTEGER NOT NULL DEFAULT 1,  -- 0/1 boolean
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_notifications_recipient_created ON notifications (recipient_id, created_at DESC);
CREATE INDEX idx_notifications_recipient_unread  ON notifications (recipient_id, unread);

-- ----------------------------------------------------------------------------
-- bookmarks  (models/Bookmark.js)
-- ----------------------------------------------------------------------------
CREATE TABLE bookmarks (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  resource_id  TEXT NOT NULL REFERENCES resources(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, resource_id)   -- a user can only bookmark a resource once
);

-- ----------------------------------------------------------------------------
-- download_logs  (models/DownloadLog.js)
-- ----------------------------------------------------------------------------
CREATE TABLE download_logs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  resource_id  TEXT NOT NULL REFERENCES resources(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_downloadlogs_user_created     ON download_logs (user_id, created_at DESC);
CREATE INDEX idx_downloadlogs_user_resource    ON download_logs (user_id, resource_id);
CREATE INDEX idx_downloadlogs_created_resource ON download_logs (created_at DESC, resource_id);

-- ----------------------------------------------------------------------------
-- Incentive program (see BACKEND_INTEGRATION.md in the update package)
--   status 'off' (the default) = nothing observable changes for students or moderators.
-- ----------------------------------------------------------------------------

-- Single-row settings table (id is forced to 1). `rules` is a JSON object of the
-- numeric limits and reward amounts; the app merges it over safe defaults.
CREATE TABLE incentive_config (
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
CREATE TABLE bounties (
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
CREATE INDEX idx_bounties_status_expires ON bounties (status, expires_at);
CREATE INDEX idx_bounties_course_key ON bounties (course_key);

-- Referral relationships. One inviter per invitee. Statuses move signed_up -> verified -> contributed.
CREATE TABLE referrals (
  id          TEXT PRIMARY KEY,
  inviter_id  TEXT NOT NULL REFERENCES users(id),
  invitee_id  TEXT NOT NULL UNIQUE REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'signed_up' CHECK (status IN ('signed_up','verified','contributed')),
  earned      REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_referrals_inviter ON referrals (inviter_id, created_at DESC);

-- Every reward and every reversal. Reversals are separate NEGATIVE rows so history is never rewritten.
-- user_id / resource_id are nullable for the same reason as transactions: financial history
-- must outlive a deleted account or resource (see deleteMyAccount / permanentlyDeleteResource).
CREATE TABLE reward_ledger (
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
CREATE INDEX idx_reward_ledger_user_created ON reward_ledger (user_id, created_at DESC);
CREATE INDEX idx_reward_ledger_status_clears ON reward_ledger (status, clears_at);
CREATE INDEX idx_reward_ledger_created ON reward_ledger (created_at);
CREATE INDEX idx_reward_ledger_approver ON reward_ledger (approved_by, created_at);
-- Idempotency: the same student can never be paid twice for the same resource and tier,
-- however many times an approval is retried, re-approved, or raced.
CREATE UNIQUE INDEX idx_reward_ledger_once
  ON reward_ledger (resource_id, user_id, tier) WHERE type = 'reward' AND resource_id IS NOT NULL AND status != 'shadow';
-- A reward can be reversed at most once.
CREATE UNIQUE INDEX idx_reward_ledger_one_reversal
  ON reward_ledger (reverses_id) WHERE reverses_id IS NOT NULL;

-- Fraud signals raised by the nightly job (Phase 3) and resolved by a moderator.
CREATE TABLE incentive_flags (
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
CREATE INDEX idx_incentive_flags_status ON incentive_flags (status, created_at DESC);
CREATE INDEX idx_incentive_flags_user ON incentive_flags (user_id);

-- Append-only record of every consequential admin action. admin_name is a snapshot so
-- the log stays readable after an account is deleted; admin_id is NULL for system events.
CREATE TABLE incentive_audit (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT,
  admin_name  TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_incentive_audit_created ON incentive_audit (created_at DESC);

-- Makes the audit log tamper-evident: rows can be added but never changed or removed.
CREATE TRIGGER incentive_audit_no_update BEFORE UPDATE ON incentive_audit
BEGIN SELECT RAISE(ABORT, 'incentive_audit is append-only'); END;
CREATE TRIGGER incentive_audit_no_delete BEFORE DELETE ON incentive_audit
BEGIN SELECT RAISE(ABORT, 'incentive_audit is append-only'); END;
