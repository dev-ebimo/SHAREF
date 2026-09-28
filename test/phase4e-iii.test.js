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
  return { env: { DB, JWT_SECRET: "test-secret" }, DB };
}

async function tokenFor(env, id, role = "student") {
  const now = Math.floor(Date.now() / 1000);
  return sign({ id, role, iat: now, exp: now + 604800 }, env.JWT_SECRET);
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seedUser(DB, { id, role = "student", department = null, level = null, accountStatus = "active", lastLoginAt = new Date().toISOString(), createdAt = new Date().toISOString() }) {
  DB._raw
    .prepare(`INSERT INTO users (id, full_name, email, password, role, department, level, account_status, last_login_at, is_verified, preferences, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '{}', ?, ?)`)
    .run(id, `User ${id}`, `${id}@example.com`, "hash", role, department, level, accountStatus, lastLoginAt, createdAt, createdAt);
}

function seedResource(DB, { id, uploader, status = "approved", downloads = 0 }) {
  DB._raw
    .prepare(
      `INSERT INTO resources (id, title, type, department, course, level, semester, session, uploader_id, file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, status, downloads)
       VALUES (?, ?, 'Textbook', 'CS', 'CSC301', '300', 'First', '2024/2025', ?, 'f.pdf', 'https://x', 'pub-' || ?, 1000, 'pdf', ?, ?)`
    )
    .run(id, "Notes " + id, uploader, id, status, downloads);
}

function seedTransaction(DB, { id, userId, type, amount, status = "successful", resourceId = null }) {
  DB._raw
    .prepare(`INSERT INTO transactions (id, user_id, type, amount, status, resource_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, type, amount, status, resourceId, new Date().toISOString(), new Date().toISOString());
}

async function getAuthed(path, token, env) {
  return app.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }), env);
}
async function postAuthed(path, body, token, env) {
  return app.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);
}

async function run() {
  // =========================================================================
  // Non-admin blocked
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "student1" });
    const token = await tokenFor(env, "student1", "student");
    const res = await getAuthed("/api/admin/users", token, env);
    check("users: non-admin blocked -> 403", res.status === 403);
  }

  // =========================================================================
  // getUserFilterOptions
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "s1", department: "Physics" });
    seedUser(DB, { id: "s2", department: "Chemistry" });
    seedUser(DB, { id: "adminX", role: "admin", department: "Should Not Appear" });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/users/filter-options", token, env);
    const body = await res.json();
    check("filter-options: only student departments", body.departments.includes("Physics") && body.departments.includes("Chemistry") && !body.departments.includes("Should Not Appear"), JSON.stringify(body));
  }

  // =========================================================================
  // getUsers — effective status computation, filters, stats
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "active1", department: "CS", level: "300", accountStatus: "active", lastLoginAt: isoDaysAgo(1) });
    seedUser(DB, { id: "suspended1", department: "CS", level: "300", accountStatus: "suspended", lastLoginAt: isoDaysAgo(1) });
    seedUser(DB, { id: "inactive1", department: "CS", level: "200", accountStatus: "active", lastLoginAt: isoDaysAgo(20) });
    seedResource(DB, { id: "r1", uploader: "active1", status: "approved" });
    seedResource(DB, { id: "r2", uploader: "active1", status: "rejected" });

    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/users", token, env);
    const body = await res.json();
    check("users: 200 status", res.status === 200, JSON.stringify(body));
    check("users: all 3 students returned (admin excluded)", body.users.length === 3);

    const active1 = body.users.find((u) => u.id === "active1");
    check("users: effectiveStatus 'active' computed correctly", active1.effectiveStatus === "active");
    check("users: uploadsCount/approvedCount/rejectedCount correct", active1.uploadsCount === 2 && active1.approvedCount === 1 && active1.rejectedCount === 1);

    const suspended1 = body.users.find((u) => u.id === "suspended1");
    check("users: effectiveStatus 'suspended' wins over recent login", suspended1.effectiveStatus === "suspended");

    const inactive1 = body.users.find((u) => u.id === "inactive1");
    check("users: effectiveStatus 'inactive' from stale login", inactive1.effectiveStatus === "inactive");

    check("users: stats.totalUsers correct", body.stats.totalUsers === 3);
    check("users: stats.contributors correct (only active1 has uploads)", body.stats.contributors === 1);

    // status filter
    const resFiltered = await getAuthed("/api/admin/users?status=inactive", token, env);
    const bodyFiltered = await resFiltered.json();
    check("users: status filter", bodyFiltered.users.length === 1 && bodyFiltered.users[0].id === "inactive1");

    // contribution filter
    const resContrib = await getAuthed("/api/admin/users?contribution=has_uploads", token, env);
    const bodyContrib = await resContrib.json();
    check("users: contribution=has_uploads filter", bodyContrib.users.length === 1 && bodyContrib.users[0].id === "active1");

    // search filter
    const resSearch = await getAuthed("/api/admin/users?search=suspended1", token, env);
    const bodySearch = await resSearch.json();
    check("users: search filter (by full_name containing id)", bodySearch.users.length === 1 && bodySearch.users[0].id === "suspended1", JSON.stringify(bodySearch.users));
  }

  // =========================================================================
  // getUserProfile
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "s1", department: "CS", level: "300", lastLoginAt: isoDaysAgo(1) });
    seedResource(DB, { id: "r1", uploader: "s1", status: "approved", downloads: 5 });
    seedResource(DB, { id: "r2", uploader: "s1", status: "approved", downloads: 3 });
    seedResource(DB, { id: "r3", uploader: "s1", status: "rejected" });
    seedTransaction(DB, { id: "t1", userId: "s1", type: "deposit", amount: 1000, status: "successful" });
    seedTransaction(DB, { id: "t2", userId: "s1", type: "deposit", amount: 500, status: "pending" }); // shouldn't count
    seedTransaction(DB, { id: "t3", userId: "s1", type: "purchase", amount: 300, status: "successful" });

    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/users/s1", token, env);
    const body = await res.json();
    check("user profile: 200 status", res.status === 200, JSON.stringify(body));
    check("user profile: uploadsCount/approvedCount/rejectedCount", body.user.uploadsCount === 3 && body.user.approvedCount === 2 && body.user.rejectedCount === 1);
    check("user profile: approvalRate computed correctly (2/3 = 67%)", body.user.approvalRate === 67);
    check("user profile: totalDownloads summed correctly", body.user.totalDownloads === 8);
    check("user profile: totalDeposited excludes pending transaction", body.user.totalDeposited === 1000);
    check("user profile: totalSpent correct", body.user.totalSpent === 300);
    check("user profile: recentUploads present", body.user.recentUploads.length === 3);
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/users/does-not-exist", token, env);
    check("user profile: nonexistent -> 404", res.status === 404);
  }

  // =========================================================================
  // suspendUser / reactivateUser
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "s1" });
    const token = await tokenFor(env, "admin1", "admin");

    const noReasonRes = await postAuthed("/api/admin/users/s1/suspend", {}, token, env);
    check("suspend: missing reason -> 400", noReasonRes.status === 400);

    const res = await postAuthed("/api/admin/users/s1/suspend", { reason: "Policy violation" }, token, env);
    check("suspend: 200 status", res.status === 200);
    const row = DB._raw.prepare("SELECT account_status, suspension_reason, suspended_at FROM users WHERE id = 's1'").get();
    check("suspend: account_status updated", row.account_status === "suspended");
    check("suspend: reason stored", row.suspension_reason === "Policy violation");
    check("suspend: suspended_at set", !!row.suspended_at);

    const reactivateRes = await postAuthed("/api/admin/users/s1/reactivate", null, token, env);
    check("reactivate: 200 status", reactivateRes.status === 200);
    const row2 = DB._raw.prepare("SELECT account_status, suspension_reason, suspended_at FROM users WHERE id = 's1'").get();
    check("reactivate: account_status back to active", row2.account_status === "active");
    check("reactivate: reason cleared", row2.suspension_reason === "");
    check("reactivate: suspended_at cleared", row2.suspended_at === null);
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await postAuthed("/api/admin/users/does-not-exist/suspend", { reason: "x" }, token, env);
    check("suspend: nonexistent user -> 404", res.status === 404);
  }

  // =========================================================================
  // getDeletedAccountLogs
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const t1 = new Date(Date.now() - 60000).toISOString();
    const t2 = new Date().toISOString();
    DB._raw.prepare(`INSERT INTO deleted_account_logs (id, full_name, email, department, level, uploads_count, total_deposited, total_spent, created_at) VALUES ('log1', 'Old Log', 'old@x.com', 'CS', '300', 2, 500, 200, ?)`).run(t1);
    DB._raw.prepare(`INSERT INTO deleted_account_logs (id, full_name, email, department, level, uploads_count, total_deposited, total_spent, created_at) VALUES ('log2', 'New Log', 'new@x.com', 'Physics', '400', 0, 0, 0, ?)`).run(t2);

    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/users/deleted-log", token, env);
    const body = await res.json();
    check("deleted-log: 200 status", res.status === 200);
    check("deleted-log: newest first", body.logs[0].id === "log2");
    check("deleted-log: fields mapped correctly", body.logs[0].fullName === "New Log" && body.logs[1].totalDeposited === 500);
  }

  // =========================================================================
  // getTransactionSummary
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "active1", accountStatus: "active", lastLoginAt: isoDaysAgo(1) });
    seedUser(DB, { id: "suspended1", accountStatus: "suspended", lastLoginAt: isoDaysAgo(1) });
    seedTransaction(DB, { id: "t1", userId: "active1", type: "deposit", amount: 1000 });
    seedTransaction(DB, { id: "t2", userId: "active1", type: "purchase", amount: 300 });
    seedTransaction(DB, { id: "t3", userId: "suspended1", type: "deposit", amount: 500 });

    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/transactions/summary", token, env);
    const body = await res.json();
    check("tx summary: 200 status", res.status === 200, JSON.stringify(body));
    check("tx summary: active category correct", body.summary.active.volume === 1000 && body.summary.active.spent === 300 && body.summary.active.users === 1);
    check("tx summary: suspended category correct", body.summary.suspended.volume === 500 && body.summary.suspended.users === 1);
    check("tx summary: inactive category empty", body.summary.inactive.count === 0);
    check("tx summary: site-wide totals correct", body.totalDepositVolume === 1500 && body.totalSpentVolume === 300);
  }

  // =========================================================================
  // getTransactions
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "active1", accountStatus: "active", lastLoginAt: isoDaysAgo(1) });
    seedUser(DB, { id: "suspended1", accountStatus: "suspended", lastLoginAt: isoDaysAgo(1) });
    seedTransaction(DB, { id: "t1", userId: "active1", type: "deposit", amount: 1000, status: "successful" });
    seedTransaction(DB, { id: "t2", userId: "suspended1", type: "deposit", amount: 500, status: "failed" });

    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/transactions", token, env);
    const body = await res.json();
    check("transactions: 200 status", res.status === 200, JSON.stringify(body));
    check("transactions: both returned with user names joined", body.transactions.length === 2 && body.transactions.every((t) => t.user));

    const resCategory = await getAuthed("/api/admin/transactions?category=suspended", token, env);
    const bodyCategory = await resCategory.json();
    check("transactions: category filter", bodyCategory.transactions.length === 1 && bodyCategory.transactions[0].id === "t2");

    const resStatus = await getAuthed("/api/admin/transactions?status=failed", token, env);
    const bodyStatus = await resStatus.json();
    check("transactions: status filter", bodyStatus.transactions.length === 1 && bodyStatus.transactions[0].status === "failed");

    const resSearch = await getAuthed("/api/admin/transactions?search=active1", token, env);
    const bodySearch = await resSearch.json();
    check("transactions: search by user email", bodySearch.transactions.length === 1 && bodySearch.transactions[0].id === "t1");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("TEST RUNNER CRASHED:", e);
  process.exit(1);
});
