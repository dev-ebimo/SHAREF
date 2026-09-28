import {
  transformUser, transformResource, transformTransaction, transformAnnouncement,
  transformDeletedAccountLog, transformNotification, transformBookmark, transformDownloadLog,
  normalizePreferences, DEFAULT_PREFERENCES,
} from "../transform.js";
import { sqlLiteral, buildInsertStatement } from "../sqlWriter.js";

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) { console.log("OK  -", label); passed++; }
  else { console.log("FAIL-", label, extra); failed++; }
}

// Fake ObjectId — the real mongodb driver returns objects whose
// .toString() gives the 24-char hex id; this is enough to test against
// without a real MongoDB connection.
function fakeObjectId(hex) {
  return { toString: () => hex };
}

// =============================================================================
// normalizePreferences — THE critical bug-prevention function
// =============================================================================
{
  const result = normalizePreferences(undefined);
  check("normalizePreferences: undefined input -> full defaults", JSON.stringify(result) === JSON.stringify(DEFAULT_PREFERENCES));
}
{
  const result = normalizePreferences({});
  check("normalizePreferences: empty object -> full defaults", result.moderation.itemsPerPage === 25 && result.notifications.uploadStatus.email === true);
}
{
  // Partial: only top-level landingPage set, everything else missing —
  // exactly the shape a pre-preferences-schema-update account would have.
  const result = normalizePreferences({ landingPage: "resources" });
  check("normalizePreferences: partial input preserves the set field", result.landingPage === "resources");
  check("normalizePreferences: partial input fills in missing nested defaults", result.moderation.itemsPerPage === 25 && result.review.defaultSort === "oldest");
}
{
  // Deeply partial: notifications.uploadStatus set, but announcements missing entirely
  const result = normalizePreferences({ notifications: { uploadStatus: { email: false } } });
  check("normalizePreferences: deep partial preserves the set nested field", result.notifications.uploadStatus.email === false);
  check("normalizePreferences: deep partial fills the SIBLING nested field (inApp)", result.notifications.uploadStatus.inApp === true);
  check("normalizePreferences: deep partial fills a whole missing branch (announcements)", result.notifications.announcements.email === true);
}
{
  // Fully populated — nothing should change
  const full = { landingPage: "custom", moderation: { itemsPerPage: 99 }, review: { defaultSort: "newest" }, notifications: { uploadStatus: { email: false, inApp: false }, announcements: { email: false, inApp: false } } };
  const result = normalizePreferences(full);
  check("normalizePreferences: fully-populated input passes through unchanged", result.landingPage === "custom" && result.moderation.itemsPerPage === 99 && result.notifications.uploadStatus.email === false);
}

// =============================================================================
// transformUser
// =============================================================================
{
  const doc = {
    _id: fakeObjectId("507f1f77bcf86cd799439011"),
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    password: "$2b$10$hashedvalue",
    matricNumber: "CS/2021/001",
    role: "student",
    walletBalance: 1500,
    accountStatus: "active",
    lastLoginAt: new Date("2026-01-15T10:00:00Z"),
    isVerified: true,
    preferences: { landingPage: "resources" },
    createdAt: new Date("2025-09-01T00:00:00Z"),
    updatedAt: new Date("2026-01-15T10:00:00Z"),
  };
  const row = transformUser(doc);
  check("transformUser: id from ObjectId", row.id === "507f1f77bcf86cd799439011");
  check("transformUser: basic fields mapped", row.full_name === "Ada Lovelace" && row.email === "ada@example.com");
  check("transformUser: isVerified boolean -> 1", row.is_verified === 1);
  check("transformUser: lastLoginAt Date -> ISO string", row.last_login_at === "2026-01-15T10:00:00.000Z");
  check("transformUser: OTP fields deliberately nulled", row.verification_otp === null && row.reset_password_otp === null);
  check("transformUser: sparse preferences normalized with defaults", JSON.parse(row.preferences).moderation.itemsPerPage === 25);
  check("transformUser: preferences set field preserved through normalization", JSON.parse(row.preferences).landingPage === "resources");
}
{
  // Minimal document — most optional fields entirely absent
  const doc = {
    _id: fakeObjectId("507f1f77bcf86cd799439012"),
    fullName: "Minimal User",
    email: "min@example.com",
    password: "hash",
  };
  const row = transformUser(doc);
  check("transformUser: missing matricNumber -> null (not undefined/crash)", row.matric_number === null);
  check("transformUser: missing role defaults to student", row.role === "student");
  check("transformUser: missing walletBalance defaults to 0", row.wallet_balance === 0);
  check("transformUser: missing isVerified -> 0", row.is_verified === 0);
  check("transformUser: missing lastLoginAt -> null", row.last_login_at === null);
  check("transformUser: missing preferences entirely -> full defaults, not a crash", JSON.parse(row.preferences).notifications.uploadStatus.email === true);
  check("transformUser: missing createdAt -> falls back to a real timestamp, not null", typeof row.created_at === "string" && row.created_at.length > 0);
}

