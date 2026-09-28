import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  transformUser, transformResource, transformTransaction, transformAnnouncement,
  transformDeletedAccountLog, transformNotification, transformBookmark, transformDownloadLog,
} from "../transform.js";
import { buildInsertStatements } from "../sqlWriter.js";

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) { console.log("OK  -", label); passed++; }
  else { console.log("FAIL-", label, extra); failed++; }
}

function fakeObjectId(hex) {
  return { toString: () => hex };
}

// A realistic, fully cross-referenced synthetic dataset — one of everything,
// with the SAME kind of references a real MongoDB export would have.
const student = {
  _id: fakeObjectId("u-student1"),
  fullName: "Ada Student", email: "ada@example.com", password: "hash",
  role: "student", department: "CS", level: "300",
  // Deliberately sparse — no preferences field at all, exactly the case
  // normalizePreferences exists to handle.
};
const admin = {
  _id: fakeObjectId("u-admin1"),
  fullName: "Grace Admin", email: "grace@example.com", password: "hash", role: "admin",
};
const resource = {
  _id: fakeObjectId("r-1"), title: "CSC301 Notes", type: "Lecture Note", department: "CS",
  course: "CSC301", level: "300", semester: "First", session: "2024/2025",
  uploader: fakeObjectId("u-student1"), fileName: "notes.pdf", fileUrl: "https://x/notes.pdf",
  cloudinaryPublicId: "pub-r1", fileSizeBytes: 204800, fileExtension: "pdf",
  status: "approved", reviewedBy: fakeObjectId("u-admin1"), reviewedAt: new Date(),
};
const transaction = {
  _id: fakeObjectId("t-1"), user: fakeObjectId("u-student1"), type: "purchase",
  amount: 300, status: "successful", resource: fakeObjectId("r-1"),
};
const announcement = {
  _id: fakeObjectId("a-1"), title: "Exam Notice", message: "Exams next week",
  targetDepartments: ["CS"], targetLevels: ["300"], createdBy: fakeObjectId("u-admin1"), recipientCount: 1,
};
const deletedLog = {
  _id: fakeObjectId("log-1"), fullName: "Gone Student", email: "gone@example.com",
  uploadsCount: 2, totalDeposited: 500, totalSpent: 100,
};
const notifResourceType = {
  _id: fakeObjectId("n-1"), resource: fakeObjectId("r-1"), recipient: null, type: "new_upload", unread: true,
};
const notifDeletedAccountType = {
  _id: fakeObjectId("n-2"), deletedAccountLog: fakeObjectId("log-1"), recipient: null, type: "account_deleted", unread: true,
};
const notifAnnouncementType = {
  _id: fakeObjectId("n-3"), announcement: fakeObjectId("a-1"), recipient: fakeObjectId("u-student1"), type: "announcement", unread: true,
};
const bookmark = { _id: fakeObjectId("bm-1"), user: fakeObjectId("u-student1"), resource: fakeObjectId("r-1") };
const downloadLog = { _id: fakeObjectId("dl-1"), user: fakeObjectId("u-student1"), resource: fakeObjectId("r-1") };

const sqlParts = [
  "PRAGMA foreign_keys = OFF;",
  "BEGIN TRANSACTION;",
  ...buildInsertStatements("users", [student, admin].map(transformUser)),
  ...buildInsertStatements("resources", [resource].map(transformResource)),
  ...buildInsertStatements("transactions", [transaction].map(transformTransaction)),
  ...buildInsertStatements("announcements", [announcement].map(transformAnnouncement)),
  ...buildInsertStatements("deleted_account_logs", [deletedLog].map(transformDeletedAccountLog)),
  ...buildInsertStatements("notifications", [notifResourceType, notifDeletedAccountType, notifAnnouncementType].map(transformNotification)),
  ...buildInsertStatements("bookmarks", [bookmark].map(transformBookmark)),
  ...buildInsertStatements("download_logs", [downloadLog].map(transformDownloadLog)),
  "COMMIT;",
  "PRAGMA foreign_keys = ON;",
];
const generatedSql = sqlParts.join("\n");

