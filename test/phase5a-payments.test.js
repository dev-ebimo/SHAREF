// Save point 1 — payment hardening. Focus: atomicity, races, tampering.
import fs from "node:fs";
import crypto from "node:crypto";
import { sign } from "hono/jwt";
import app from "../src/index.js";
import { createMockD1 } from "./mockD1.js";

const schemaSql = fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
let passed = 0, failed = 0;
function check(label, cond, extra = "") {
  if (cond) { console.log("OK  -", label); passed++; } else { console.log("FAIL-", label, extra); failed++; }
}
function freshEnv() {
  const DB = createMockD1(schemaSql);
  return { env: { DB, JWT_SECRET: "test-secret", FRONTEND_URL: "https://x.test", PAYSTACK_SECRET_KEY: "sk_test_fake" }, DB };
}
async function tokenFor(env, id) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ id, role: "student", iat: now, exp: now + 3600 }, env.JWT_SECRET);
}
function seedUser(DB, id, bal = 0) {
  DB._raw.prepare(`INSERT INTO users (id, full_name, email, password, is_verified, wallet_balance, preferences) VALUES (?, ?, ?, 'h', 1, ?, '{}')`).run(id, id, `${id}@e.com`, bal);
}
function seedResource(DB, id, pages = 10) {
  DB._raw.prepare(`INSERT OR IGNORE INTO users (id, full_name, email, password, is_verified, preferences) VALUES ('up','Up','up@e.com','h',1,'{}')`).run();
  DB._raw.prepare(`INSERT INTO resources (id,title,type,department,course,level,semester,session,uploader_id,file_name,file_url,cloudinary_public_id,file_size_bytes,file_extension,pages,status)
    VALUES (?, 'T', 'Textbook','CS','C1','300','First','2024/2025','up','f.pdf','https://x/f.pdf','p',1000,'pdf',?, 'approved')`).run(id, pages);
}
function seedDeposit(DB, id, userId, ref, amount = 500, status = "pending") {
  const t = new Date().toISOString();
  DB._raw.prepare(`INSERT INTO transactions (id,user_id,type,amount,status,reference,created_at,updated_at) VALUES (?,?, 'deposit',?,?,?,?,?)`).run(id, userId, amount, status, ref, t, t);
}
const post = (path, body, env, token) => app.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }), env);
const get = (path, token, env) => app.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }), env);
function webhook(env, payloadObj, { sign: doSign = true, sig } = {}) {
  const payload = JSON.stringify(payloadObj);
  const signature = sig ?? crypto.createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(payload).digest("hex");
  return app.fetch(new Request("http://localhost/api/wallet/webhook", { method: "POST", headers: doSign ? { "x-paystack-signature": signature } : {}, body: payload }), env);
}
const ev = (ref, over = {}) => ({ event: "charge.success", data: { status: "success", currency: "NGN", reference: ref, amount: 50000, ...over } });
const bal = (DB, id) => DB._raw.prepare("SELECT wallet_balance b FROM users WHERE id=?").get(id).b;

const realFetch = globalThis.fetch;
function mockPaystack({ status = "success", amount = 50000, currency = "NGN", initFails = false } = {}) {
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("transaction/initialize")) {
      if (initFails) return new Response(JSON.stringify({ status: false, message: "nope" }), { status: 400 });
      return new Response(JSON.stringify({ status: true, data: { authorization_url: "https://p.test/c", reference: JSON.parse(opts.body).reference } }), { status: 200 });
    }
    if (String(url).includes("transaction/verify/")) {
      const reference = decodeURIComponent(String(url).split("/").pop());
      return new Response(JSON.stringify({ status: true, data: { status, reference, amount, currency } }), { status: 200 });
    }
    return realFetch(url, opts);
  };
}
const restore = () => { globalThis.fetch = realFetch; };

