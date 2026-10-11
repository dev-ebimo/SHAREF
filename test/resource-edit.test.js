// Admin editing of resource metadata: PATCH /api/admin/resources/:id
// Run: node test/resource-edit.test.js
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
async function tokenFor(env, id, role) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ id, role, iat: now, exp: now + 604800 }, env.JWT_SECRET);
}
function seedUser(DB, id, role = "student") {
  DB._raw.prepare(`INSERT INTO users (id, full_name, email, password, role, is_verified, preferences) VALUES (?, ?, ?, ?, ?, 1, '{}')`)
    .run(id, `User ${id}`, `${id}@example.com`, "hash", role);
}
function seedResource(DB, { id, status = "pending", pages = 1, reviewedBy = null, rejectionReason = "" }) {
  DB._raw.prepare(
    `INSERT INTO resources (id, title, type, department, course, level, semester, session, description, uploader_id,
       file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, status, pages, reviewed_by, reviewed_at, rejection_reason)
     VALUES (?, 'Orignal Titel', 'Textbook', 'Compter Science', 'CSC3O1', '300', 'First', '2024/2025', 'old description', 'student1',
       'f.pdf', 'https://res.cloudinary.com/sharef-cloud/raw/upload/f.pdf', ?, 102400, 'pdf', ?, ?, ?, ?, ?)`
  ).run(id, "sharef_resources/" + id, status, pages, reviewedBy, reviewedBy ? "2025-01-01T00:00:00.000Z" : null, rejectionReason);
}
const row = (DB, id) => DB._raw.prepare("SELECT * FROM resources WHERE id = ?").get(id);

// Same Workers-style execution context the other test files hand to app.fetch.
const ctx = { waitUntil() {}, passThroughOnException() {} };

async function patch(env, path, body, token, raw = false) {
  return app.fetch(new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ? body : JSON.stringify(body),
  }), env, ctx);
}

