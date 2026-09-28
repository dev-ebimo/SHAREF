import fs from "node:fs";
import { sign } from "hono/jwt";
import app from "../src/index.js";
import { createMockD1 } from "./mockD1.js";

const schemaSql = fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) { console.log("OK  -", label); passed++; }
  else { console.log("FAIL-", label, extra); failed++; }
}

function freshEnv() {
  const DB = createMockD1(schemaSql);
  return { env: { DB, JWT_SECRET: "test-secret", SENDGRID_API_KEY: "SG.fake", SENDGRID_FROM_EMAIL: "noreply@sharef.test" }, DB };
}

async function tokenFor(env, id, role = "student") {
  const now = Math.floor(Date.now() / 1000);
  return sign({ id, role, iat: now, exp: now + 604800 }, env.JWT_SECRET);
}

function fullPrefs({ inApp = true, email = true } = {}) {
  return { landingPage: "dashboard", moderation: {}, review: {}, notifications: { uploadStatus: { email: true, inApp: true }, announcements: { email, inApp } } };
}

function seedUser(DB, { id, role = "student", department = null, level = null, preferences = fullPrefs() }) {
  DB._raw
    .prepare(`INSERT INTO users (id, full_name, email, password, role, department, level, is_verified, preferences) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, `User ${id}`, `${id}@example.com`, "hash", role, department, level, JSON.stringify(preferences));
}

function withExecutionCtx() {
  const tasks = [];
  return { ctx: { waitUntil: (p) => tasks.push(p), passThroughOnException() {} }, async drain() { await Promise.all(tasks); } };
}

async function postAuthed(path, body, token, env, ctx) {
  return app.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, ctx);
}
async function getAuthed(path, token, env) {
  return app.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }), env);
}
async function patchAuthed(path, body, token, env) {
  return app.fetch(new Request(`http://localhost${path}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);
}

const realFetch = globalThis.fetch;
let sentEmails = [];
function installMocks() {
  sentEmails = [];
  globalThis.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("api.sendgrid.com")) {
      sentEmails.push(JSON.parse(opts.body));
      return new Response(null, { status: 202 });
    }
    return realFetch(url, opts);
  };
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

