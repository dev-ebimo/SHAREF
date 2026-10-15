-- ============================================================================
-- Save point 7 - consistent academic data + real "last active" tracking
-- Run ONCE against the existing production database (after 006):
--   npx wrangler d1 execute sharef-db --remote --file=./src/db/migrations/007_academic_consistency.sql
-- Deploy this BEFORE (or together with) the new code - the new code reads these columns.
-- (Re-running fails with "duplicate column name"; that is safe.)
--
-- What it does
--   * users.department_key / resources.department_key / resources.course_key: the COMPARISON form of the
--     hand-typed department and course. Every filter, search, "for your department" match and announcement
--     target now compares these instead of the raw text, so "computer science", "Computer  Science" and
--     "Computer Science Dept." are all the same department.
--   * users.last_active_at: the admin "inactive" status used to mean "has not LOGGED IN for 7 days", but a login
--     lasts 7 days, so a student using the site every day looked inactive. Activity is now tracked.
--
-- The UPDATEs below are a best-effort backfill done in plain SQL (SQLite has no regex), so the site works the
-- moment this has run. For the exact, final result also run the one-off normaliser (it re-computes every key with
-- the application's own rules and tidies the stored spelling of departments, courses, matric numbers and
-- sessions):   POST /api/admin/maintenance/normalize-academic-data   (see CHANGES-CONSISTENCY.md).
-- ============================================================================
ALTER TABLE users ADD COLUMN department_key TEXT;
ALTER TABLE users ADD COLUMN last_active_at TEXT;
ALTER TABLE resources ADD COLUMN department_key TEXT;
ALTER TABLE resources ADD COLUMN course_key TEXT;

UPDATE resources SET department_key = trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(trim(department)),'&',' and '),'.',' '),'/',' '),'-',' '),',',' '),'_',' '),'(',' '),')',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')) WHERE department IS NOT NULL;
UPDATE resources SET course_key = replace(replace(replace(replace(replace(upper(course),' ',''),'-',''),'.',''),'_',''),'/','') WHERE course IS NOT NULL;
UPDATE users SET department_key = trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(trim(department)),'&',' and '),'.',' '),'/',' '),'-',' '),',',' '),'_',' '),'(',' '),')',' '),'  ',' '),'  ',' '),'  ',' '),'  ',' ')) WHERE department IS NOT NULL AND trim(department) != '';

UPDATE resources SET department_key = substr(department_key, 1, length(department_key) - 11) WHERE department_key LIKE '% department';
UPDATE resources SET department_key = substr(department_key, 1, length(department_key) - 5) WHERE department_key LIKE '% dept';
UPDATE resources SET department_key = substr(department_key, 15) WHERE department_key LIKE 'department of %';
UPDATE resources SET department_key = substr(department_key, 9) WHERE department_key LIKE 'dept of %';
UPDATE users SET department_key = substr(department_key, 1, length(department_key) - 11) WHERE department_key LIKE '% department';
UPDATE users SET department_key = substr(department_key, 1, length(department_key) - 5) WHERE department_key LIKE '% dept';
UPDATE users SET department_key = substr(department_key, 15) WHERE department_key LIKE 'department of %';
UPDATE users SET department_key = substr(department_key, 9) WHERE department_key LIKE 'dept of %';

-- Treat the last login as the last known activity until real activity is recorded.
UPDATE users SET last_active_at = last_login_at WHERE last_active_at IS NULL AND last_login_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_department_key ON users (department_key) WHERE department_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resources_status_deptkey ON resources (status, department_key);
CREATE INDEX IF NOT EXISTS idx_resources_status_coursekey ON resources (status, course_key);
