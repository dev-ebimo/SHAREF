-- ============================================================================
-- Save point 3 — direct-to-Cloudinary uploads + review-time page counting
-- Run ONCE against the existing production database (after 001 and 002):
--   npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/003_direct_uploads.sql
-- Deploy this BEFORE (or together with) the new code.
-- ============================================================================
CREATE TABLE IF NOT EXISTS upload_intents (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_id        TEXT NOT NULL UNIQUE,
  file_name        TEXT NOT NULL,
  file_extension   TEXT NOT NULL,
  declared_size    INTEGER NOT NULL,
  metadata         TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_intents_user    ON upload_intents (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_upload_intents_expires ON upload_intents (expires_at);

-- Resources that were approved while their text preview was still "pending"
-- (it used to be computed lazily on a student's first view, inside the
-- Worker) can no longer be computed on demand. Settle them as "no preview"
-- rather than leaving them in a state nothing resolves.
UPDATE resources
   SET preview_type = 'none',
       preview_message = 'A text preview isn''t available for this file.'
 WHERE preview_type = 'pending' AND status = 'approved';