async function run() {
  // =========================================================================
  // createAnnouncement
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "cs1", department: "CS", level: "300", preferences: fullPrefs({ inApp: true, email: true }) });
    seedUser(DB, { id: "cs2", department: "CS", level: "200", preferences: fullPrefs({ inApp: true, email: false }) });
    seedUser(DB, { id: "eng1", department: "Engineering", level: "300", preferences: fullPrefs({ inApp: false, email: true }) });
    const token = await tokenFor(env, "admin1", "admin");
    installMocks();
    const { ctx, drain } = withExecutionCtx();

    const res = await postAuthed("/api/admin/announcements", { title: "Exam Update", message: "Exams moved to next week" }, token, env, ctx);
    const body = await res.json();
    await drain();
    check("announcement: 201 status", res.status === 201, JSON.stringify(body));
    check("announcement: sent to all 3 students (no filter)", body.message.includes("3 student"));

    const notifs = DB._raw.prepare("SELECT * FROM notifications WHERE type = 'announcement'").all();
    check("announcement: in-app notifications only for inApp=true prefs (cs1, cs2)", notifs.length === 2, JSON.stringify(notifs));

    check("announcement: emails only for email=true prefs (cs1, eng1)", sentEmails.length === 2, sentEmails.length);
    const emailAddresses = sentEmails.map((e) => e.personalizations[0].to[0].email);
    check("announcement: correct email recipients", emailAddresses.includes("cs1@example.com") && emailAddresses.includes("eng1@example.com"));

    const annRow = DB._raw.prepare("SELECT * FROM announcements WHERE title = 'Exam Update'").get();
    check("announcement: recipient_count stored correctly", annRow.recipient_count === 3);
    restoreFetch();
  }
  {
    // department + level filters (AND)
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "match", department: "CS", level: "300" });
    seedUser(DB, { id: "wrong-dept", department: "Engineering", level: "300" });
    seedUser(DB, { id: "wrong-level", department: "CS", level: "200" });
    const token = await tokenFor(env, "admin1", "admin");
    installMocks();
    const { ctx, drain } = withExecutionCtx();

    const res = await postAuthed("/api/admin/announcements", { title: "T", message: "M", departments: ["CS"], levels: ["300"] }, token, env, ctx);
    await drain();
    const body = await res.json();
    check("announcement: department+level filter (AND) targets only the matching student", body.message.includes("1 student"), JSON.stringify(body));
    restoreFetch();
  }
  {
    // non-student (admin) users are never targeted
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "admin2", role: "admin" });
    seedUser(DB, { id: "student1", role: "student" });
    const token = await tokenFor(env, "admin1", "admin");
    installMocks();
    const { ctx, drain } = withExecutionCtx();
    const res = await postAuthed("/api/admin/announcements", { title: "T", message: "M" }, token, env, ctx);
    await drain();
    const body = await res.json();
    check("announcement: only students targeted, admins excluded", body.message.includes("1 student"), JSON.stringify(body));
    restoreFetch();
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await postAuthed("/api/admin/announcements", { title: "", message: "" }, token, env);
    check("announcement: missing title/message -> 400", res.status === 400);
  }

  // =========================================================================
  // getAnnouncements
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const timestamp1 = new Date(Date.now() - 60000).toISOString();
    const timestamp2 = new Date().toISOString();
    DB._raw.prepare(`INSERT INTO announcements (id, title, message, target_departments, target_levels, created_by, recipient_count, created_at, updated_at) VALUES ('a1', 'Old', 'msg', '[]', '[]', 'admin1', 5, ?, ?)`).run(timestamp1, timestamp1);
    DB._raw.prepare(`INSERT INTO announcements (id, title, message, target_departments, target_levels, created_by, recipient_count, created_at, updated_at) VALUES ('a2', 'New', 'msg', '["CS"]', '["300"]', 'admin1', 10, ?, ?)`).run(timestamp2, timestamp2);

    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/announcements", token, env);
    const body = await res.json();
    check("announcements list: 200 status", res.status === 200);
    check("announcements list: newest first", body.announcements[0].id === "a2");
    check("announcements list: createdBy name joined", body.announcements[0].createdBy === "User admin1");
    check("announcements list: targetDepartments parsed from JSON", JSON.stringify(body.announcements[0].targetDepartments) === '["CS"]');
  }

  // =========================================================================
  // Admin notification feed — getNotifications (dual-type shaping)
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "uploader1" });
    DB._raw.prepare(
      `INSERT INTO resources (id, title, type, department, course, level, semester, session, uploader_id, file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, status)
       VALUES ('r1', 'Notes', 'Textbook', 'CS', 'CSC301', '300', 'First', '2024/2025', 'uploader1', 'f.pdf', 'https://x/f.pdf', 'pub', 204800, 'pdf', 'pending')`
    ).run();
    const timestamp = new Date().toISOString();
    DB._raw.prepare(`INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES ('n1', 'r1', NULL, 'new_upload', 1, ?, ?)`).run(timestamp, timestamp);

    DB._raw.prepare(
      `INSERT INTO deleted_account_logs (id, full_name, email, department, level, uploads_count, total_deposited, total_spent, created_at)
       VALUES ('log1', 'Departed Student', 'gone@example.com', 'Physics', '400', 3, 5000, 2000, ?)`
    ).run(timestamp);
    DB._raw.prepare(`INSERT INTO notifications (id, deleted_account_log_id, recipient_id, type, unread, created_at, updated_at) VALUES ('n2', 'log1', NULL, 'account_deleted', 1, ?, ?)`).run(timestamp, timestamp);

    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/notifications", token, env);
    const body = await res.json();
    check("admin feed: 200 status", res.status === 200, JSON.stringify(body));
    check("admin feed: both notification types present", body.notifications.length === 2);

    const uploadNotif = body.notifications.find((n) => n.notifType === "new_upload");
    check("admin feed: new_upload shaped correctly", uploadNotif.title === "Notes" && uploadNotif.uploader === "User uploader1" && uploadNotif.dept === "CS");

    const deletedNotif = body.notifications.find((n) => n.notifType === "account_deleted");
    check("admin feed: account_deleted shaped correctly", deletedNotif.fullName === "Departed Student" && deletedNotif.department === "Physics" && deletedNotif.totalSpent === 2000);
  }
  {
    // orphaned notification (resource permanently deleted, resource_id nulled) filtered out gracefully
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const timestamp = new Date().toISOString();
    DB._raw.prepare(`INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES ('n1', NULL, NULL, 'new_upload', 1, ?, ?)`).run(timestamp, timestamp);
    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/notifications", token, env);
    const body = await res.json();
    check("admin feed: orphaned notification filtered out, no crash", res.status === 200 && body.notifications.length === 0, JSON.stringify(body));
  }

  // =========================================================================
  // toggleRead / markAllRead
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const timestamp = new Date().toISOString();
    DB._raw.prepare(`INSERT INTO notifications (id, recipient_id, type, unread, created_at, updated_at) VALUES ('n1', NULL, 'announcement', 1, ?, ?)`).run(timestamp, timestamp);
    DB._raw.prepare(`INSERT INTO notifications (id, recipient_id, type, unread, created_at, updated_at) VALUES ('n2', NULL, 'announcement', 1, ?, ?)`).run(timestamp, timestamp);
    const token = await tokenFor(env, "admin1", "admin");

    const toggleRes = await patchAuthed("/api/admin/notifications/n1/toggle-read", null, token, env);
    const toggleBody = await toggleRes.json();
    check("toggle-read: flips to false", toggleBody.unread === false);

    await patchAuthed("/api/admin/notifications/mark-all-read", null, token, env);
    const row1 = DB._raw.prepare("SELECT unread FROM notifications WHERE id = 'n1'").get();
    const row2 = DB._raw.prepare("SELECT unread FROM notifications WHERE id = 'n2'").get();
    check("mark-all-read: both notifications now read", row1.unread === 0 && row2.unread === 0);
  }

  // =========================================================================
  // quickApprove / quickReject / quickPreview — delegation to moderationController
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "uploader1" });
    DB._raw.prepare(
      `INSERT INTO resources (id, title, type, department, course, level, semester, session, uploader_id, file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, status, preview_type)
       VALUES ('r1', 'Notes', 'Textbook', 'CS', 'CSC301', '300', 'First', '2024/2025', 'uploader1', 'f.pdf', 'https://x/f.pdf', 'pub', 204800, 'pdf', 'pending', 'none')`
    ).run();
    const timestamp = new Date().toISOString();
    DB._raw.prepare(`INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES ('n1', 'r1', NULL, 'new_upload', 1, ?, ?)`).run(timestamp, timestamp);

    const token = await tokenFor(env, "admin1", "admin");
    const { ctx, drain } = withExecutionCtx();
    const res = await postAuthed("/api/admin/notifications/n1/approve", null, token, env, ctx);
    await drain();
    check("quickApprove: 200 status", res.status === 200, JSON.stringify(await res.json()));

    const resourceRow = DB._raw.prepare("SELECT status FROM resources WHERE id = 'r1'").get();
    check("quickApprove: correctly approved the notification's underlying resource (r1)", resourceRow.status === "approved");
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "uploader1" });
    DB._raw.prepare(
      `INSERT INTO resources (id, title, type, department, course, level, semester, session, uploader_id, file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, status, preview_type)
       VALUES ('r1', 'Notes', 'Textbook', 'CS', 'CSC301', '300', 'First', '2024/2025', 'uploader1', 'f.pdf', 'https://x/f.pdf', 'pub', 204800, 'pdf', 'pending', 'none')`
    ).run();
    const timestamp = new Date().toISOString();
    DB._raw.prepare(`INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES ('n1', 'r1', NULL, 'new_upload', 1, ?, ?)`).run(timestamp, timestamp);

    const token = await tokenFor(env, "admin1", "admin");
    const { ctx, drain } = withExecutionCtx();
    const res = await postAuthed("/api/admin/notifications/n1/reject", { reason: "Bad scan" }, token, env, ctx);
    await drain();
    check("quickReject: 200 status", res.status === 200);
    const resourceRow = DB._raw.prepare("SELECT status, rejection_reason FROM resources WHERE id = 'r1'").get();
    check("quickReject: correctly rejected with the given reason", resourceRow.status === "rejected" && resourceRow.rejection_reason === "Bad scan");
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await postAuthed("/api/admin/notifications/does-not-exist/approve", null, token, env);
    check("quickApprove: nonexistent notification -> 404", res.status === 404);
  }
  {
    // account_deleted notification has no resource_id — quick-actions correctly refuse it
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const timestamp = new Date().toISOString();
    DB._raw.prepare(
      `INSERT INTO deleted_account_logs (id, full_name, email, created_at) VALUES ('log1', 'Gone', 'gone@x.com', ?)`
    ).run(timestamp);
    DB._raw.prepare(`INSERT INTO notifications (id, deleted_account_log_id, recipient_id, type, unread, created_at, updated_at) VALUES ('n1', 'log1', NULL, 'account_deleted', 1, ?, ?)`).run(timestamp, timestamp);
    const token = await tokenFor(env, "admin1", "admin");
    const res = await postAuthed("/api/admin/notifications/n1/approve", null, token, env);
    check("quickApprove: account_deleted notification (no resource) -> 400", res.status === 400);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("TEST RUNNER CRASHED:", e);
  process.exit(1);
});
