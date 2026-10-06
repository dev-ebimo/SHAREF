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
    env: {
      DB, JWT_SECRET: "test-secret",
      CLOUDINARY_CLOUD_NAME: "sharef-cloud", CLOUDINARY_API_KEY: "fake-key", CLOUDINARY_API_SECRET: "fake-secret",
      SENDGRID_API_KEY: "SG.fake", SENDGRID_FROM_EMAIL: "noreply@sharef.test",
    },
    DB,
  };
}

async function tokenFor(env, id, role = "student") {
  const now = Math.floor(Date.now() / 1000);
  return sign({ id, role, iat: now, exp: now + 604800 }, env.JWT_SECRET);
}

function seedUser(DB, { id, role = "student", preferences = null }) {
  const prefsJson = preferences ? JSON.stringify(preferences) : "{}";
  DB._raw
    .prepare(`INSERT INTO users (id, full_name, email, password, role, is_verified, preferences) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .run(id, `User ${id}`, `${id}@example.com`, "hash", role, prefsJson);
}

function fullPrefs({ inApp = true, email = true } = {}) {
  return {
    landingPage: "dashboard",
    moderation: { landingPage: "pending", itemsPerPage: 25, autoOpenNext: true, confirmBeforeApproval: false, confirmBeforeRejection: true },
    review: { defaultSort: "oldest" },
    notifications: { uploadStatus: { email, inApp }, announcements: { email: true, inApp: true } },
  };
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seedResource(DB, opts) {
  DB._raw
    .prepare(`INSERT OR IGNORE INTO users (id, full_name, email, password, is_verified, preferences) VALUES ('u1', 'User u1', 'u1@example.com', 'hash', 1, '{}')`)
    .run();
  const {
    id, uploader = "u1", status = "pending", department = "CS", type = "Textbook", title = "Notes " + id,
    course = "CSC301", downloads = 0, createdAt = new Date().toISOString(), reviewedAt = null, reviewedBy = null,
    rejectionReason = "", previewType = "pending", fileUrl = "https://res.cloudinary.com/sharef-cloud/raw/upload/f.pdf",
    fileName = "f.pdf", cloudinaryPublicId = "sharef_resources/" + id, previewImagePublicId = null,
  } = opts;
  DB._raw
    .prepare(
      `INSERT INTO resources
       (id, title, type, department, course, level, semester, session, uploader_id,
        file_name, file_url, cloudinary_public_id, preview_image_public_id, file_size_bytes, file_extension,
        status, downloads, created_at, reviewed_at, reviewed_by, rejection_reason, preview_type)
       VALUES (?, ?, ?, ?, ?, '300', 'First', '2024/2025', ?, ?, ?, ?, ?, 102400, 'pdf', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, title, type, department, course, uploader, fileName, fileUrl, cloudinaryPublicId, previewImagePublicId, status, downloads, createdAt, reviewedAt, reviewedBy, rejectionReason, previewType);
}

function withExecutionCtx() {
  const tasks = [];
  return {
    ctx: { waitUntil: (p) => tasks.push(p), passThroughOnException() {} },
    async drain() {
      await Promise.all(tasks);
    },
  };
}

async function getAuthed(path, token, env, ctx = withExecutionCtx().ctx) {
  return app.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }), env, ctx);
}
async function postAuthed(path, body, token, env, ctx = withExecutionCtx().ctx) {
  return app.fetch(
    new Request(`http://localhost${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }),
    env,
    ctx
  );
}
async function deleteAuthed(path, token, env, ctx = withExecutionCtx().ctx) {
  return app.fetch(new Request(`http://localhost${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }), env, ctx);
}

// What the admin's browser submits when approving (page count + preview snippet).
const REVIEW = { pages: 7, snippet: "Intro to algorithms and data structures" };

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
      const body = opts.body;
      const publicId = body.get ? body.get("public_id") : null;
      cloudinaryDestroyCalls.push(publicId);
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    }
    return realFetch(url, opts);
  };
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