// Run it against the REAL production schema, not a simplified test one.
const schemaSql = fs.readFileSync(new URL("../../../src/db/schema.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(schemaSql);

try {
  db.exec(generatedSql);
  check("generated SQL applies cleanly against the real production schema", true);
} catch (err) {
  check("generated SQL applies cleanly against the real production schema", false, err.message);
  console.log("\nGenerated SQL that failed:\n", generatedSql);
  process.exit(1);
}

// Same integrity checks as verify.sql — run here so this failing means
// verify.sql would have failed too, and it's caught before anyone runs
// this for real.
const orphanChecks = [
  ["resources.uploader_id", "SELECT COUNT(*) AS n FROM resources WHERE uploader_id NOT IN (SELECT id FROM users)"],
  ["resources.reviewed_by", "SELECT COUNT(*) AS n FROM resources WHERE reviewed_by IS NOT NULL AND reviewed_by NOT IN (SELECT id FROM users)"],
  ["transactions.user_id", "SELECT COUNT(*) AS n FROM transactions WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)"],
  ["transactions.resource_id", "SELECT COUNT(*) AS n FROM transactions WHERE resource_id IS NOT NULL AND resource_id NOT IN (SELECT id FROM resources)"],
  ["announcements.created_by", "SELECT COUNT(*) AS n FROM announcements WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM users)"],
  ["notifications.resource_id", "SELECT COUNT(*) AS n FROM notifications WHERE resource_id IS NOT NULL AND resource_id NOT IN (SELECT id FROM resources)"],
  ["notifications.announcement_id", "SELECT COUNT(*) AS n FROM notifications WHERE announcement_id IS NOT NULL AND announcement_id NOT IN (SELECT id FROM announcements)"],
  ["notifications.deleted_account_log_id", "SELECT COUNT(*) AS n FROM notifications WHERE deleted_account_log_id IS NOT NULL AND deleted_account_log_id NOT IN (SELECT id FROM deleted_account_logs)"],
  ["notifications.recipient_id", "SELECT COUNT(*) AS n FROM notifications WHERE recipient_id IS NOT NULL AND recipient_id NOT IN (SELECT id FROM users)"],
  ["bookmarks.user_id", "SELECT COUNT(*) AS n FROM bookmarks WHERE user_id NOT IN (SELECT id FROM users)"],
  ["bookmarks.resource_id", "SELECT COUNT(*) AS n FROM bookmarks WHERE resource_id NOT IN (SELECT id FROM resources)"],
  ["download_logs.user_id", "SELECT COUNT(*) AS n FROM download_logs WHERE user_id NOT IN (SELECT id FROM users)"],
  ["download_logs.resource_id", "SELECT COUNT(*) AS n FROM download_logs WHERE resource_id NOT IN (SELECT id FROM resources)"],
];
for (const [label, sql] of orphanChecks) {
  const { n } = db.prepare(sql).get();
  check(`verify: ${label} has zero orphaned references`, n === 0, `got ${n}`);
}

// Spot-check actual data round-tripped correctly, not just that it inserted.
const studentRow = db.prepare("SELECT * FROM users WHERE id = 'u-student1'").get();
check("round-trip: student row exists with correct id", !!studentRow);
check("round-trip: sparse preferences were normalized, not left broken", JSON.parse(studentRow.preferences).moderation.itemsPerPage === 25);

const resourceRow = db.prepare("SELECT * FROM resources WHERE id = 'r-1'").get();
check("round-trip: resource correctly linked to its uploader", resourceRow.uploader_id === "u-student1");
check("round-trip: resource correctly linked to its reviewer", resourceRow.reviewed_by === "u-admin1");

const deletedNotif = db.prepare("SELECT * FROM notifications WHERE id = 'n-2'").get();
check("round-trip: account_deleted notification correctly linked to its log", deletedNotif.deleted_account_log_id === "log-1");

const studentNotif = db.prepare("SELECT * FROM notifications WHERE id = 'n-3'").get();
check("round-trip: personal notification correctly linked to its recipient (not admin feed)", studentNotif.recipient_id === "u-student1");

// Confirm this data actually WORKS through real app routes, not just that
// it satisfies the schema — the strongest possible check available
// without a live MongoDB connection.
const appTestResult = await (async () => {
  const { default: app } = await import("../../../src/index.js");
  const { sign } = await import("hono/jwt");
  const env = { DB: wrapAsD1(db), JWT_SECRET: "test-secret" };
  const now = Math.floor(Date.now() / 1000);
  const token = await sign({ id: "u-student1", role: "student", iat: now, exp: now + 604800 }, env.JWT_SECRET);
  const res = await app.fetch(new Request("http://localhost/api/bookmarks", { headers: { Authorization: `Bearer ${token}` } }), env);
  return { status: res.status, body: await res.json() };
})();
check("migrated data works through a real app route (GET /api/bookmarks)", appTestResult.status === 200 && appTestResult.body.resources.length === 1, JSON.stringify(appTestResult));
check("migrated bookmark resolves to the correct migrated resource", appTestResult.body.resources[0]?.id === "r-1");

// Minimal D1-shaped wrapper around the same underlying SQLite connection,
// so the app's real route code (which expects env.DB.prepare().bind().first()/.all())
// can run directly against the exact data this test just migrated.
function wrapAsD1(rawDb) {
  return {
    prepare(sql) {
      return {
        _args: [],
        bind(...args) { this._args = args; return this; },
        async first() { return rawDb.prepare(sql).get(...this._args) ?? null; },
        async all() { return { results: rawDb.prepare(sql).all(...this._args) }; },
        async run() {
          const info = rawDb.prepare(sql).run(...this._args);
          return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
        },
      };
    },
  };
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
