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
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_users_role_lastlogin ON users (role, last_login_at DESC);

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
  pages                      INTEGER NOT NULL DEFAULT 1,

  status                     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  rejection_reason           TEXT NOT NULL DEFAULT '',

  downloads                  INTEGER NOT NULL DEFAULT 0,

  reviewed_by                TEXT REFERENCES users(id),
  reviewed_at                TEXT,
  description                TEXT NOT NULL DEFAULT '',

  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

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
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_transactions_user_created     ON transactions (user_id, created_at DESC);
CREATE INDEX idx_transactions_user_type_status ON transactions (user_id, type, status);

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
