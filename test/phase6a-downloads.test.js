// Phase 6a (update package, Phase 1): /downloads, /downloads/:id/file,
// /bookmarks extras, /resources/recommended.
// Run: node --experimental-sqlite test/phase6a-downloads.test.js
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
const isoDaysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();

function seedUser(DB, id, { department = null, level = null, balance = 0 } = {}) {
  DB._raw
    .prepare(
      `INSERT INTO users (id, full_name, email, password, role, department, level, wallet_balance, is_verified, preferences)
       VALUES (?, ?, ?, 'hash', 'student', ?, ?, ?, 1, '{}')`
    )
    .run(id, `User ${id}`, `${id}@example.com`, department, level, balance);
}
function seedResource(DB, o) {
  const { id, status = "approved", department = "Computer Science", level = "300", downloads = 0, createdAt = isoDaysAgo(1) } = o;
  DB._raw
    .prepare(
      `INSERT INTO resources (id, title, type, department, course, level, semester, session, uploader_id,
         file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, pages, status, downloads, created_at)
       VALUES (?, ?, 'Past Question', ?, 'CSC 301', ?, 'First', '2024/2025', 'uploader',
         'f.pdf', 'https://x/f.pdf', 'pub', 2516582, 'pdf', 10, ?, ?, ?)`
    )
    .run(id, "Title " + id, department, level, status, downloads, createdAt);
}
function seedPurchase(DB, { id, user, resource, amount = 380, status = "successful" }) {
  const at = isoDaysAgo(5);
  DB._raw
    .prepare(
      `INSERT INTO transactions (id, user_id, type, amount, status, resource_id, description, created_at, updated_at)
       VALUES (?, ?, 'purchase', ?, ?, ?, 'CSC 301 — Past Questions', ?, ?)`
    )
    .run(id, user, amount, status, resource, at, at);
}
const balanceOf = (DB, id) => DB._raw.prepare("SELECT wallet_balance AS n FROM users WHERE id = ?").get(id).n;
const countOf = (DB, sql) => DB._raw.prepare(sql).get().n;

async function run() {
  // ---- GET /api/downloads ------------------------------------------------
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "uploader");
    seedUser(DB, "me");
    seedUser(DB, "other");
    seedResource(DB, { id: "r1" });
    seedResource(DB, { id: "r2", status: "rejected" });
    seedResource(DB, { id: "r3" });
    seedPurchase(DB, { id: "t1", user: "me", resource: "r1" });
    seedPurchase(DB, { id: "t2", user: "me", resource: "r2" });
    seedPurchase(DB, { id: "t3", user: "me", resource: "r3", status: "pending" });
    seedPurchase(DB, { id: "t4", user: "other", resource: "r3" });

    const token = await tokenFor(env, "me");
    const res = await getAuthed("/api/downloads", token, env);
    const body = await res.json();
    check("downloads: 200", res.status === 200 && body.success === true);
    check("downloads: only my successful purchases", body.downloads.length === 2, JSON.stringify(body.downloads.map((d) => d.id)));
    const r1 = body.downloads.find((d) => d.id === "r1");
    check(
      "downloads: contract fields",
      r1 && r1.level === "300 Level" && r1.size === "2.4 MB" && r1.pricePaid === 380 && r1.fileExtension === "pdf" && r1.available === true && !!r1.downloadedAt,
      JSON.stringify(r1)
    );
    check("downloads: removed resource -> available:false", body.downloads.find((d) => d.id === "r2")?.available === false);

    const noAuth = await app.fetch(new Request("http://localhost/api/downloads"), env);
    check("downloads: requires auth", noAuth.status === 401);
  }

  // ---- GET /api/downloads/:id/file ---------------------------------------
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "uploader");
    seedUser(DB, "me", { balance: 1000 });
    seedUser(DB, "stranger", { balance: 1000 });
    seedResource(DB, { id: "r1" });
    seedPurchase(DB, { id: "t1", user: "me", resource: "r1" });
    const txBefore = countOf(DB, "SELECT COUNT(*) AS n FROM transactions");

    const strangerToken = await tokenFor(env, "stranger");
    let res = await getAuthed("/api/downloads/r1/file", strangerToken, env);
    check("file: another user's resource -> 403", res.status === 403);
    res = await getAuthed("/api/downloads/nope/file", strangerToken, env);
    check("file: unknown id -> 403 (no probing)", res.status === 403);

    const token = await tokenFor(env, "me");
    res = await getAuthed("/api/downloads/r1/file", token, env);
    const body = await res.json();
    check("file: owner -> 200 + stream url", res.status === 200 && body.success && body.fileUrl.includes("/api/resources/r1/stream?token="), JSON.stringify(body));
    check("file: NEVER charges (balance + transactions unchanged)", balanceOf(DB, "me") === 1000 && countOf(DB, "SELECT COUNT(*) AS n FROM transactions") === txBefore);
    check("file: records the download", countOf(DB, "SELECT COUNT(*) AS n FROM download_logs WHERE resource_id = 'r1'") === 1);
  }

  // ---- GET /api/bookmarks extras -----------------------------------------
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "uploader");
    seedUser(DB, "me");
    seedResource(DB, { id: "r1" });
    seedResource(DB, { id: "r2" });
    const at = isoDaysAgo(2);
    for (const rid of ["r1", "r2"]) {
      DB._raw.prepare("INSERT INTO bookmarks (id, user_id, resource_id, created_at, updated_at) VALUES (?, 'me', ?, ?, ?)").run("b" + rid, rid, at, at);
    }
    seedPurchase(DB, { id: "t1", user: "me", resource: "r2" });

    const res = await getAuthed("/api/bookmarks", await tokenFor(env, "me"), env);
    const body = await res.json();
    const byId = Object.fromEntries(body.resources.map((r) => [r.id, r]));
    check("bookmarks: owned flag", byId.r2.owned === true && byId.r1.owned === false);
    check("bookmarks: savedAt / fileExtension / level label", !!byId.r1.savedAt && byId.r1.fileExtension === "pdf" && byId.r1.level === "300 Level");
    check("bookmarks: required fields intact", byId.r1.id && byId.r1.title && byId.r1.course && byId.r1.type && byId.r1.pages === 10);
  }

  // ---- GET /api/resources/recommended ------------------------------------
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "uploader");
    seedUser(DB, "me", { department: "Computer Science", level: "300" });
    seedUser(DB, "blank");
    seedResource(DB, { id: "match" });
    seedResource(DB, { id: "owned" });
    seedResource(DB, { id: "wrong-level", level: "200" });
    seedResource(DB, { id: "wrong-dept", department: "Law" });
    seedResource(DB, { id: "pending", status: "pending" });
    seedPurchase(DB, { id: "t1", user: "me", resource: "owned" });

    const res = await getAuthed("/api/resources/recommended?limit=4", await tokenFor(env, "me"), env);
    const body = await res.json();
    check("recommended: 200, matches department+level, excludes owned/pending/other", res.status === 200 && body.resources.map((r) => r.id).join() === "match", JSON.stringify(body.resources?.map((r) => r.id)));
    check("recommended: item has recentDownloads", body.resources[0]?.recentDownloads === 0);

    const blank = await getAuthed("/api/resources/recommended", await tokenFor(env, "blank"), env);
    check("recommended: profile incomplete -> empty list", (await blank.json()).resources.length === 0);

    // must not be swallowed by the /:id catch-all route
    check("recommended: route precedes /:id", res.status === 200 && Array.isArray(body.resources));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("TEST RUNNER CRASHED:", e);
  process.exit(1);
});