async function run() {
  const { env, DB } = freshEnv();
  seedUser(DB, "student1", "student");
  seedUser(DB, "admin1", "admin");
  seedUser(DB, "admin2", "admin");
  const admin = await tokenFor(env, "admin1", "admin");
  const student = await tokenFor(env, "student1", "student");

  seedResource(DB, { id: "p1", status: "pending" });
  seedResource(DB, { id: "a1", status: "approved", pages: 12, reviewedBy: "admin2" });
  seedResource(DB, { id: "r1", status: "rejected", reviewedBy: "admin2", rejectionReason: "wrong_course" });

  // ---- permissions ----
  {
    const res = await patch(env, "/api/admin/resources/p1", { title: "X" });
    check("no token -> 401", res.status === 401);
    const res2 = await patch(env, "/api/admin/resources/p1", { title: "X" }, student);
    check("student token -> 403", res2.status === 403);
    check("failed attempts changed nothing", row(DB, "p1").title === "Orignal Titel");
  }

  // ---- pending ----
  {
    const before = row(DB, "p1");
    const res = await patch(env, "/api/admin/resources/p1", {
      title: "  Computer Science Handbook  ", type: "Lecture Note", department: "Computer Science",
      course: "CSC 301", level: "400", semester: "Second", session: "2025/2026", description: "Fixed description",
    }, admin);
    const data = await res.json();
    const after = row(DB, "p1");
    check("pending: edit -> 200", res.status === 200 && data.success === true, JSON.stringify(data));
    check("pending: reports changed + all 8 fields", data.changed === true && data.changedFields.length === 8, JSON.stringify(data.changedFields));
    check("pending: values saved (title trimmed)", after.title === "Computer Science Handbook" && after.type === "Lecture Note"
      && after.department === "Computer Science" && after.course === "CSC 301" && after.level === "400"
      && after.semester === "Second" && after.session === "2025/2026" && after.description === "Fixed description");
    check("pending: still pending, not reviewed", after.status === "pending" && after.reviewed_by === null && after.reviewed_at === null);
    check("pending: updated_at moved forward", after.updated_at >= before.updated_at);
    check("pending: response carries fresh resource + status", data.resource.title === "Computer Science Handbook" && data.resource.status === "pending");
  }

  // ---- approved ----
  {
    const res = await patch(env, "/api/admin/resources/a1", { course: "CSC 201", pages: 30, description: "" }, admin);
    const data = await res.json();
    const after = row(DB, "a1");
    check("approved: edit incl. pages -> 200", res.status === 200 && data.success, JSON.stringify(data));
    check("approved: values saved, description can be cleared", after.course === "CSC 201" && after.pages === 30 && after.description === "");
    check("approved: status and reviewer untouched", after.status === "approved" && after.reviewed_by === "admin2" && after.reviewed_at === "2025-01-01T00:00:00.000Z");
    check("approved: response exposes pages", data.resource.pages === 30);
  }

  // ---- rejected ----
  {
    const res = await patch(env, "/api/admin/resources/r1", { department: "Mechanical Engineering" }, admin);
    const after = row(DB, "r1");
    check("rejected: edit -> 200", res.status === 200);
    check("rejected: saved; status, reason, reviewer untouched",
      after.department === "Mechanical Engineering" && after.status === "rejected" && after.rejection_reason === "wrong_course" && after.reviewed_by === "admin2");
  }

  // ---- pages rule ----
  {
    const res = await patch(env, "/api/admin/resources/p1", { pages: 10, title: "Should Not Save" }, admin);
    const data = await res.json();
    check("pages on pending -> 400 with field error", res.status === 400 && data.errors?.[0]?.field === "pages", JSON.stringify(data));
    check("pages rejection saves nothing else either (all-or-nothing)", row(DB, "p1").title === "Computer Science Handbook");
    const res2 = await patch(env, "/api/admin/resources/r1", { pages: 10 }, admin);
    check("pages on rejected -> 400", res2.status === 400);
    for (const bad of [0, -3, 1001, 2.5, "12"]) {
      const r = await patch(env, "/api/admin/resources/a1", { pages: bad }, admin);
      check(`approved: invalid pages ${JSON.stringify(bad)} -> 400`, r.status === 400);
    }
    check("approved pages unchanged after bad attempts", row(DB, "a1").pages === 30);
  }

  // ---- validation ----
  {
    const cases = [
      ["bad type", { type: "Magazine" }, "type"],
      ["bad level", { level: "700" }, "level"],
      ["numeric level (must be string)", { level: 300 }, "level"],
      ["bad semester", { semester: "Third" }, "semester"],
      ["blank title", { title: "   " }, "title"],
      ["blank course", { course: "" }, "course"],
      ["blank department", { department: "" }, "department"],
      ["blank session", { session: " " }, "session"],
      ["huge title", { title: "x".repeat(301) }, "title"],
    ];
    for (const [label, body, field] of cases) {
      const res = await patch(env, "/api/admin/resources/p1", body, admin);
      const data = await res.json();
      check(`validation: ${label} -> 400 on "${field}"`, res.status === 400 && data.errors?.some((e) => e.field === field), JSON.stringify(data));
    }
    const after = row(DB, "p1");
    check("validation failures changed nothing", after.type === "Lecture Note" && after.level === "400" && after.title === "Computer Science Handbook");
    const bad = await patch(env, "/api/admin/resources/p1", "not json{", admin, true);
    check("malformed JSON -> 400", bad.status === 400);
    const arr = await patch(env, "/api/admin/resources/p1", ["title"], admin);
    check("array body -> 400", arr.status === 400);
  }

  // ---- the whitelist: nothing but metadata can change ----
  {
    const before = row(DB, "p1");
    const res = await patch(env, "/api/admin/resources/p1", {
      title: "Whitelist Check", status: "approved", uploader_id: "admin1", downloads: 9999, file_url: "https://evil.example/x",
      reviewed_by: "admin1", rejection_reason: "hacked", file_hash: "abc", bounty_id: "b1", id: "other",
    }, admin);
    const after = row(DB, "p1");
    check("whitelist: request OK, title changed", res.status === 200 && after.title === "Whitelist Check");
    check("whitelist: status/uploader/downloads/file/review/hash/bounty/id all untouched",
      after.status === "pending" && after.uploader_id === before.uploader_id && after.downloads === 0 &&
      after.file_url === before.file_url && after.reviewed_by === null && after.rejection_reason === "" &&
      after.file_hash === null && after.bounty_id === null && after.id === "p1");
  }

  // ---- no-ops and missing ----
  {
    const same = await patch(env, "/api/admin/resources/p1", { title: "Whitelist Check" }, admin);
    const d1 = await same.json();
    check("same value -> 200, changed:false", same.status === 200 && d1.changed === false && d1.changedFields.length === 0);
    const empty = await patch(env, "/api/admin/resources/p1", {}, admin);
    const d2 = await empty.json();
    check("empty object -> 200, changed:false", empty.status === 200 && d2.changed === false);
    const missing = await patch(env, "/api/admin/resources/does-not-exist", { title: "X" }, admin);
    check("unknown id -> 404", missing.status === 404);
  }

  // ---- the details endpoint feeds the editor ----
  {
    const res = await app.fetch(new Request("http://localhost/api/admin/resources/a1", { headers: { Authorization: `Bearer ${admin}` } }), env, ctx);
    const data = await res.json();
    check("GET details exposes status + pages for the editor", data.resource.status === "approved" && data.resource.pages === 30);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error("TEST RUNNER CRASHED:", e); process.exit(1); });
