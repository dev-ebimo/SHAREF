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
  return {
    env: { DB, JWT_SECRET: "test-secret", CLOUDINARY_CLOUD_NAME: "sharef-cloud", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s", SENDGRID_API_KEY: "SG.fake", SENDGRID_FROM_EMAIL: "noreply@sharef.test" },
    DB,
  };
}

async function tokenFor(env, id, role = "student") {
  const now = Math.floor(Date.now() / 1000);
  return sign({ id, role, iat: now, exp: now + 604800 }, env.JWT_SECRET);
}

function fullPrefs(extra = {}) {
  return {
    landingPage: "dashboard",
    moderation: { landingPage: "pending", itemsPerPage: 25, autoOpenNext: true, confirmBeforeApproval: false, confirmBeforeRejection: true },
    review: { defaultSort: "oldest" },
    notifications: { uploadStatus: { email: true, inApp: true }, announcements: { email: true, inApp: true } },
    ...extra,
  };
}

function seedUser(DB, { id, role = "student", email, preferences = fullPrefs(), matricNumber = null, walletBalance = 0 }) {
  DB._raw
    .prepare(`INSERT INTO users (id, full_name, email, password, role, matric_number, is_verified, wallet_balance, preferences) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(id, `User ${id}`, email || `${id}@example.com`, "hash", role, matricNumber, walletBalance, JSON.stringify(preferences));
}

function withExecutionCtx() {
  const tasks = [];
  return { ctx: { waitUntil: (p) => tasks.push(p), passThroughOnException() {} }, async drain() { await Promise.all(tasks); } };
}

async function getAuthed(path, token, env) {
  return app.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }), env);
}
async function patchAuthed(path, body, token, env, ctx) {
  return app.fetch(new Request(`http://localhost${path}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env, ctx);
}
async function deleteAuthed(path, body, token, env) {
  return app.fetch(new Request(`http://localhost${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env);
}

const realFetch = globalThis.fetch;
let sentEmails = [];
let cloudinaryDestroyCalls = [];
function installMocks() {
  sentEmails = [];
  cloudinaryDestroyCalls = [];
  globalThis.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("api.sendgrid.com")) {
      sentEmails.push(JSON.parse(opts.body));
      return new Response(null, { status: 202 });
    }
    if (typeof url === "string" && url.includes("api.cloudinary.com") && url.includes("/destroy")) {
      cloudinaryDestroyCalls.push({ url, publicId: opts.body.get("public_id") });
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    }
    return realFetch(url, opts);
  };
}
function restoreFetch() { globalThis.fetch = realFetch; }

async function run() {
  // =========================================================================
  // getMyProfile — role-based preference filtering
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "student1", role: "student" });
    const token = await tokenFor(env, "student1", "student");
    const res = await getAuthed("/api/users/me", token, env);
    const body = await res.json();
    check("profile: 200 status", res.status === 200, JSON.stringify(body));
    check("profile: student's preferences hide moderation/review", body.user.preferences.moderation === undefined && body.user.preferences.review === undefined);
    check("profile: notifications still present for student", !!body.user.preferences.notifications);
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/users/me", token, env);
    const body = await res.json();
    check("profile: admin sees full preferences including moderation/review", !!body.user.preferences.moderation && !!body.user.preferences.review);
  }

  // =========================================================================
  // updateMyProfile
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1" });
    const token = await tokenFor(env, "s1");
    const res = await patchAuthed("/api/users/me", { fullName: "New Name", department: "Physics" }, token, env);
    check("update profile: 200 status", res.status === 200);
    const row = DB._raw.prepare("SELECT full_name, department FROM users WHERE id = 's1'").get();
    check("update profile: fields updated", row.full_name === "New Name" && row.department === "Physics");
  }
  {
    // matric number uniqueness (excluding self)
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1", matricNumber: "MAT001" });
    seedUser(DB, { id: "s2", matricNumber: "MAT002" });
    const token = await tokenFor(env, "s2");
    const res = await patchAuthed("/api/users/me", { matricNumber: "MAT001" }, token, env);
    check("update profile: duplicate matric number -> 409", res.status === 409);

    // updating to your OWN existing matric number is fine (no false-positive collision)
    const token1 = await tokenFor(env, "s1");
    const res2 = await patchAuthed("/api/users/me", { matricNumber: "MAT001", fullName: "Still Me" }, token1, env);
    check("update profile: keeping your own matric number is not a conflict", res2.status === 200);
  }
  {
    // email change triggers re-verification
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1", email: "old@example.com" });
    const token = await tokenFor(env, "s1");
    installMocks();
    const { ctx, drain } = withExecutionCtx();

    const res = await patchAuthed("/api/users/me", { email: "new@example.com" }, token, env, ctx);
    const body = await res.json();
    await drain();
    check("update profile: email change -> 200 with emailChanged flag", res.status === 200 && body.emailChanged === true, JSON.stringify(body));

    const row = DB._raw.prepare("SELECT email, is_verified, verification_otp FROM users WHERE id = 's1'").get();
    check("update profile: email updated", row.email === "new@example.com");
    check("update profile: is_verified reset to false", row.is_verified === 0);
    check("update profile: new OTP generated (hashed)", /^[0-9a-f]{64}$/.test(row.verification_otp));
    check("update profile: verification email sent to new address", sentEmails.length === 1 && sentEmails[0].personalizations[0].to[0].email === "new@example.com");

    restoreFetch();
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1", email: "taken@example.com" });
    seedUser(DB, { id: "s2" });
    const token = await tokenFor(env, "s2");
    const res = await patchAuthed("/api/users/me", { email: "taken@example.com" }, token, env);
    check("update profile: duplicate email -> 409", res.status === 409);
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1" });
    const token = await tokenFor(env, "s1");
    const res = await patchAuthed("/api/users/me", { level: "not-a-real-level" }, token, env);
    check("update profile: invalid level -> 400 validation error", res.status === 400);
  }

  // =========================================================================
  // updateMyPreferences — deep merge, partial updates, prototype pollution guard
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1", preferences: fullPrefs() });
    const token = await tokenFor(env, "s1");

    // Partial update: only touch notifications.uploadStatus.email, everything else should survive untouched.
    const res = await patchAuthed("/api/users/me/preferences", { preferences: { notifications: { uploadStatus: { email: false } } } }, token, env);
    const body = await res.json();
    check("preferences: 200 status", res.status === 200, JSON.stringify(body));
    check("preferences: targeted field updated", body.preferences.notifications.uploadStatus.email === false);
    check("preferences: untouched sibling field survives merge", body.preferences.notifications.uploadStatus.inApp === true);
    check("preferences: untouched top-level field survives merge (landingPage)", body.preferences.landingPage === "dashboard");
  }
  {
    // non-admin cannot set moderation/review via this endpoint
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1", role: "student", preferences: fullPrefs() });
    const token = await tokenFor(env, "s1", "student");
    const res = await patchAuthed("/api/users/me/preferences", { preferences: { moderation: { itemsPerPage: 999 } } }, token, env);
    const body = await res.json();
    check("preferences: student attempt to set moderation is silently stripped", body.preferences.moderation === undefined, JSON.stringify(body.preferences));

    const row = DB._raw.prepare("SELECT preferences FROM users WHERE id = 's1'").get();
    const stored = JSON.parse(row.preferences);
    check("preferences: moderation.itemsPerPage NOT actually changed in storage", stored.moderation.itemsPerPage === 25, stored.moderation.itemsPerPage);
  }
  {
    // admin CAN set moderation/review
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin", preferences: fullPrefs() });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await patchAuthed("/api/users/me/preferences", { preferences: { moderation: { itemsPerPage: 50 } } }, token, env);
    const body = await res.json();
    check("preferences: admin CAN set moderation.itemsPerPage", body.preferences.moderation.itemsPerPage === 50);
  }
  {
    // prototype pollution attempt is blocked, and genuinely doesn't pollute Object.prototype
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1", preferences: fullPrefs() });
    const token = await tokenFor(env, "s1");

    const maliciousPayload = JSON.parse('{"preferences": {"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"alsoPolluted": "yes"}}}}');
    const res = await patchAuthed("/api/users/me/preferences", maliciousPayload, token, env);
    check("preferences: malicious payload still returns 200 (silently ignored, not an error)", res.status === 200);

    check("preferences: Object.prototype NOT polluted (polluted)", ({}).polluted === undefined);
    check("preferences: Object.prototype NOT polluted (alsoPolluted)", ({}).alsoPolluted === undefined);

    const row = DB._raw.prepare("SELECT preferences FROM users WHERE id = 's1'").get();
    const stored = JSON.parse(row.preferences);
    check("preferences: __proto__ key not actually stored as an own property", !Object.prototype.hasOwnProperty.call(stored, "__proto__"));
  }

  // =========================================================================
  // changeMyPassword
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("oldpassword1", 10);
    DB._raw.prepare(`INSERT INTO users (id, full_name, email, password, is_verified, preferences) VALUES ('s1', 'S1', 's1@example.com', ?, 1, '{}')`).run(hash);
    const token = await tokenFor(env, "s1");

    const wrongRes = await patchAuthed("/api/users/me/password", { currentPassword: "wrongpassword", newPassword: "newpassword2" }, token, env);
    check("change password: wrong current password -> 401", wrongRes.status === 401);

    const res = await patchAuthed("/api/users/me/password", { currentPassword: "oldpassword1", newPassword: "newpassword2" }, token, env);
    check("change password: 200 status", res.status === 200);

    // Confirm the new password actually works for login, old one doesn't
    const loginOld = await app.fetch(new Request("http://localhost/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "s1@example.com", password: "oldpassword1" }) }), env);
    check("change password: old password no longer works", loginOld.status === 401);
    const loginNew = await app.fetch(new Request("http://localhost/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "s1@example.com", password: "newpassword2" }) }), env);
    check("change password: new password works", loginNew.status === 200);
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1" });
    const token = await tokenFor(env, "s1");
    const res = await patchAuthed("/api/users/me/password", { currentPassword: "x", newPassword: "short" }, token, env);
    check("change password: newPassword under 8 chars -> 400", res.status === 400);
  }

  // =========================================================================
  // deleteMyAccount — confirmation requirement
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1" });
    const token = await tokenFor(env, "s1");
    const res = await deleteAuthed("/api/users/me", { confirmation: "delete" }, token, env); // wrong case
    check("delete account: wrong confirmation text -> 400", res.status === 400);
    const stillExists = DB._raw.prepare("SELECT id FROM users WHERE id = 's1'").get();
    check("delete account: user NOT deleted when confirmation is wrong", !!stillExists);
  }

  // =========================================================================
  // deleteMyAccount — full cascade
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "s1", walletBalance: 500 });
    seedUser(DB, { id: "otherStudent" });
    seedUser(DB, { id: "adminReviewer", role: "admin" });

    // s1's own upload, reviewed by adminReviewer
    DB._raw.prepare(
      `INSERT INTO resources (id, title, type, department, course, level, semester, session, uploader_id, file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, status, reviewed_by)
       VALUES ('r1', 'S1 Upload', 'Textbook', 'CS', 'CSC301', '300', 'First', '2024/2025', 's1', 'f.pdf', 'https://x', 'pub-r1', 1000, 'pdf', 'approved', 'adminReviewer')`
    ).run();
    const timestamp = new Date().toISOString();

    // s1's own bookmark and download log (on someone else's resource)
    DB._raw.prepare(
      `INSERT INTO resources (id, title, type, department, course, level, semester, session, uploader_id, file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, status)
       VALUES ('r2', 'Other Upload', 'Textbook', 'CS', 'CSC301', '300', 'First', '2024/2025', 'otherStudent', 'f.pdf', 'https://x', 'pub-r2', 1000, 'pdf', 'approved')`
    ).run();
    DB._raw.prepare(`INSERT INTO bookmarks (id, user_id, resource_id, created_at, updated_at) VALUES ('bm-own', 's1', 'r2', ?, ?)`).run(timestamp, timestamp);
    DB._raw.prepare(`INSERT INTO download_logs (id, user_id, resource_id, created_at, updated_at) VALUES ('dl-own', 's1', 'r2', ?, ?)`).run(timestamp, timestamp);

    // A bookmark and download log ON s1's own upload, by someone else (must cascade via resource ownership)
    DB._raw.prepare(`INSERT INTO bookmarks (id, user_id, resource_id, created_at, updated_at) VALUES ('bm-on-r1', 'otherStudent', 'r1', ?, ?)`).run(timestamp, timestamp);
    DB._raw.prepare(`INSERT INTO download_logs (id, user_id, resource_id, created_at, updated_at) VALUES ('dl-on-r1', 'otherStudent', 'r1', ?, ?)`).run(timestamp, timestamp);

    // s1's own transaction (financial history — must be preserved, just detached)
    DB._raw.prepare(`INSERT INTO transactions (id, user_id, type, amount, status, created_at, updated_at) VALUES ('tx-own', 's1', 'deposit', 1000, 'successful', ?, ?)`).run(timestamp, timestamp);
    // A transaction referencing s1's resource as a purchase target (by someone else)
    DB._raw.prepare(`INSERT INTO transactions (id, user_id, type, amount, status, resource_id, created_at, updated_at) VALUES ('tx-on-r1', 'otherStudent', 'purchase', 300, 'successful', 'r1', ?, ?)`).run(timestamp, timestamp);

    // A notification s1 RECEIVED (must be deleted, not nulled)
    DB._raw.prepare(`INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES ('n-received', 'r1', 's1', 'resource_approved', 1, ?, ?)`).run(timestamp, timestamp);
    // A notification ABOUT s1's resource, in the shared admin feed (resource_id must be nulled, notification preserved)
    DB._raw.prepare(`INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES ('n-admin-feed', 'r1', NULL, 'new_upload', 1, ?, ?)`).run(timestamp, timestamp);

    // adminReviewer created an announcement (created_by must be nulled if adminReviewer is later deleted — tested separately below)

    const token = await tokenFor(env, "s1");
    installMocks();

    // Warm the auth cache for s1 BEFORE deletion, to prove invalidation actually works afterward.
    const warmRes = await getAuthed("/api/users/me", token, env);
    check("delete cascade: pre-delete request succeeds (cache warmed)", warmRes.status === 200);

    const res = await deleteAuthed("/api/users/me", { confirmation: "DELETE" }, token, env);
    const body = await res.json();
    check("delete cascade: 200 status", res.status === 200, JSON.stringify(body));

    // User row gone
    check("delete cascade: user row deleted", DB._raw.prepare("SELECT id FROM users WHERE id = 's1'").get() === undefined);

    // s1's own upload (r1) deleted
    check("delete cascade: s1's own resource (r1) deleted", DB._raw.prepare("SELECT id FROM resources WHERE id = 'r1'").get() === undefined);

    // Cloudinary was actually called for r1
    check("delete cascade: Cloudinary destroy called for s1's uploaded file", cloudinaryDestroyCalls.some((c) => c.publicId === "pub-r1"));

    // Bookmarks/download logs ON r1 (by someone else) cascade-deleted
    check("delete cascade: bookmark on s1's deleted resource is gone", DB._raw.prepare("SELECT id FROM bookmarks WHERE id = 'bm-on-r1'").get() === undefined);
    check("delete cascade: download log on s1's deleted resource is gone", DB._raw.prepare("SELECT id FROM download_logs WHERE id = 'dl-on-r1'").get() === undefined);

    // Transaction referencing r1 (by someone else) has resource_id nulled, but is PRESERVED
    const txOnR1 = DB._raw.prepare("SELECT * FROM transactions WHERE id = 'tx-on-r1'").get();
    check("delete cascade: transaction referencing s1's resource preserved", !!txOnR1);
    check("delete cascade: that transaction's resource_id nulled", txOnR1.resource_id === null);

    // Admin-feed notification about r1 has resource_id nulled, but is PRESERVED
    const adminFeedNotif = DB._raw.prepare("SELECT * FROM notifications WHERE id = 'n-admin-feed'").get();
    check("delete cascade: admin-feed notification about s1's resource preserved", !!adminFeedNotif);
    check("delete cascade: that notification's resource_id nulled", adminFeedNotif.resource_id === null);

    // s1's OWN bookmark/download log (as the actor, on someone else's resource) deleted
    check("delete cascade: s1's own bookmark deleted", DB._raw.prepare("SELECT id FROM bookmarks WHERE id = 'bm-own'").get() === undefined);
    check("delete cascade: s1's own download log deleted", DB._raw.prepare("SELECT id FROM download_logs WHERE id = 'dl-own'").get() === undefined);

    // s1's OWN transaction preserved, user_id nulled (financial history survives)
    const ownTx = DB._raw.prepare("SELECT * FROM transactions WHERE id = 'tx-own'").get();
    check("delete cascade: s1's own transaction PRESERVED", !!ownTx);
    check("delete cascade: s1's own transaction user_id nulled", ownTx.user_id === null);

    // s1's RECEIVED notification is DELETED outright (not nulled, to avoid falsely appearing in admin feed)
    check("delete cascade: notification s1 received is deleted, not nulled", DB._raw.prepare("SELECT id FROM notifications WHERE id = 'n-received'").get() === undefined);

    // r1's reviewed_by would have been nulled too, but r1 itself is gone so nothing to check there directly —
    // instead confirm no orphaned reference broke anything by checking adminReviewer is unaffected.
    check("delete cascade: reviewer account itself untouched", !!DB._raw.prepare("SELECT id FROM users WHERE id = 'adminReviewer'").get());

    // Deleted-account log + admin notification were created
    const log = DB._raw.prepare("SELECT * FROM deleted_account_logs WHERE email = 's1@example.com'").get();
    check("delete cascade: deleted_account_log created", !!log);
    check("delete cascade: log captured wallet balance snapshot", log.wallet_balance_at_deletion === 500);
    check("delete cascade: log captured total_deposited (tx-own, successful)", log.total_deposited === 1000);

    const deletionNotif = DB._raw.prepare("SELECT * FROM notifications WHERE deleted_account_log_id = ?").get(log.id);
    check("delete cascade: account_deleted notification created in admin feed", !!deletionNotif && deletionNotif.recipient_id === null);

    // Auth cache invalidation: the SAME token that worked before deletion must now be rejected
    const postDeleteRes = await getAuthed("/api/users/me", token, env);
    check("delete cascade: same token rejected immediately after deletion (cache invalidated)", postDeleteRes.status === 401, postDeleteRes.status);

    restoreFetch();
  }
  {
    // reviewed_by / created_by nulling for an admin who reviewed/announced, then deletes their own account
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "uploader1" });
    DB._raw.prepare(
      `INSERT INTO resources (id, title, type, department, course, level, semester, session, uploader_id, file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, status, reviewed_by)
       VALUES ('r1', 'T', 'Textbook', 'CS', 'CSC301', '300', 'First', '2024/2025', 'uploader1', 'f.pdf', 'https://x', 'pub-r1', 1000, 'pdf', 'approved', 'admin1')`
    ).run();
    const timestamp = new Date().toISOString();
    DB._raw.prepare(`INSERT INTO announcements (id, title, message, target_departments, target_levels, created_by, recipient_count, created_at, updated_at) VALUES ('a1', 'T', 'M', '[]', '[]', 'admin1', 0, ?, ?)`).run(timestamp, timestamp);

    const token = await tokenFor(env, "admin1", "admin");
    installMocks();
    const res = await deleteAuthed("/api/users/me", { confirmation: "DELETE" }, token, env);
    check("delete cascade (admin): 200 status", res.status === 200, JSON.stringify(await res.json()));

    const resourceRow = DB._raw.prepare("SELECT reviewed_by FROM resources WHERE id = 'r1'").get();
    check("delete cascade (admin): reviewed_by nulled on resources they reviewed (not their own)", resourceRow.reviewed_by === null);
    check("delete cascade (admin): the reviewed resource itself is NOT deleted (uploader1 still owns it)", !!resourceRow);

    const annRow = DB._raw.prepare("SELECT created_by FROM announcements WHERE id = 'a1'").get();
    check("delete cascade (admin): announcement preserved", !!annRow);
    check("delete cascade (admin): announcement's created_by nulled", annRow.created_by === null);

    restoreFetch();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("TEST RUNNER CRASHED:", e);
  process.exit(1);
});