// =============================================================================
// transformResource
// =============================================================================
{
  const doc = {
    _id: fakeObjectId("607f1f77bcf86cd799439021"),
    title: "CSC301 Notes",
    type: "Lecture Note",
    department: "CS",
    course: "CSC301",
    level: "300",
    semester: "First",
    session: "2024/2025",
    uploader: fakeObjectId("507f1f77bcf86cd799439011"),
    fileName: "notes.pdf",
    fileUrl: "https://res.cloudinary.com/x/notes.pdf",
    cloudinaryPublicId: "sharef_resources/abc",
    previewType: "text",
    previewSnippet: "Some extracted text",
    fileSizeBytes: 204800,
    fileExtension: "pdf",
    pages: 5,
    status: "approved",
    downloads: 12,
    reviewedBy: fakeObjectId("507f1f77bcf86cd799439099"),
    reviewedAt: new Date("2025-10-01T00:00:00Z"),
  };
  const row = transformResource(doc);
  check("transformResource: uploader ObjectId -> string id", row.uploader_id === "507f1f77bcf86cd799439011");
  check("transformResource: reviewedBy ObjectId -> string id", row.reviewed_by === "507f1f77bcf86cd799439099");
  check("transformResource: already-computed previewType passed through as-is (not reset to pending)", row.preview_type === "text");
  check("transformResource: preview_snippet preserved", row.preview_snippet === "Some extracted text");
}
{
  // A resource with no reviewer yet (still pending) — reviewedBy/reviewedAt absent
  const doc = {
    _id: fakeObjectId("607f1f77bcf86cd799439022"),
    title: "Pending Upload", type: "Textbook", department: "CS", course: "CSC302",
    level: "300", semester: "First", session: "2024/2025",
    uploader: fakeObjectId("507f1f77bcf86cd799439011"),
    fileName: "f.pdf", fileUrl: "https://x", cloudinaryPublicId: "pub",
    fileSizeBytes: 1000, fileExtension: "pdf", status: "pending",
  };
  const row = transformResource(doc);
  check("transformResource: missing reviewedBy -> null, not a crash", row.reviewed_by === null);
  check("transformResource: missing previewType defaults to 'none'", row.preview_type === "none");
  check("transformResource: missing pages defaults to 1", row.pages === 1);
}

