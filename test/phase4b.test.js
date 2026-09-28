import fs from "node:fs";
import { sign } from "hono/jwt";
import app from "../src/index.js";
import { createMockD1 } from "./mockD1.js";

const schemaSql = fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) {
    console.log("OK  -", label);
    passed++;
  } else {
    console.log("FAIL-", label, extra);
    failed++;
  }
}

function freshEnv() {
  const DB = createMockD1(schemaSql);
  return { env: { DB, JWT_SECRET: "test-secret", CLOUDINARY_CLOUD_NAME: "sharef-cloud" }, DB };
}

async function tokenFor(env, id, role = "student") {
  const now = Math.floor(Date.now() / 1000);
  return sign({ id, role, iat: now, exp: now + 604800 }, env.JWT_SECRET);
}

async function getAuthed(path, token, env) {
  return app.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }), env);
}

function seedUser(DB, { id, department = null, role = "student" }) {
  DB._raw
    .prepare(`INSERT INTO users (id, full_name, email, password, role, department, is_verified, preferences) VALUES (?, ?, ?, ?, ?, ?, 1, '{}')`)
    .run(id, `User ${id}`, `${id}@example.com`, "hash", role, department);
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seedResource(DB, opts) {
  const {
    id, uploader = "u1", status = "approved", department = "CS", type = "Textbook",
    title = "Resource " + id, course = "CS301", downloads = 0, createdAt = new Date().toISOString(),
    previewType = "none", previewSnippet = "", previewMessage = "", session = "2024/2025", semester = "First",
  } = opts;
  DB._raw
    .prepare(
      `INSERT INTO resources
       (id, title, type, department, course, level, semester, session, uploader_id,
        file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension,
        status, downloads, created_at, preview_type, preview_snippet, preview_message)
       VALUES (?, ?, ?, ?, ?, '300', ?, ?, ?, 'f.pdf', 'https://x/f.pdf', 'pub', 102400, 'pdf', ?, ?, ?, ?, ?, ?)`
    )
    .run(id, title, type, department, course, semester, session, uploader, status, downloads, createdAt, previewType, previewSnippet, previewMessage);
}

function seedDownload(DB, { id, user, resource, createdAt = new Date().toISOString() }) {
  DB._raw
    .prepare(`INSERT INTO download_logs (id, user_id, resource_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, user, resource, createdAt, createdAt);
}

async function run() {
  // =========================================================================
  // getRecentFeed
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1", createdAt: isoDaysAgo(1) }); // within 7 days
    seedResource(DB, { id: "r2", createdAt: isoDaysAgo(10) }); // too old
    seedResource(DB, { id: "r3", createdAt: isoDaysAgo(2), status: "pending" }); // not approved
    const token = await tokenFor(env, "u1");

    const res = await getAuthed("/api/resources/recent", token, env);
    const body = await res.json();
    check("recent: 200 status", res.status === 200);
    check("recent: only the in-window approved resource returned", body.resources.length === 1 && body.resources[0].id === "r1", JSON.stringify(body));
  }

  // =========================================================================
  // getTrending
  // =========================================================================
  {
    // no department set -> empty, no error
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", department: null });
    const token = await tokenFor(env, "u1");
    const res = await getAuthed("/api/resources/trending", token, env);
    const body = await res.json();
    check("trending: no department -> 200 with empty list", res.status === 200 && body.resources.length === 0);
  }
  {
    // department scoping: a higher-download resource in ANOTHER department must not outrank an in-department one
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", department: "CS" });
    seedUser(DB, { id: "someone" });
    seedResource(DB, { id: "cs-r1", department: "CS" });
    seedResource(DB, { id: "eng-r1", department: "Engineering" });
    // eng-r1 gets 5 downloads, cs-r1 gets 2 — but only cs-r1 should show for a CS student
    for (let i = 0; i < 5; i++) seedDownload(DB, { id: `d-eng-${i}`, user: "someone", resource: "eng-r1", createdAt: isoDaysAgo(1) });
    for (let i = 0; i < 2; i++) seedDownload(DB, { id: `d-cs-${i}`, user: "someone", resource: "cs-r1", createdAt: isoDaysAgo(1) });

    const token = await tokenFor(env, "u1");
    const res = await getAuthed("/api/resources/trending", token, env);
    const body = await res.json();
    check("trending: department-scoped, cross-dept resource excluded even with more downloads",
      body.resources.length === 1 && body.resources[0].id === "cs-r1", JSON.stringify(body));
    check("trending: recentDownloads count correct", body.resources[0].recentDownloads === 2);
  }
  {
    // downloads outside the 3-day window don't count
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", department: "CS" });
    seedUser(DB, { id: "someone" });
    seedResource(DB, { id: "r1", department: "CS" });
    seedDownload(DB, { id: "d1", user: "someone", resource: "r1", createdAt: isoDaysAgo(10) }); // too old
    const token = await tokenFor(env, "u1");
    const res = await getAuthed("/api/resources/trending", token, env);
    const body = await res.json();
    check("trending: stale downloads excluded from window", body.resources.length === 0, JSON.stringify(body));
  }

  // =========================================================================
  // getContinueLearning
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1" });
    seedResource(DB, { id: "r2" });
    seedResource(DB, { id: "r3", status: "pending" }); // should never show even if downloaded

    // r1 downloaded twice (older + newer) -> should dedupe to ONE entry, most recent
    seedDownload(DB, { id: "d1", user: "u1", resource: "r1", createdAt: isoDaysAgo(5) });
    seedDownload(DB, { id: "d2", user: "u1", resource: "r1", createdAt: isoDaysAgo(1) });
    seedDownload(DB, { id: "d3", user: "u1", resource: "r2", createdAt: isoDaysAgo(3) });
    seedDownload(DB, { id: "d4", user: "u1", resource: "r3", createdAt: isoDaysAgo(1) }); // pending resource

    const token = await tokenFor(env, "u1");
    const res = await getAuthed("/api/resources/continue-learning", token, env);
    const body = await res.json();
    check("continue-learning: dedupes to 2 resources (r3 excluded)", body.resources.length === 2, JSON.stringify(body));
    check("continue-learning: most recent first", body.resources[0].id === "r1");
  }
  {
    // another user's downloads don't leak in
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedUser(DB, { id: "u2" });
    seedResource(DB, { id: "r1" });
    seedDownload(DB, { id: "d1", user: "u2", resource: "r1" });
    const token = await tokenFor(env, "u1");
    const res = await getAuthed("/api/resources/continue-learning", token, env);
    const body = await res.json();
    check("continue-learning: isolated per user", body.resources.length === 0);
  }

  // =========================================================================
  // searchPastQuestions
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "pq1", type: "Past Question", title: "CSC301 Past Questions", course: "CSC301", session: "2023/2024", semester: "First", downloads: 5 });
    seedResource(DB, { id: "pq2", type: "Past Question", title: "MTH201 Past Questions", course: "MTH201", session: "2024/2025", semester: "Second", downloads: 20 });
    seedResource(DB, { id: "note1", type: "Lecture Note", title: "Not a past question" });
    const token = await tokenFor(env, "u1");

    const resAll = await getAuthed("/api/resources/past-questions", token, env);
    const bodyAll = await resAll.json();
    check("past-questions: only type=Past Question returned", bodyAll.resources.length === 2, JSON.stringify(bodyAll));

    const resSearch = await getAuthed("/api/resources/past-questions?search=CSC", token, env);
    const bodySearch = await resSearch.json();
    check("past-questions: search filters by course/title", bodySearch.resources.length === 1 && bodySearch.resources[0].id === "pq1");

    const resSession = await getAuthed("/api/resources/past-questions?session=2024%2F2025", token, env);
    const bodySession = await resSession.json();
    check("past-questions: session filter", bodySession.resources.length === 1 && bodySession.resources[0].id === "pq2");

    const resSort = await getAuthed("/api/resources/past-questions?sort=downloads", token, env);
    const bodySort = await resSort.json();
    check("past-questions: sort=downloads puts higher-download first", bodySort.resources[0].id === "pq2");
  }

  // =========================================================================
  // getResourcePreview
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r-text", previewType: "text", previewSnippet: "Once upon a time..." });
    seedResource(DB, { id: "r-none", previewType: "none", previewMessage: "Custom unavailable message" });
    seedResource(DB, { id: "r-pending", status: "pending" });
    const token = await tokenFor(env, "u1");

    const res1 = await getAuthed("/api/resources/r-text/preview", token, env);
    const body1 = await res1.json();
    check("preview: text type returns snippet", body1.previewType === "text" && body1.snippet === "Once upon a time...");

    const res2 = await getAuthed("/api/resources/r-none/preview", token, env);
    const body2 = await res2.json();
    check("preview: none type returns custom message", body2.previewType === "none" && body2.message === "Custom unavailable message");

    const res3 = await getAuthed("/api/resources/r-pending/preview", token, env);
    check("preview: pending resource -> 404", res3.status === 404);

    const res4 = await getAuthed("/api/resources/does-not-exist/preview", token, env);
    check("preview: nonexistent resource -> 404", res4.status === 404);
  }

  // =========================================================================
  // getResourcePreview — lazy "pending" compute-and-cache flow
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    // preview_type defaults to 'pending' per the schema — matches what a
    // real upload now inserts (see resourceController.js's uploadResource).
    seedResource(DB, { id: "r-pending-preview", previewType: "pending" });
    DB._raw.prepare("UPDATE resources SET file_name = 'notes.pdf', file_url = 'https://res.cloudinary.com/sharef-cloud/raw/upload/notes.pdf' WHERE id = 'r-pending-preview'").run();

    // Real hand-built single-page PDF with real extractable text, same one
    // validated directly against unpdf earlier in this project.
    function buildRealPdfBytes() {
      const objects = {};
      objects[1] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
      objects[2] = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
      objects[3] = "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 300 144] /Contents 5 0 R >>\nendobj\n";
      objects[4] = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
      const streamContent = "BT /F1 24 Tf 100 100 Td (Lazy Preview Works) Tj ET";
      objects[5] = `5 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
      let pdf = "%PDF-1.4\n";
      const offsets = [0];
      for (let i = 1; i <= 5; i++) { offsets[i] = pdf.length; pdf += objects[i]; }
      const xrefStart = pdf.length;
      pdf += "xref\n0 6\n0000000000 65535 f \n";
      for (let i = 1; i <= 5; i++) pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
      pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
      return Buffer.from(pdf, "latin1");
    }

    const realFetch = globalThis.fetch;
    let fetchCallCount = 0;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === "string" && url.includes("res.cloudinary.com")) {
        fetchCallCount++;
        return new Response(buildRealPdfBytes(), { status: 200 });
      }
      return realFetch(url, opts);
    };

    const token = await tokenFor(env, "u1");

    // First view: should fetch from Cloudinary, actually run unpdf, and cache the result
    const res1 = await getAuthed("/api/resources/r-pending-preview/preview", token, env);
    const body1 = await res1.json();
    check("preview (lazy): first view -> 200 with real extracted text", res1.status === 200 && body1.previewType === "text", JSON.stringify(body1));
    check("preview (lazy): snippet contains real extracted text", body1.snippet.includes("Lazy"), body1.snippet);
    check("preview (lazy): Cloudinary was fetched exactly once", fetchCallCount === 1);

    const row = DB._raw.prepare("SELECT preview_type, preview_snippet FROM resources WHERE id = 'r-pending-preview'").get();
    check("preview (lazy): D1 row updated to 'text'", row.preview_type === "text");
    check("preview (lazy): D1 row cached the snippet", row.preview_snippet.includes("Lazy"));

    // Second view: should use the cached row, NOT fetch Cloudinary again
    const res2 = await getAuthed("/api/resources/r-pending-preview/preview", token, env);
    const body2 = await res2.json();
    check("preview (lazy): second view -> 200 from cache", res2.status === 200 && body2.snippet.includes("Lazy"));
    check("preview (lazy): Cloudinary NOT fetched again (still 1 call total)", fetchCallCount === 1);

    globalThis.fetch = realFetch;
  }

  // =========================================================================
  // getResources (main browse)
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "uploader1" });
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1", uploader: "uploader1", department: "CS", downloads: 3 });
    seedResource(DB, { id: "r2", uploader: "uploader1", department: "Engineering", downloads: 10 });
    seedResource(DB, { id: "r3", uploader: "uploader1", status: "pending" }); // must never show in public browse
    const token = await tokenFor(env, "u1");

    const resAll = await getAuthed("/api/resources", token, env);
    const bodyAll = await resAll.json();
    check("resources: pending excluded from public browse", bodyAll.total === 2, JSON.stringify(bodyAll));
    check("resources: uploader name joined in", bodyAll.resources.every((r) => r.uploader === "User uploader1"), JSON.stringify(bodyAll.resources));

    const resDept = await getAuthed("/api/resources?department=CS", token, env);
    const bodyDept = await resDept.json();
    check("resources: department filter", bodyDept.total === 1 && bodyDept.resources[0].id === "r1");

    const resPopular = await getAuthed("/api/resources?sort=popular", token, env);
    const bodyPopular = await resPopular.json();
    check("resources: sort=popular orders by downloads desc", bodyPopular.resources[0].id === "r2");
  }
  {
    // pagination
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    for (let i = 0; i < 15; i++) seedResource(DB, { id: `r${i}`, createdAt: isoDaysAgo(i) });
    const token = await tokenFor(env, "u1");

    const res1 = await getAuthed("/api/resources?limit=10&page=1", token, env);
    const body1 = await res1.json();
    check("resources: pagination page 1 has 10", body1.resources.length === 10 && body1.total === 15 && body1.totalPages === 2);

    const res2 = await getAuthed("/api/resources?limit=10&page=2", token, env);
    const body2 = await res2.json();
    check("resources: pagination page 2 has remaining 5", body2.resources.length === 5);
  }

  // =========================================================================
  // getMyUploads
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedUser(DB, { id: "u2" });
    seedResource(DB, { id: "r1", uploader: "u1", status: "approved" });
    seedResource(DB, { id: "r2", uploader: "u1", status: "pending" });
    seedResource(DB, { id: "r3", uploader: "u2", status: "approved" }); // someone else's
    DB._raw.prepare("UPDATE resources SET rejection_reason = ? WHERE id = ?").run("Blurry scan", "r2");

    const token = await tokenFor(env, "u1");
    const res = await getAuthed("/api/resources/my-uploads", token, env);
    const body = await res.json();
    check("my-uploads: only own uploads, any status", body.total === 2, JSON.stringify(body));

    const resStatus = await getAuthed("/api/resources/my-uploads?status=pending", token, env);
    const bodyStatus = await resStatus.json();
    check("my-uploads: status filter works", bodyStatus.total === 1 && bodyStatus.resources[0].id === "r2");
    check("my-uploads: rejectionReason included", bodyStatus.resources[0].rejectionReason === "Blurry scan");
  }

  // =========================================================================
  // getResourceById
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "owner" });
    seedUser(DB, { id: "otherStudent" });
    seedUser(DB, { id: "adminUser", role: "admin" });
    seedResource(DB, { id: "pending1", uploader: "owner", status: "pending" });
    seedResource(DB, { id: "approved1", uploader: "owner", status: "approved" });

    const ownerToken = await tokenFor(env, "owner");
    const otherToken = await tokenFor(env, "otherStudent");
    const adminToken = await tokenFor(env, "adminUser", "admin");

    const r1 = await getAuthed("/api/resources/pending1", ownerToken, env);
    check("getById: owner can see own pending resource", r1.status === 200);

    const r2 = await getAuthed("/api/resources/pending1", otherToken, env);
    check("getById: other student -> 404 for pending resource", r2.status === 404);

    const r3 = await getAuthed("/api/resources/pending1", adminToken, env);
    check("getById: admin can see pending resource", r3.status === 200);

    const r4 = await getAuthed("/api/resources/approved1", otherToken, env);
    check("getById: anyone can see approved resource", r4.status === 200);

    const r5 = await getAuthed("/api/resources/does-not-exist", otherToken, env);
    check("getById: nonexistent -> 404", r5.status === 404);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("TEST RUNNER CRASHED:", e);
  process.exit(1);
});
