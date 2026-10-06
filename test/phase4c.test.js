// Direct-to-Cloudinary uploads: permit -> (browser uploads) -> complete.
import fs from "node:fs";
import crypto from "node:crypto";
import { sign } from "hono/jwt";
import app from "../src/index.js";
import { createMockD1 } from "./mockD1.js";
import { purgeStaleUploads } from "../src/jobs/purgeStaleUploads.js";
import { _resetRateLimiters } from "../src/middleware/rateLimiter.js";

const schemaSql = fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) { console.log("OK  -", label); passed++; } else { console.log("FAIL-", label, extra); failed++; }
}

const SECRET = "fake-secret";
function freshEnv() {
  _resetRateLimiters();
  const DB = createMockD1(schemaSql);
  return { DB, env: { DB, JWT_SECRET: "test-secret", CLOUDINARY_CLOUD_NAME: "sharef-cloud", CLOUDINARY_API_KEY: "fake-key", CLOUDINARY_API_SECRET: SECRET } };
}
const tokenFor = (env, id) => { const now = Math.floor(Date.now() / 1000); return sign({ id, role: "student", iat: now, exp: now + 3600 }, env.JWT_SECRET); };
function seedUser(DB, id) {
  DB._raw.prepare(`INSERT INTO users (id, full_name, email, password, is_verified, preferences) VALUES (?, ?, ?, 'h', 1, '{}')`).run(id, `User ${id}`, `${id}@example.com`);
}

// ---- fake Cloudinary: serves "uploaded" files, honours Range, records destroys ----
const realFetch = globalThis.fetch;
let stored = new Map(); // public_id -> { bytes: Uint8Array, reportedSize? }
let calls = [];
let destroyFails = false;
function installCloudinary({ ignoreRange = false } = {}) {
  stored = new Map(); calls = []; destroyFails = false;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith("https://res.cloudinary.com/sharef-cloud/raw/upload/")) {
      const publicId = u.replace("https://res.cloudinary.com/sharef-cloud/raw/upload/", "");
      calls.push({ type: "head", publicId, range: opts.headers?.Range });
      const f = stored.get(publicId);
      if (!f) return new Response("not found", { status: 404 });
      const total = f.reportedSize ?? f.bytes.length;
      if (opts.headers?.Range && !ignoreRange) {
        return new Response(f.bytes.slice(0, 8), { status: 206, headers: { "Content-Range": `bytes 0-7/${total}` } });
      }
      return new Response(f.bytes, { status: 200, headers: { "Content-Length": String(total) } });
    }
    if (u.includes("api.cloudinary.com") && u.endsWith("/destroy")) {
      const pid = opts.body.get("public_id");
      calls.push({ type: "destroy", publicId: pid });
      if (destroyFails) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
      stored.delete(pid);
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    }
    return realFetch(url, opts);
  };
}
const restore = () => { globalThis.fetch = realFetch; };

const PDF = (n = 4000) => { const b = new Uint8Array(n); b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); return b; };
const ZIPISH = (n = 4000) => { const b = new Uint8Array(n); b.set([0x50, 0x4b, 0x03, 0x04]); return b; };
const PNG = (n = 100) => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47]); return b; };