// =============================================================================
// transformTransaction / transformAnnouncement / transformNotification / transformBookmark / transformDownloadLog
// =============================================================================
{
  const doc = { _id: fakeObjectId("t1"), user: fakeObjectId("u1"), type: "purchase", amount: 300, status: "successful", resource: fakeObjectId("r1") };
  const row = transformTransaction(doc);
  check("transformTransaction: refs converted to string ids", row.user_id === "u1" && row.resource_id === "r1");
}
{
  const doc = { _id: fakeObjectId("t2"), user: fakeObjectId("u1"), type: "deposit", amount: 500, status: "pending" }; // no resource — a deposit, not a purchase
  const row = transformTransaction(doc);
  check("transformTransaction: missing resource ref -> null", row.resource_id === null);
}
{
  const doc = { _id: fakeObjectId("a1"), title: "T", message: "M", targetDepartments: ["CS", "Physics"], targetLevels: ["300"], createdBy: fakeObjectId("admin1"), recipientCount: 42 };
  const row = transformAnnouncement(doc);
  check("transformAnnouncement: array fields JSON-stringified", row.target_departments === '["CS","Physics"]');
  check("transformAnnouncement: createdBy ref converted", row.created_by === "admin1");
}
{
  const doc = { _id: fakeObjectId("a2"), title: "T", message: "M" }; // no target arrays at all
  const row = transformAnnouncement(doc);
  check("transformAnnouncement: missing target arrays default to empty JSON arrays", row.target_departments === "[]" && row.target_levels === "[]");
}
{
  // resource-type notification
  const doc = { _id: fakeObjectId("n1"), resource: fakeObjectId("r1"), recipient: null, type: "new_upload", unread: true };
  const row = transformNotification(doc);
  check("transformNotification: resource ref converted", row.resource_id === "r1");
  check("transformNotification: null recipient stays null (admin feed)", row.recipient_id === null);
  check("transformNotification: unread boolean -> 1", row.unread === 1);
}
{
  // account_deleted notification — the field this whole migration depends on existing
  const doc = { _id: fakeObjectId("n2"), deletedAccountLog: fakeObjectId("log1"), recipient: null, type: "account_deleted", unread: false };
  const row = transformNotification(doc);
  check("transformNotification: deletedAccountLog ref converted correctly", row.deleted_account_log_id === "log1");
  check("transformNotification: no resource ref for this type -> null", row.resource_id === null);
  check("transformNotification: unread false -> 0", row.unread === 0);
}
{
  const doc = { _id: fakeObjectId("b1"), user: fakeObjectId("u1"), resource: fakeObjectId("r1") };
  const row = transformBookmark(doc);
  check("transformBookmark: refs converted", row.user_id === "u1" && row.resource_id === "r1");
}
{
  const doc = { _id: fakeObjectId("d1"), user: fakeObjectId("u1"), resource: fakeObjectId("r1") };
  const row = transformDownloadLog(doc);
  check("transformDownloadLog: refs converted", row.user_id === "u1" && row.resource_id === "r1");
}
{
  const doc = { _id: fakeObjectId("log1"), fullName: "Gone User", email: "gone@x.com", uploadsCount: 3, totalDeposited: 1000, totalSpent: 400 };
  const row = transformDeletedAccountLog(doc);
  check("transformDeletedAccountLog: fields mapped", row.full_name === "Gone User" && row.uploads_count === 3);
  check("transformDeletedAccountLog: missing matricNumber -> empty string, not null", row.matric_number === "");
}

// =============================================================================
// sqlWriter — escaping and statement building
// =============================================================================
{
  check("sqlLiteral: null -> NULL keyword", sqlLiteral(null) === "NULL");
  check("sqlLiteral: undefined -> NULL keyword", sqlLiteral(undefined) === "NULL");
  check("sqlLiteral: number -> bare literal", sqlLiteral(42) === "42");
  check("sqlLiteral: boolean true -> 1", sqlLiteral(true) === "1");
  check("sqlLiteral: plain string -> quoted", sqlLiteral("hello") === "'hello'");
  check("sqlLiteral: single quote is doubled (SQL escaping)", sqlLiteral("O'Brien's Notes") === "'O''Brien''s Notes'");
}
{
  const stmt = buildInsertStatement("users", { id: "u1", full_name: "O'Brien", wallet_balance: 100, matric_number: null });
  check("buildInsertStatement: correct shape", stmt === "INSERT OR REPLACE INTO users (id, full_name, wallet_balance, matric_number) VALUES ('u1', 'O''Brien', 100, NULL);", stmt);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
