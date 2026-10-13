-- ============================================================================
-- Save point 6 — browser-side compression + compression-proof duplicate detection
-- Run ONCE against the existing production database (after 005):
--   npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/006_content_fingerprint.sql
-- Deploy this BEFORE (or together with) the new code.
--
-- Why: uploads are now shrunk in the student's browser before they reach Cloudinary, so the
-- stored file's SHA-256 (file_hash) is no longer the same for two uploads of the same original
-- (different browsers encode images differently). `content_fp` is a second fingerprint that does
-- NOT change when images are recompressed. It is computed by the ADMIN's browser at review time
-- from the file that is actually stored - never supplied by the uploader - so it cannot be forged.
--   ooxml1:<sha256>   docx/pptx: hash of every part except embedded media
--   pdftext1:<sha256> pdf: hash of the normalised text of the document (+ page count)
--
-- original_size_bytes is INFORMATIONAL ONLY (the size before compression, as reported by the
-- uploader's browser). It is never used for any decision, so it does not need to be trustworthy.
-- ============================================================================
ALTER TABLE resources ADD COLUMN content_fp TEXT;
ALTER TABLE resources ADD COLUMN original_size_bytes INTEGER;
CREATE INDEX IF NOT EXISTS idx_resources_content_fp ON resources (content_fp) WHERE content_fp IS NOT NULL;
ALTER TABLE upload_intents ADD COLUMN original_size INTEGER;