async function run() {
  // ---------------- schema guarantees ----------------
  {
    const { DB } = freshEnv();
    seedUser(DB, "u1", 100);
    let threw = false;
    try { DB._raw.prepare("UPDATE users SET wallet_balance = -1 WHERE id='u1'").run(); } catch { threw = true; }
    check("schema: negative wallet balance is impossible (CHECK present)", threw);
  }

  // ---------------- CHARGE: atomicity ----------------
  {
    // A failure in the LAST write (download log) must roll back the deduction,
    // the purchase row and the download counter.
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 1000); seedResource(DB, "r1", 10);
    DB._raw.exec("CREATE TRIGGER boom BEFORE INSERT ON download_logs BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;");
    const res = await post("/api/wallet/charge", { resourceId: "r1" }, env, await tokenFor(env, "u1"));
    check("charge atomic: partial failure -> 500", res.status === 500);
    check("charge atomic: balance fully restored", bal(DB, "u1") === 1000, bal(DB, "u1"));
    check("charge atomic: no purchase row left behind", DB._raw.prepare("SELECT COUNT(*) c FROM transactions").get().c === 0);
    check("charge atomic: download counter untouched", DB._raw.prepare("SELECT downloads d FROM resources WHERE id='r1'").get().d === 0);
    const body = await res.json();
    check("charge atomic: no internal error text leaked", body.error === undefined);
  }
  {
    // Insufficient funds: whole batch aborts, nothing recorded, 402 shape intact.
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 299); seedResource(DB, "r1", 10); // cost 300
    const res = await post("/api/wallet/charge", { resourceId: "r1" }, env, await tokenFor(env, "u1"));
    const b = await res.json();
    check("charge: 299 vs cost 300 -> 402", res.status === 402 && b.insufficientBalance === true && b.required === 300 && b.currentBalance === 299, JSON.stringify(b));
    check("charge: nothing recorded on insufficient", DB._raw.prepare("SELECT COUNT(*) c FROM transactions").get().c === 0 && DB._raw.prepare("SELECT COUNT(*) c FROM download_logs").get().c === 0);
  }
  {
    // Exact balance works and leaves zero.
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 300); seedResource(DB, "r1", 10);
    const res = await post("/api/wallet/charge", { resourceId: "r1" }, env, await tokenFor(env, "u1"));
    const b = await res.json();
    check("charge: exact balance succeeds, newBalance 0", res.status === 200 && b.newBalance === 0, JSON.stringify(b));
  }
  {
    // TRUE concurrency on the same resource: two simultaneous requests, balance covers both.
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 1000); seedResource(DB, "r1", 10);
    const t = await tokenFor(env, "u1");
    const [a, b] = await Promise.all([post("/api/wallet/charge", { resourceId: "r1" }, env, t), post("/api/wallet/charge", { resourceId: "r1" }, env, t)]);
    check("double-click: both requests succeed", a.status === 200 && b.status === 200);
    check("double-click: charged exactly ONCE (1000-300)", bal(DB, "u1") === 700, bal(DB, "u1"));
    check("double-click: exactly one purchase row", DB._raw.prepare("SELECT COUNT(*) c FROM transactions WHERE type='purchase'").get().c === 1);
    const owned = [(await a.clone().json()).alreadyOwned, (await b.clone().json()).alreadyOwned].sort();
    check("double-click: one paid, one alreadyOwned", owned[0] === false && owned[1] === true, JSON.stringify(owned));
  }
  {
    // Concurrent purchases of DIFFERENT resources with balance for only one.
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 300); seedResource(DB, "r1", 10); seedResource(DB, "r2", 10);
    const t = await tokenFor(env, "u1");
    const rs = await Promise.all([post("/api/wallet/charge", { resourceId: "r1" }, env, t), post("/api/wallet/charge", { resourceId: "r2" }, env, t)]);
    const codes = rs.map((r) => r.status).sort();
    check("concurrent different resources: one 200 one 402", codes[0] === 200 && codes[1] === 402, codes.join());
    check("concurrent different resources: balance 0, never negative", bal(DB, "u1") === 0);
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 1000);
    const t = await tokenFor(env, "u1");
    const r1 = await post("/api/wallet/charge", {}, env, t);
    const r2 = await post("/api/wallet/charge", { resourceId: { $ne: 1 } }, env, t);
    check("charge: missing/non-string resourceId -> 400", r1.status === 400 && r2.status === 400);
  }

  // ---------------- DEPOSIT settlement: atomicity ----------------
  {
    // If the status flip fails, the credit must roll back with it.
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0); seedDeposit(DB, "t1", "u1", "REF1");
    DB._raw.exec("CREATE TRIGGER boom2 BEFORE UPDATE OF status ON transactions BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;");
    const res = await webhook(env, ev("REF1"));
    check("claim+credit atomic: failure -> 500 (Paystack will retry)", res.status === 500);
    check("claim+credit atomic: wallet NOT credited", bal(DB, "u1") === 0);
    check("claim+credit atomic: transaction still pending", DB._raw.prepare("SELECT status s FROM transactions WHERE id='t1'").get().s === "pending");
    DB._raw.exec("DROP TRIGGER boom2");
    const retry = await webhook(env, ev("REF1"));
    check("claim+credit atomic: Paystack retry then succeeds", retry.status === 200 && bal(DB, "u1") === 500);
  }
  {
    // verify + webhook racing at the same instant -> credited once.
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0); seedDeposit(DB, "t1", "u1", "REF2");
    mockPaystack();
    const t = await tokenFor(env, "u1");
    await Promise.all([get("/api/wallet/fund/verify/REF2", t, env), webhook(env, ev("REF2")), webhook(env, ev("REF2")), get("/api/wallet/fund/verify/REF2", t, env)]);
    restore();
    check("race: verify x2 + webhook x2 simultaneously -> credited exactly once", bal(DB, "u1") === 500, bal(DB, "u1"));
  }

  // ---------------- amount / currency tampering ----------------
  {
    // Webhook claims a bigger amount than we recorded -> NOT credited, flagged.
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0); seedDeposit(DB, "t1", "u1", "REF3", 500);
    const res = await webhook(env, ev("REF3", { amount: 5000000 }));
    check("webhook mismatch: still 200 (no retry storm)", res.status === 200);
    check("webhook mismatch: wallet NOT credited", bal(DB, "u1") === 0);
    const row = DB._raw.prepare("SELECT status s, description d FROM transactions WHERE id='t1'").get();
    check("webhook mismatch: stays pending and is flagged for admin", row.s === "pending" && row.d.startsWith("Flagged"), JSON.stringify(row));
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0); seedDeposit(DB, "t1", "u1", "REF4", 500);
    const res = await webhook(env, ev("REF4", { currency: "USD" }));
    check("webhook wrong currency: not credited", res.status === 200 && bal(DB, "u1") === 0);
  }
  {
    // verify endpoint: Paystack reports a different amount than recorded.
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0); seedDeposit(DB, "t1", "u1", "REF5", 500);
    mockPaystack({ amount: 10000 }); // paid ₦100 for a ₦500 request
    const res = await get("/api/wallet/fund/verify/REF5", await tokenFor(env, "u1"), env);
    restore();
    check("verify mismatch: 400 and not credited", res.status === 400 && bal(DB, "u1") === 0);
  }
  {
    // credit uses the RECORDED amount, never a caller-supplied one
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0); seedDeposit(DB, "t1", "u1", "REF6", 500);
    await webhook(env, ev("REF6", { amount: 50000 }));
    check("credit equals recorded amount", bal(DB, "u1") === 500);
  }

  // ---------------- verify behaviour ----------------
  {
    // someone else's reference
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0); seedUser(DB, "u2", 0); seedDeposit(DB, "t1", "u1", "REF7");
    mockPaystack();
    const res = await get("/api/wallet/fund/verify/REF7", await tokenFor(env, "u2"), env);
    restore();
    check("verify: another user's reference -> 404, no credit to anyone", res.status === 404 && bal(DB, "u1") === 0 && bal(DB, "u2") === 0);
  }
  {
    // still-processing payment is NOT marked failed, and can still be credited later
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0); seedDeposit(DB, "t1", "u1", "REF8");
    mockPaystack({ status: "ongoing" });
    const res = await get("/api/wallet/fund/verify/REF8", await tokenFor(env, "u1"), env);
    const b = await res.json();
    restore();
    check("verify ongoing: 202 pending, success=false", res.status === 202 && b.success === false && b.pending === true);
    check("verify ongoing: transaction left pending", DB._raw.prepare("SELECT status s FROM transactions WHERE id='t1'").get().s === "pending");
    await webhook(env, ev("REF8"));
    check("verify ongoing: webhook later credits it", bal(DB, "u1") === 500);
  }
  {
    // failed first, then a late successful webhook still credits
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0); seedDeposit(DB, "t1", "u1", "REF9", 500, "failed");
    await webhook(env, ev("REF9"));
    check("late success after 'failed' still credits once", bal(DB, "u1") === 500);
    await webhook(env, ev("REF9"));
    check("…and replaying it does not credit again", bal(DB, "u1") === 500);
  }
  {
    // deposit row whose user was deleted must never credit anyone / crash
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0);
    const t = new Date().toISOString();
    DB._raw.prepare(`INSERT INTO transactions (id,user_id,type,amount,status,reference,created_at,updated_at) VALUES ('t1',NULL,'deposit',500,'pending','REF10',?,?)`).run(t, t);
    const res = await webhook(env, ev("REF10"));
    check("orphaned deposit (user deleted): 200, nobody credited", res.status === 200 && bal(DB, "u1") === 0);
  }

  // ---------------- webhook signature / payload hygiene ----------------
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0); seedDeposit(DB, "t1", "u1", "REF11");
    check("webhook: missing signature -> 401", (await webhook(env, ev("REF11"), { sign: false })).status === 401);
    check("webhook: wrong-length signature -> 401", (await webhook(env, ev("REF11"), { sig: "abcd" })).status === 401);
    check("webhook: right-length wrong signature -> 401", (await webhook(env, ev("REF11"), { sig: "0".repeat(128) })).status === 401);
    check("webhook: none of those credited", bal(DB, "u1") === 0);
    const unk = await webhook(env, ev("NOPE"));
    check("webhook: unknown reference -> 200 (ack, no retries)", unk.status === 200);
    const other = await webhook(env, { event: "transfer.success", data: {} });
    check("webhook: unrelated event type ignored with 200", other.status === 200);
  }

  // ---------------- initialize funding ----------------
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0);
    const t = await tokenFor(env, "u1");
    mockPaystack();
    const bad = [["100.5", "string"], [100.5, "fraction"], [99, "below min"], [500001, "above max"], [null, "null"], [{ a: 1 }, "object"], [1e21, "huge"], [NaN, "NaN"]];
    for (const [v, name] of bad) {
      const res = await post("/api/wallet/fund/initialize", { amount: v }, env, t);
      check(`initialize: rejects ${name}`, res.status === 400, res.status);
    }
    check("initialize: no rows created for rejected amounts", DB._raw.prepare("SELECT COUNT(*) c FROM transactions").get().c === 0);
    const ok = await post("/api/wallet/fund/initialize", { amount: 100 }, env, t);
    const b = await ok.json();
    check("initialize: min amount accepted; reference is random UUID-style without user id",
      ok.status === 200 && /^SHAREF-[0-9a-f-]{36}$/.test(b.reference), JSON.stringify(b));
    restore();
  }
  {
    // Paystack down -> the pending row is marked failed, not left dangling
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", 0);
    mockPaystack({ initFails: true });
    const res = await post("/api/wallet/fund/initialize", { amount: 500 }, env, await tokenFor(env, "u1"));
    restore();
    const row = DB._raw.prepare("SELECT status s FROM transactions").get();
    check("initialize: Paystack failure -> 500 and pending row marked failed", res.status === 500 && row.s === "failed", JSON.stringify(row));
  }
  {
    // per-user rate limit (10 / 10 min): 11th call blocked
    const { env, DB } = freshEnv();
    seedUser(DB, "rl1", 0);
    const t = await tokenFor(env, "rl1");
    mockPaystack();
    let last;
    for (let i = 0; i < 11; i++) last = await post("/api/wallet/fund/initialize", { amount: 100 }, env, t);
    restore();
    check("initialize: 11th attempt in window -> 429", last.status === 429);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run().catch((e) => { console.error("TEST RUNNER CRASHED:", e); process.exit(1); });