const meta = { title: "CSC301 Notes", type: "Lecture Note", department: "Computer Science", course: "CSC301", level: "300", semester: "First", session: "2024/2025", description: "Week 3 notes" };
let ipN = 0;
async function post(path, body, token, env) {
  const tasks = [];
  const res = await app.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `7.7.7.${++ipN % 250}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }), env, { waitUntil: (p) => tasks.push(p), passThroughOnException() {} });
  await Promise.all(tasks);
  return res;
}
const permit = (env, token, over = {}) => post("/api/resources/upload/permit", { ...meta, fileName: "notes.pdf", fileSize: 4000, ...over }, token, env);
const complete = (env, token, intentId) => post("/api/resources/upload/complete", { intentId }, token, env);
const count = (DB, sql, ...a) => DB._raw.prepare(sql).get(...a).c;

async function run() {
  // ===================== PERMIT =====================
  {
    const { env, DB } = freshEnv(); seedUser(DB, "u1");
    const token = await tokenFor(env, "u1");
    installCloudinary();
    const res = await permit(env, token, { public_id: "evil/../../choose-my-own", folder: "x" });
    const b = await res.json();
    check("permit: 200 with intentId + upload instructions", res.status === 200 && b.success && b.intentId && b.upload?.url, JSON.stringify(b));
    check("permit: uploads to the raw endpoint of OUR cloud", b.upload.url === "https://api.cloudinary.com/v1_1/sharef-cloud/raw/upload");
    check("permit: public_id is server-chosen (client value ignored)", b.upload.fields.public_id === `sharef_resources/${b.intentId}.pdf`, b.upload.fields.public_id);
    const f = b.upload.fields;
    const expected = crypto.createHash("sha1").update(`access_mode=public&public_id=${f.public_id}&timestamp=${f.timestamp}${SECRET}`).digest("hex");
    check("permit: signature matches Cloudinary's algorithm", f.signature === expected);
    check("permit: api_key present, api_secret NEVER sent to the browser", f.api_key === "fake-key" && !JSON.stringify(b).includes(SECRET));
    const row = DB._raw.prepare("SELECT * FROM upload_intents WHERE id = ?").get(b.intentId);
    check("permit: intent stored for this user with validated metadata", row.user_id === "u1" && JSON.parse(row.metadata).title === "CSC301 Notes" && row.file_extension === "pdf");
    const ttlMin = (Date.parse(row.expires_at) - Date.now()) / 60000;
    check("permit: expires in ~30 minutes", ttlMin > 28 && ttlMin <= 30.1, String(ttlMin));
    check("permit: no file bytes / no Cloudinary traffic from the Worker", calls.length === 0);
    const traversal = await permit(env, token, { fileName: "../../etc/passwd.pdf" });
    const tb = await traversal.json();
    check("permit: path separators stripped from stored display name", !DB._raw.prepare("SELECT file_name FROM upload_intents WHERE id=?").get(tb.intentId).file_name.includes("/"));
    restore();
  }
  {
    const { env, DB } = freshEnv(); seedUser(DB, "u1");
    const token = await tokenFor(env, "u1");
    const r = async (over) => (await permit(env, token, over)).status;
    check("permit: unauthenticated -> 401", (await post("/api/resources/upload/permit", { ...meta, fileName: "a.pdf", fileSize: 10 }, null, env)).status === 401);
    check("permit: missing file name -> 400", (await r({ fileName: undefined })) === 400);
    check("permit: disallowed extension -> 400", (await r({ fileName: "virus.exe" })) === 400);
    check("permit: no extension -> 400", (await r({ fileName: "README" })) === 400);
    check("permit: over 8MB -> 400", (await r({ fileSize: 8 * 1024 * 1024 + 1 })) === 400);
    check("permit: exactly 8MB is allowed", (await r({ fileSize: 8 * 1024 * 1024 })) === 200);
    check("permit: size 0 / string / fraction -> 400", (await r({ fileSize: 0 })) === 400 && (await r({ fileSize: "100" })) === 400 && (await r({ fileSize: 1.5 })) === 400);
    const v = await permit(env, token, { title: "", type: "Nonsense" });
    const vb = await v.json();
    check("permit: field validation -> 400 with errors array", v.status === 400 && vb.errors.some((e) => e.field === "title") && vb.errors.some((e) => e.field === "type"));
    check("permit: invalid requests created no intents", count(DB, "SELECT COUNT(*) c FROM upload_intents") === 1); // only the 8MB one
  }
  {
    // live-permit cap + lazy purge of expired ones
    const { env, DB } = freshEnv(); seedUser(DB, "u1"); seedUser(DB, "u2");
    const token = await tokenFor(env, "u1");
    installCloudinary();
    for (let i = 0; i < 3; i++) await permit(env, token);
    const fourth = await permit(env, token);
    check("cap: 4th concurrent permit -> 429", fourth.status === 429);
    check("cap: other users unaffected", (await permit(env, await tokenFor(env, "u2"))).status === 200);
    DB._raw.prepare("UPDATE upload_intents SET expires_at = ? WHERE user_id = 'u1'").run(new Date(Date.now() - 1000).toISOString());
    stored.set(DB._raw.prepare("SELECT public_id p FROM upload_intents WHERE user_id='u1' LIMIT 1").get().p, { bytes: PDF() });
    const again = await permit(env, token);
    check("cap: expired permits stop counting against the cap", again.status === 200);
    check("cap: expired permits were purged lazily (rows + Cloudinary files)", count(DB, "SELECT COUNT(*) c FROM upload_intents WHERE user_id='u1' AND expires_at < ?", new Date().toISOString()) === 0 && calls.some((c) => c.type === "destroy"));
    restore();
  }

  // ===================== COMPLETE =====================
  {
    const { env, DB } = freshEnv(); seedUser(DB, "u1");
    const token = await tokenFor(env, "u1");
    installCloudinary();
    const p = await (await permit(env, token)).json();
    stored.set(p.upload.fields.public_id, { bytes: PDF(5000) });
    calls.length = 0;
    const res = await complete(env, token, p.intentId);
    const b = await res.json();
    check("complete: 201 and pending resource returned", res.status === 201 && b.success && b.resource.id === p.intentId && b.resource.status === "pending", JSON.stringify(b));
    check("complete: exactly ONE ranged request, no download", calls.length === 1 && calls[0].type === "head" && calls[0].range === "bytes=0-7");
    const row = DB._raw.prepare("SELECT * FROM resources WHERE id = ?").get(p.intentId);
    check("complete: resource id == intent id", !!row);
    check("complete: file_url is the server-built Cloudinary URL", row.file_url === `https://res.cloudinary.com/sharef-cloud/raw/upload/${p.upload.fields.public_id}`);
    check("complete: size recorded from Cloudinary, not trusted from the client", row.file_size_bytes === 5000);
    check("complete: pages is the placeholder 1 until review", row.pages === 1);
    check("complete: preview_type pending, no snippet", row.preview_type === "pending" && row.preview_snippet === "");
    check("complete: metadata + uploader copied from the permit", row.title === "CSC301 Notes" && row.course === "CSC301" && row.uploader_id === "u1" && row.status === "pending");
    check("complete: cloudinary_public_id stored (used for later deletion)", row.cloudinary_public_id === p.upload.fields.public_id && row.cloudinary_resource_type === "raw");
    const n = DB._raw.prepare("SELECT * FROM notifications WHERE resource_id = ?").get(p.intentId);
    check("complete: admin notification created", n && n.recipient_id === null && n.type === "new_upload");
    check("complete: intent consumed", count(DB, "SELECT COUNT(*) c FROM upload_intents") === 0);
    // idempotent
    const again = await complete(env, token, p.intentId);
    const ab = await again.json();
    check("complete: calling it again is a harmless 200 (double-click safe)", again.status === 200 && ab.success && ab.resource.id === p.intentId);
    check("complete: still exactly one resource and one notification", count(DB, "SELECT COUNT(*) c FROM resources") === 1 && count(DB, "SELECT COUNT(*) c FROM notifications") === 1);
    restore();
  }
  {
    // truly simultaneous double submit
    const { env, DB } = freshEnv(); seedUser(DB, "u1");
    const token = await tokenFor(env, "u1");
    installCloudinary();
    const p = await (await permit(env, token)).json();
    stored.set(p.upload.fields.public_id, { bytes: PDF() });
    const rs = await Promise.all([complete(env, token, p.intentId), complete(env, token, p.intentId), complete(env, token, p.intentId)]);
    check("complete: 3 simultaneous submits all succeed", rs.every((r) => r.status === 200 || r.status === 201));
    check("complete: ...but only ONE resource + ONE notification exist", count(DB, "SELECT COUNT(*) c FROM resources") === 1 && count(DB, "SELECT COUNT(*) c FROM notifications") === 1);
    restore();
  }
  {
    // CDN that ignores Range: we must still not need the whole body
    const { env, DB } = freshEnv(); seedUser(DB, "u1");
    const token = await tokenFor(env, "u1");
    installCloudinary({ ignoreRange: true });
    const p = await (await permit(env, token)).json();
    stored.set(p.upload.fields.public_id, { bytes: PDF(6000) });
    const res = await complete(env, token, p.intentId);
    check("complete: works when the CDN answers 200 instead of 206", res.status === 201 && DB._raw.prepare("SELECT file_size_bytes s FROM resources").get().s === 6000);
    restore();
  }
  {
    // ownership / unknown / bad input
    const { env, DB } = freshEnv(); seedUser(DB, "u1"); seedUser(DB, "u2");
    installCloudinary();
    const t1 = await tokenFor(env, "u1"), t2 = await tokenFor(env, "u2");
    const p = await (await permit(env, t1)).json();
    stored.set(p.upload.fields.public_id, { bytes: PDF() });
    check("complete: someone else's intent -> 410, nothing created", (await complete(env, t2, p.intentId)).status === 410 && count(DB, "SELECT COUNT(*) c FROM resources") === 0);
    check("complete: unknown intent -> 410", (await complete(env, t1, "nope")).status === 410);
    check("complete: missing / non-string intentId -> 400", (await complete(env, t1, undefined)).status === 400 && (await complete(env, t1, { $ne: 1 })).status === 400);
    check("complete: unauthenticated -> 401", (await post("/api/resources/upload/complete", { intentId: p.intentId }, null, env)).status === 401);
    restore();
  }
  {
    // file hasn't landed yet -> 409, intent kept, retry works once it does
    const { env, DB } = freshEnv(); seedUser(DB, "u1");
    const token = await tokenFor(env, "u1");
    installCloudinary();
    const p = await (await permit(env, token)).json();
    const early = await complete(env, token, p.intentId);
    check("complete: file not on Cloudinary yet -> 409 and intent kept", early.status === 409 && count(DB, "SELECT COUNT(*) c FROM upload_intents") === 1);
    stored.set(p.upload.fields.public_id, { bytes: PDF() });
    check("complete: retry after the upload lands -> 201", (await complete(env, token, p.intentId)).status === 201);
    restore();
  }
  {
    // expired
    const { env, DB } = freshEnv(); seedUser(DB, "u1");
    const token = await tokenFor(env, "u1");
    installCloudinary();
    const p = await (await permit(env, token)).json();
    stored.set(p.upload.fields.public_id, { bytes: PDF() });
    DB._raw.prepare("UPDATE upload_intents SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
    const res = await complete(env, token, p.intentId);
    check("complete: expired permit -> 410, no resource, file removed", res.status === 410 && count(DB, "SELECT COUNT(*) c FROM resources") === 0 && !stored.has(p.upload.fields.public_id));
    restore();
  }

  // ===================== CONTENT CHECKS =====================
  {
    const { env, DB } = freshEnv(); seedUser(DB, "u1");
    const token = await tokenFor(env, "u1");
    installCloudinary();
    let p = await (await permit(env, token, { fileName: "fake.pdf" })).json();
    stored.set(p.upload.fields.public_id, { bytes: ZIPISH() }); // a zip pretending to be a PDF
    let res = await complete(env, token, p.intentId);
    check("content: a ZIP renamed .pdf is rejected (400)", res.status === 400);
    check("content: ...file deleted from Cloudinary, intent gone, no resource", !stored.has(p.upload.fields.public_id) && count(DB, "SELECT COUNT(*) c FROM upload_intents") === 0 && count(DB, "SELECT COUNT(*) c FROM resources") === 0);

    p = await (await permit(env, token, { fileName: "big.pdf" })).json();
    stored.set(p.upload.fields.public_id, { bytes: PDF(), reportedSize: 9 * 1024 * 1024 });
    res = await complete(env, token, p.intentId);
    check("content: file bigger than 8MB on Cloudinary -> 400 and removed", res.status === 400 && !stored.has(p.upload.fields.public_id));

    for (const [name, bytes] of [["a.docx", ZIPISH()], ["a.pptx", ZIPISH()], ["a.zip", ZIPISH()], ["a.png", PNG()]]) {
      const pp = await (await permit(env, token, { fileName: name })).json();
      stored.set(pp.upload.fields.public_id, { bytes });
      const r = await complete(env, token, pp.intentId);
      check(`content: genuine ${name} accepted`, r.status === 201);
    }
    const jp = await (await permit(env, token, { fileName: "a.jpg" })).json();
    stored.set(jp.upload.fields.public_id, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]) });
    check("content: genuine .jpg accepted", (await complete(env, token, jp.intentId)).status === 201);
    restore();
  }

  // ===================== OLD ENDPOINT + PURGE JOB =====================
  {
    const { env, DB } = freshEnv(); seedUser(DB, "u1");
    const token = await tokenFor(env, "u1");
    const res = await app.fetch(new Request("http://localhost/api/resources/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: new FormData() }), env);
    check("old multipart POST /api/resources/upload no longer exists", res.status === 404);
  }
  {
    const { env, DB } = freshEnv(); seedUser(DB, "u1");
    installCloudinary();
    const past = new Date(Date.now() - 60000).toISOString(), later = new Date(Date.now() + 600000).toISOString();
    const ins = DB._raw.prepare("INSERT INTO upload_intents (id,user_id,public_id,file_name,file_extension,declared_size,metadata,created_at,expires_at) VALUES (?,?,?,?, 'pdf',10,'{}',?,?)");
    ins.run("old1", "u1", "sharef_resources/old1.pdf", "a.pdf", past, past);
    ins.run("old2", "u1", "sharef_resources/old2.pdf", "b.pdf", past, past);
    ins.run("live", "u1", "sharef_resources/live.pdf", "c.pdf", past, later);
    stored.set("sharef_resources/old1.pdf", { bytes: PDF() }); stored.set("sharef_resources/live.pdf", { bytes: PDF() });
    const n = await purgeStaleUploads(env, { limit: 20 });
    check("purge: removes only expired intents, and their Cloudinary files", n === 2 && count(DB, "SELECT COUNT(*) c FROM upload_intents") === 1 && !stored.has("sharef_resources/old1.pdf") && stored.has("sharef_resources/live.pdf"));
    ins.run("old3", "u1", "sharef_resources/old3.pdf", "d.pdf", past, past);
    destroyFails = true;
    const n2 = await purgeStaleUploads(env, { limit: 20 });
    check("purge: if Cloudinary fails the row is kept for the next run", n2 === 0 && count(DB, "SELECT COUNT(*) c FROM upload_intents WHERE id='old3'") === 1);
    destroyFails = false;
    ins.run("old4", "u1", "sharef_resources/old4.pdf", "e.pdf", past, past);
    const n3 = await purgeStaleUploads(env, { limit: 1 });
    check("purge: respects the batch limit", n3 === 1);
    // cron entry point
    const tasks = [];
    await app.scheduled({}, env, { waitUntil: (p) => tasks.push(p) });
    await Promise.all(tasks);
    check("purge: scheduled() handler is exported and drains the rest", count(DB, "SELECT COUNT(*) c FROM upload_intents WHERE expires_at < ?", new Date().toISOString()) === 0);
    restore();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run().catch((e) => { console.error("TEST RUNNER CRASHED:", e); process.exit(1); });