async function run() {
  // =========================================================================
  // Non-admin access is blocked entirely
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "student1", role: "student" });
    const token = await tokenFor(env, "student1", "student");
    const res = await getAuthed("/api/admin/moderation/queue", token, env);
    check("moderation: non-admin blocked -> 403", res.status === 403);
  }

  // =========================================================================
  // getModerationQueue
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedResource(DB, { id: "r1", status: "pending", createdAt: isoDaysAgo(1), previewType: "pending" });
    seedResource(DB, { id: "r2", status: "pending", createdAt: isoDaysAgo(6) }); // aged (>4 days)
    seedResource(DB, { id: "r3", status: "approved" }); // shouldn't appear in queue
    const token = await tokenFor(env, "admin1", "admin");

    const res = await getAuthed("/api/admin/moderation/queue", token, env);
    const body = await res.json();
    check("queue: 200 status", res.status === 200, JSON.stringify(body));
    check("queue: only pending resources listed", body.queue.length === 2);
    check("queue: aged flag correctly set", body.queue.find((q) => q.id === "r2").isAged === true);
    check("queue: non-aged flag correctly false", body.queue.find((q) => q.id === "r1").isAged === false);
    check("queue: internal preview state is no longer exposed", body.queue.find((q) => q.id === "r1").previewType === undefined);
    check("queue: uploader name joined in", body.queue[0].uploader === "User u1");
    check("queue: stats.pending correct", body.stats.pending === 2);
    check("queue: stats.approved correct", body.stats.approved === 1);
  }
  {
    // sort order
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedResource(DB, { id: "old", createdAt: isoDaysAgo(5) });
    seedResource(DB, { id: "new", createdAt: isoDaysAgo(1) });
    const token = await tokenFor(env, "admin1", "admin");

    const resOldest = await getAuthed("/api/admin/moderation/queue?sort=oldest", token, env);
    const bodyOldest = await resOldest.json();
    check("queue: sort=oldest (default) puts oldest first", bodyOldest.queue[0].id === "old");

    const resNewest = await getAuthed("/api/admin/moderation/queue?sort=newest", token, env);
    const bodyNewest = await resNewest.json();
    check("queue: sort=newest puts newest first", bodyNewest.queue[0].id === "new");
  }

  // =========================================================================
  // approveResource
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "uploader1", preferences: fullPrefs({ inApp: true, email: true }) });
    seedResource(DB, { id: "r1", uploader: "uploader1", status: "pending" });
    const timestamp = new Date().toISOString();
    DB._raw
      .prepare(`INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES ('n-admin-feed', 'r1', NULL, 'new_upload', 1, ?, ?)`)
      .run(timestamp, timestamp);

    const token = await tokenFor(env, "admin1", "admin");
    installMocks();
    const { ctx, drain } = withExecutionCtx();
    const res = await postAuthed("/api/admin/moderation/r1/approve", REVIEW, token, env, ctx);
    await drain();
    const body = await res.json();
    check("approve: 200 status", res.status === 200, JSON.stringify(body));

    const row = DB._raw.prepare("SELECT * FROM resources WHERE id = 'r1'").get();
    check("approve: status flipped to approved", row.status === "approved");
    check("approve: reviewed_by set", row.reviewed_by === "admin1");
    check("approve: reviewed_at set", !!row.reviewed_at);
    check("approve: reviewer-confirmed page count stored", row.pages === 7, String(row.pages));
    check("approve: preview snippet stored and preview_type resolved to 'text'", row.preview_type === "text" && row.preview_snippet === REVIEW.snippet);

    const notif = DB._raw.prepare("SELECT * FROM notifications WHERE recipient_id = 'uploader1'").get();
    check("approve: uploader in-app notification created", !!notif && notif.type === "resource_approved");

    check("approve: uploader email sent (per their preference)", sentEmails.length === 1);
    check("approve: email sent to correct address", sentEmails[0].personalizations[0].to[0].email === "uploader1@example.com");

    const adminFeedNotif = DB._raw.prepare("SELECT * FROM notifications WHERE id = 'n-admin-feed'").get();
    check("approve: shared admin-feed notification for this resource cleared", adminFeedNotif === undefined);

    restoreFetch();
  }
  {
    // preferences respected: inApp off, email off
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "uploader1", preferences: fullPrefs({ inApp: false, email: false }) });
    seedResource(DB, { id: "r1", uploader: "uploader1", status: "pending" });
    const token = await tokenFor(env, "admin1", "admin");
    installMocks();

    const { ctx, drain } = withExecutionCtx();
    await postAuthed("/api/admin/moderation/r1/approve", REVIEW, token, env, ctx);
    await drain();
    const notif = DB._raw.prepare("SELECT * FROM notifications WHERE recipient_id = 'uploader1'").get();
    check("approve: no in-app notification when preference is off", notif === undefined);
    check("approve: no email sent when preference is off", sentEmails.length === 0);
    restoreFetch();
  }
  {
    // atomic guard: double-approve
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "uploader1", preferences: fullPrefs() });
    seedResource(DB, { id: "r1", uploader: "uploader1", status: "pending" });
    const token = await tokenFor(env, "admin1", "admin");
    installMocks();

    const { ctx, drain } = withExecutionCtx();
    const res1 = await postAuthed("/api/admin/moderation/r1/approve", REVIEW, token, env, ctx);
    check("approve: first approval succeeds", res1.status === 200);
    const res2 = await postAuthed("/api/admin/moderation/r1/approve", REVIEW, token, env, ctx);
    check("approve: second approval on already-approved -> 409", res2.status === 409);
    await drain();
    check("approve: uploader notified only once despite double-approve attempt", sentEmails.length === 1);
    restoreFetch();
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await postAuthed("/api/admin/moderation/does-not-exist/approve", REVIEW, token, env);
    check("approve: nonexistent resource -> 404", res.status === 404);
  }

  // =========================================================================
  // rejectResource
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "uploader1", preferences: fullPrefs() });
    seedResource(DB, { id: "r1", uploader: "uploader1", status: "pending" });
    const token = await tokenFor(env, "admin1", "admin");
    installMocks();

    const res = await postAuthed("/api/admin/moderation/r1/reject", { reason: "Blurry scan" }, token, env);
    check("reject: 200 status", res.status === 200);

    const row = DB._raw.prepare("SELECT * FROM resources WHERE id = 'r1'").get();
    check("reject: status flipped to rejected", row.status === "rejected");
    check("reject: rejection_reason stored", row.rejection_reason === "Blurry scan");

    const notif = DB._raw.prepare("SELECT * FROM notifications WHERE recipient_id = 'uploader1'").get();
    check("reject: uploader notified with resource_rejected type", notif.type === "resource_rejected");

    restoreFetch();
  }
  {
    // approval REQUIRES a sane page count; nothing changes if it's missing/invalid
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedResource(DB, { id: "r1", status: "pending" });
    const token = await tokenFor(env, "admin1", "admin");
    const bad = [null, {}, { pages: 0 }, { pages: -3 }, { pages: 1001 }, { pages: 2.5 }, { pages: "7" }, { pages: NaN }, { pages: { $gt: 0 } }, { snippet: "no pages" }];
    let allRejected = true;
    for (const b of bad) {
      const r = await postAuthed("/api/admin/moderation/r1/approve", b, token, env);
      if (r.status !== 400) { allRejected = false; console.log("   not rejected:", JSON.stringify(b), r.status); }
    }
    check("approve: missing / invalid page counts all rejected with 400", allRejected);
    check("approve: ...and the resource is still pending", DB._raw.prepare("SELECT status FROM resources WHERE id='r1'").get().status === "pending");
    const msg = await (await postAuthed("/api/admin/moderation/r1/approve", { pages: 0 }, token, env)).json();
    check("approve: 400 explains what to enter", /page count/i.test(msg.message), JSON.stringify(msg));
    const edge = await postAuthed("/api/admin/moderation/r1/approve", { pages: 1000 }, token, env);
    check("approve: 1000 pages (upper bound) accepted", edge.status === 200);
  }
  {
    // no snippet (scanned PDF, ZIP, image...) -> approved with preview 'none'; snippet is sanitised and capped
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedResource(DB, { id: "r1", status: "pending" });
    seedResource(DB, { id: "r2", status: "pending" });
    const token = await tokenFor(env, "admin1", "admin");
    await postAuthed("/api/admin/moderation/r1/approve", { pages: 1 }, token, env);
    const r1 = DB._raw.prepare("SELECT preview_type, preview_snippet, preview_message FROM resources WHERE id='r1'").get();
    check("approve: no snippet -> preview_type 'none' with a message", r1.preview_type === "none" && r1.preview_snippet === "" && r1.preview_message.length > 0);
    await postAuthed("/api/admin/moderation/r2/approve", { pages: 2, snippet: "line1\u0000\u0007\n\n  line2 " + "x".repeat(1500) }, token, env);
    const r2 = DB._raw.prepare("SELECT preview_snippet FROM resources WHERE id='r2'").get();
    check("approve: control characters stripped and whitespace collapsed", r2.preview_snippet.startsWith("line1 line2 x"));
    check("approve: snippet capped at ~1000 chars", r2.preview_snippet.length <= 1001, String(r2.preview_snippet.length));
  }
  {
    // reason is optional (quick-reject flow)
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "uploader1", preferences: fullPrefs({ email: false }) });
    seedResource(DB, { id: "r1", uploader: "uploader1", status: "pending" });
    const token = await tokenFor(env, "admin1", "admin");
    installMocks();

    const res = await postAuthed("/api/admin/moderation/r1/reject", null, token, env);
    check("reject: no reason still succeeds (quick-reject)", res.status === 200);
    const row = DB._raw.prepare("SELECT rejection_reason FROM resources WHERE id = 'r1'").get();
    check("reject: rejection_reason defaults to empty string", row.rejection_reason === "");
    restoreFetch();
  }

  // =========================================================================
  // getResourcePreviewForAdmin — the Worker no longer reads or parses the file;
  // it only hands the admin's browser a short-lived link to analyse itself.
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedResource(DB, { id: "r-pending", previewType: "pending", fileName: "week3.docx" });
    DB._raw.prepare("UPDATE resources SET file_extension = 'docx' WHERE id = 'r-pending'").run();
    const token = await tokenFor(env, "admin1", "admin");

    let fetchCalls = 0;
    globalThis.fetch = async (url, opts) => { fetchCalls++; return realFetch(url, opts); };

    const res = await getAuthed("/api/admin/moderation/r-pending/preview", token, env);
    const body = await res.json();
    check("admin preview: 200 with a signed stream link", res.status === 200 && body.success && body.fileUrl.includes("/stream?token="), JSON.stringify(body));
    check("admin preview: tells the browser the file name + type to analyse", body.fileName === "week3.docx" && body.fileExtension === "docx");
    check("admin preview: Worker did NOT fetch or parse the file", fetchCalls === 0);
    check("admin preview: no server-extracted text in the response", body.fullText === undefined && body.previewType === undefined);

    const missing = await getAuthed("/api/admin/moderation/nope/preview", token, env);
    check("admin preview: unknown resource -> 404", missing.status === 404);
    const noAuth = await app.fetch(new Request("http://localhost/api/admin/moderation/r-pending/preview"), env);
    check("admin preview: requires auth", noAuth.status === 401);

    restoreFetch();
  }

  // =========================================================================
  // getPendingCount
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedResource(DB, { id: "r1", status: "pending", createdAt: isoDaysAgo(1) });
    seedResource(DB, { id: "r2", status: "pending", createdAt: isoDaysAgo(6) }); // aged
    seedResource(DB, { id: "r3", status: "approved" });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/moderation/pending-count", token, env);
    const body = await res.json();
    check("pending-count: correct pending", body.pending === 2);
    check("pending-count: correct approved", body.approved === 1);
    check("pending-count: correct agedCount", body.agedCount === 1);
  }

  // =========================================================================
  // getFilterOptions
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedResource(DB, { id: "r1", status: "approved", department: "Physics", course: "PHY201" });
    seedResource(DB, { id: "r2", status: "rejected", department: "Chemistry", course: "CHM101" });
    seedResource(DB, { id: "r3", status: "pending", department: "Should Not Appear", course: "XXX000" });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await getAuthed("/api/admin/resources/filter-options", token, env);
    const body = await res.json();
    check("filter-options: only approved+rejected departments included", body.departments.includes("Physics") && body.departments.includes("Chemistry") && !body.departments.includes("Should Not Appear"), JSON.stringify(body.departments));
    check("filter-options: rejectionReasons list present", Array.isArray(body.rejectionReasons) && body.rejectionReasons.includes("duplicate"));
  }

  // =========================================================================
  // getApprovedResources / getRejectedResources
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1", status: "approved", title: "CSC301 Notes", course: "CSC301", reviewedAt: new Date().toISOString(), reviewedBy: "admin1" });
    seedResource(DB, { id: "r2", status: "approved", title: "MTH Notes", course: "MTH201", reviewedAt: isoDaysAgo(2) });
    seedResource(DB, { id: "r3", status: "rejected", rejectionReason: "duplicate", reviewedAt: new Date().toISOString() });
    const token = await tokenFor(env, "admin1", "admin");

    const resApproved = await getAuthed("/api/admin/resources/approved", token, env);
    const bodyApproved = await resApproved.json();
    check("approved list: only approved resources", bodyApproved.resources.length === 2, JSON.stringify(bodyApproved));
    check("approved list: reviewer name joined", bodyApproved.resources.find((r) => r.id === "r1").reviewedBy === "User admin1");
    check("approved list: fileUrl issued (real download token)", bodyApproved.resources[0].fileUrl.includes("/stream?token="));

    const resSearch = await getAuthed("/api/admin/resources/approved?search=CSC", token, env);
    const bodySearch = await resSearch.json();
    check("approved list: search filter works", bodySearch.resources.length === 1 && bodySearch.resources[0].id === "r1");

    const resRejected = await getAuthed("/api/admin/resources/rejected", token, env);
    const bodyRejected = await resRejected.json();
    check("rejected list: only rejected resources", bodyRejected.resources.length === 1);
    check("rejected list: rejectionReason included", bodyRejected.resources[0].rejectionReason === "duplicate");

    const resDetails = await getAuthed("/api/admin/resources/r1", token, env);
    const bodyDetails = await resDetails.json();
    check("resource details: correct resource returned", bodyDetails.resource.id === "r1");
  }

  // =========================================================================
  // removeApprovedResource / restoreToPending
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedResource(DB, { id: "r1", status: "approved" });
    const token = await tokenFor(env, "admin1", "admin");

    const noReasonRes = await postAuthed("/api/admin/resources/r1/remove", {}, token, env);
    check("remove: missing reason -> 400", noReasonRes.status === 400);

    const res = await postAuthed("/api/admin/resources/r1/remove", { reason: "Copyright issue" }, token, env);
    check("remove: 200 status", res.status === 200);
    const row = DB._raw.prepare("SELECT status, rejection_reason FROM resources WHERE id = 'r1'").get();
    check("remove: status moved to rejected", row.status === "rejected");
    check("remove: reason stored", row.rejection_reason === "Copyright issue");

    // guard: removing an already-rejected resource via this endpoint fails
    const res2 = await postAuthed("/api/admin/resources/r1/remove", { reason: "Again" }, token, env);
    check("remove: guard blocks acting on a non-approved resource -> 409", res2.status === 409);
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedResource(DB, { id: "r1", status: "rejected", rejectionReason: "duplicate", reviewedAt: new Date().toISOString(), reviewedBy: "admin1" });
    const token = await tokenFor(env, "admin1", "admin");

    const res = await postAuthed("/api/admin/resources/r1/restore", null, token, env);
    check("restore: 200 status", res.status === 200);
    const row = DB._raw.prepare("SELECT status, rejection_reason, reviewed_by, reviewed_at FROM resources WHERE id = 'r1'").get();
    check("restore: status moved to pending", row.status === "pending");
    check("restore: rejection_reason cleared", row.rejection_reason === "");
    check("restore: reviewed_by cleared", row.reviewed_by === null);
    check("restore: reviewed_at cleared", row.reviewed_at === null);

    const res2 = await postAuthed("/api/admin/resources/r1/restore", null, token, env);
    check("restore: guard blocks acting on a non-rejected resource -> 409", res2.status === 409);
  }

  // =========================================================================
  // permanentlyDeleteResource — the big one: cascade + Cloudinary
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1", status: "approved", cloudinaryPublicId: "sharef_resources/target-file" });

    const timestamp = new Date().toISOString();
    DB._raw.prepare(`INSERT INTO bookmarks (id, user_id, resource_id, created_at, updated_at) VALUES ('bm1', 'u1', 'r1', ?, ?)`).run(timestamp, timestamp);
    DB._raw.prepare(`INSERT INTO download_logs (id, user_id, resource_id, created_at, updated_at) VALUES ('dl1', 'u1', 'r1', ?, ?)`).run(timestamp, timestamp);
    DB._raw.prepare(`INSERT INTO transactions (id, user_id, type, amount, status, resource_id, created_at, updated_at) VALUES ('tx1', 'u1', 'purchase', 300, 'successful', 'r1', ?, ?)`).run(timestamp, timestamp);
    DB._raw.prepare(`INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES ('n1', 'r1', 'u1', 'resource_approved', 1, ?, ?)`).run(timestamp, timestamp);

    const token = await tokenFor(env, "admin1", "admin");
    installMocks();

    const res = await deleteAuthed("/api/admin/resources/r1", token, env);
    const body = await res.json();
    check("delete: 200 status", res.status === 200, JSON.stringify(body));
    check("delete: Cloudinary destroy called with correct public_id", cloudinaryDestroyCalls.includes("sharef_resources/target-file"), JSON.stringify(cloudinaryDestroyCalls));

    const resourceRow = DB._raw.prepare("SELECT * FROM resources WHERE id = 'r1'").get();
    check("delete: resource row gone", resourceRow === undefined);

    const bookmarkRow = DB._raw.prepare("SELECT * FROM bookmarks WHERE id = 'bm1'").get();
    check("delete: bookmark deleted (not just orphaned)", bookmarkRow === undefined);

    const downloadLogRow = DB._raw.prepare("SELECT * FROM download_logs WHERE id = 'dl1'").get();
    check("delete: download log deleted", downloadLogRow === undefined);

    const txRow = DB._raw.prepare("SELECT * FROM transactions WHERE id = 'tx1'").get();
    check("delete: transaction record PRESERVED (financial history)", !!txRow);
    check("delete: transaction's resource_id nulled, not left dangling", txRow.resource_id === null);

    const notifRow = DB._raw.prepare("SELECT * FROM notifications WHERE id = 'n1'").get();
    check("delete: notification record PRESERVED", !!notifRow);
    check("delete: notification's resource_id nulled", notifRow.resource_id === null);

    // Confirm the nulled notification doesn't crash the student's notification feed
    // and is correctly filtered out as orphaned (established behavior from phase 4a).
    const u1Token = await tokenFor(env, "u1", "student");
    const notifFeedRes = await getAuthed("/api/notifications/mine", u1Token, env);
    const notifFeedBody = await notifFeedRes.json();
    check("delete: student's notification feed still works, orphan filtered out", notifFeedRes.status === 200 && notifFeedBody.notifications.length === 0, JSON.stringify(notifFeedBody));

    restoreFetch();
  }
  {
    // legacy previewImagePublicId also gets destroyed
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    seedResource(DB, { id: "r1", cloudinaryPublicId: "main-file", previewImagePublicId: "legacy-preview-image" });
    const token = await tokenFor(env, "admin1", "admin");
    installMocks();

    await deleteAuthed("/api/admin/resources/r1", token, env);
    check("delete: legacy preview image also destroyed on Cloudinary", cloudinaryDestroyCalls.includes("legacy-preview-image"), JSON.stringify(cloudinaryDestroyCalls));
    restoreFetch();
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "admin1", role: "admin" });
    const token = await tokenFor(env, "admin1", "admin");
    const res = await deleteAuthed("/api/admin/resources/does-not-exist", token, env);
    check("delete: nonexistent resource -> 404", res.status === 404);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("TEST RUNNER CRASHED:", e);
  process.exit(1);
});
