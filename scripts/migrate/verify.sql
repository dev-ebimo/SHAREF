-- Run this AFTER applying migration-data.sql, against the same database:
--   npx wrangler d1 execute sharef-db --remote --file=scripts/migrate/verify.sql
--
-- Every query below should return 0. A non-zero count means some row in
-- the source MongoDB data referenced an id that doesn't exist on the
-- other side of that relationship — worth investigating before trusting
-- the migration, since D1 had foreign-key enforcement OFF during the
-- import itself (see export.js) specifically so table order wouldn't
-- block the load, which also means a genuinely bad reference in the
-- source data would NOT have been caught at import time.

SELECT 'resources.uploader_id' AS relation, COUNT(*) AS orphaned
FROM resources WHERE uploader_id NOT IN (SELECT id FROM users);

SELECT 'resources.reviewed_by' AS relation, COUNT(*) AS orphaned
FROM resources WHERE reviewed_by IS NOT NULL AND reviewed_by NOT IN (SELECT id FROM users);

SELECT 'transactions.user_id' AS relation, COUNT(*) AS orphaned
FROM transactions WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users);

SELECT 'transactions.resource_id' AS relation, COUNT(*) AS orphaned
FROM transactions WHERE resource_id IS NOT NULL AND resource_id NOT IN (SELECT id FROM resources);

SELECT 'announcements.created_by' AS relation, COUNT(*) AS orphaned
FROM announcements WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM users);

SELECT 'notifications.resource_id' AS relation, COUNT(*) AS orphaned
FROM notifications WHERE resource_id IS NOT NULL AND resource_id NOT IN (SELECT id FROM resources);

SELECT 'notifications.announcement_id' AS relation, COUNT(*) AS orphaned
FROM notifications WHERE announcement_id IS NOT NULL AND announcement_id NOT IN (SELECT id FROM announcements);

SELECT 'notifications.deleted_account_log_id' AS relation, COUNT(*) AS orphaned
FROM notifications WHERE deleted_account_log_id IS NOT NULL AND deleted_account_log_id NOT IN (SELECT id FROM deleted_account_logs);

SELECT 'notifications.recipient_id' AS relation, COUNT(*) AS orphaned
FROM notifications WHERE recipient_id IS NOT NULL AND recipient_id NOT IN (SELECT id FROM users);

SELECT 'bookmarks.user_id' AS relation, COUNT(*) AS orphaned
FROM bookmarks WHERE user_id NOT IN (SELECT id FROM users);

SELECT 'bookmarks.resource_id' AS relation, COUNT(*) AS orphaned
FROM bookmarks WHERE resource_id NOT IN (SELECT id FROM resources);

SELECT 'download_logs.user_id' AS relation, COUNT(*) AS orphaned
FROM download_logs WHERE user_id NOT IN (SELECT id FROM users);

SELECT 'download_logs.resource_id' AS relation, COUNT(*) AS orphaned
FROM download_logs WHERE resource_id NOT IN (SELECT id FROM resources);

-- Row counts, for a quick sanity comparison against export.js's printed
-- "Exported: N" numbers for each collection.
SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
UNION ALL SELECT 'resources', COUNT(*) FROM resources
UNION ALL SELECT 'transactions', COUNT(*) FROM transactions
UNION ALL SELECT 'announcements', COUNT(*) FROM announcements
UNION ALL SELECT 'deleted_account_logs', COUNT(*) FROM deleted_account_logs
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'bookmarks', COUNT(*) FROM bookmarks
UNION ALL SELECT 'download_logs', COUNT(*) FROM download_logs;
