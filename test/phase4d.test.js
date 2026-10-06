import fs from "node:fs";
import crypto from "node:crypto";
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
  return {
    env: {
      DB,
      JWT_SECRET: "test-secret",
      FRONTEND_URL: "https://sharef-test.vercel.app",
      PAYSTACK_SECRET_KEY: "sk_test_fake",
    },
    DB,
  };
}

async function tokenFor(env, id, role = "student") {
  const now = Math.floor(Date.now() / 1000);
  return sign({ id, role, iat: now, exp: now + 604800 }, env.JWT_SECRET);
}

function seedUser(DB, { id, walletBalance = 0 }) {
  DB._raw
    .prepare(`INSERT INTO users (id, full_name, email, password, is_verified, wallet_balance, preferences) VALUES (?, ?, ?, ?, 1, ?, '{}')`)
    .run(id, `User ${id}`, `${id}@example.com`, "hash", walletBalance);
}

function seedResource(DB, { id, pages = 10, course = "CSC301", title = "Notes", status = "approved" }) {
  DB._raw
    .prepare(`INSERT OR IGNORE INTO users (id, full_name, email, password, is_verified, preferences) VALUES ('someone', 'Uploader', 'someone@example.com', 'hash', 1, '{}')`)
    .run();
  DB._raw
    .prepare(
      `INSERT INTO resources (id, title, type, department, course, level, semester, session, uploader_id,
        file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, pages, status)
       VALUES (?, ?, 'Textbook', 'CS', ?, '300', 'First', '2024/2025', 'someone',
               'f.pdf', 'https://x/f.pdf', 'pub', 102400, 'pdf', ?, ?)`
    )
    .run(id, title, course, pages, status);
}

async function postJson(path, body, env, token) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    env
  );
}
async function getAuthed(path, token, env) {
  return app.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }), env);
}

const realFetch = globalThis.fetch;
let paystackCalls = [];
function installPaystackMock({ verifyStatus = "success" } = {}) {
  paystackCalls = [];
  globalThis.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("api.paystack.co/transaction/initialize")) {
      paystackCalls.push({ url, opts });
      return new Response(
        JSON.stringify({ status: true, data: { authorization_url: "https://paystack.test/checkout/abc", reference: JSON.parse(opts.body).reference } }),
        { status: 200 }
      );
    }
    if (typeof url === "string" && url.includes("api.paystack.co/transaction/verify/")) {
      paystackCalls.push({ url, opts });
      const reference = url.split("/").pop();
      return new Response(JSON.stringify({ status: true, data: { status: verifyStatus, reference, amount: 50000, currency: "NGN" } }), { status: 200 });
    }
    return realFetch(url, opts);
  };
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

async function run() {
  // =========================================================================
  // getBalance
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 1500 });
    const token = await tokenFor(env, "u1");
    const res = await getAuthed("/api/wallet/balance", token, env);
    const body = await res.json();
    check("balance: 200 status", res.status === 200);
    check("balance: correct value", body.balance === 1500, body.balance);
  }

  // =========================================================================
  // initializeFunding
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1");
    installPaystackMock();

    const res = await postJson("/api/wallet/fund/initialize", { amount: 500 }, env, token);
    const body = await res.json();
    check("initialize: 200 status", res.status === 200, JSON.stringify(body));
    check("initialize: authorizationUrl returned", body.authorizationUrl === "https://paystack.test/checkout/abc");
    check("initialize: reference returned", typeof body.reference === "string" && body.reference.startsWith("SHAREF-") && !body.reference.includes("u1"));

    const row = DB._raw.prepare("SELECT * FROM transactions WHERE reference = ?").get(body.reference);
    check("initialize: pending transaction logged before Paystack call", !!row && row.status === "pending" && row.amount === 500);
    check("initialize: Paystack was actually called", paystackCalls.length === 1);

    restoreFetch();
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1");
    const res = await postJson("/api/wallet/fund/initialize", { amount: 0 }, env, token);
    check("initialize: zero amount rejected -> 400", res.status === 400);
    const res2 = await postJson("/api/wallet/fund/initialize", { amount: -50 }, env, token);
    check("initialize: negative amount rejected -> 400", res2.status === 400);
  }

  // =========================================================================
  // verifyFunding
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 0 });
    const timestamp = new Date().toISOString();
    DB._raw
      .prepare(`INSERT INTO transactions (id, user_id, type, amount, status, reference, created_at, updated_at) VALUES (?, ?, 'deposit', 500, 'pending', ?, ?, ?)`)
      .run("tx1", "u1", "SHAREF-u1-111", timestamp, timestamp);
    const token = await tokenFor(env, "u1");
    installPaystackMock({ verifyStatus: "success" });

    const res = await getAuthed("/api/wallet/fund/verify/SHAREF-u1-111", token, env);
    const body = await res.json();
    check("verify: 200 status", res.status === 200, JSON.stringify(body));

    const userRow = DB._raw.prepare("SELECT wallet_balance FROM users WHERE id = 'u1'").get();
    check("verify: wallet credited with the transaction's amount", userRow.wallet_balance === 500, userRow.wallet_balance);

    const txRow = DB._raw.prepare("SELECT status FROM transactions WHERE reference = 'SHAREF-u1-111'").get();
    check("verify: transaction marked successful", txRow.status === "successful");

    // Calling verify AGAIN for the same reference must NOT credit twice
    const res2 = await getAuthed("/api/wallet/fund/verify/SHAREF-u1-111", token, env);
    const body2 = await res2.json();
    check("verify: second call is idempotent (already confirmed)", res2.status === 200 && body2.message.includes("already confirmed"));
    const userRow2 = DB._raw.prepare("SELECT wallet_balance FROM users WHERE id = 'u1'").get();
    check("verify: balance NOT double-credited on second call", userRow2.wallet_balance === 500, userRow2.wallet_balance);

    restoreFetch();
  }
  {
    // failed payment marks the transaction failed, no credit
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 0 });
    const timestamp = new Date().toISOString();
    DB._raw
      .prepare(`INSERT INTO transactions (id, user_id, type, amount, status, reference, created_at, updated_at) VALUES (?, ?, 'deposit', 500, 'pending', ?, ?, ?)`)
      .run("tx2", "u1", "SHAREF-u1-222", timestamp, timestamp);
    const token = await tokenFor(env, "u1");
    installPaystackMock({ verifyStatus: "failed" });

    const res = await getAuthed("/api/wallet/fund/verify/SHAREF-u1-222", token, env);
    check("verify: failed payment -> 400", res.status === 400);
    const txRow = DB._raw.prepare("SELECT status FROM transactions WHERE reference = 'SHAREF-u1-222'").get();
    check("verify: transaction marked failed", txRow.status === "failed");
    const userRow = DB._raw.prepare("SELECT wallet_balance FROM users WHERE id = 'u1'").get();
    check("verify: no credit on failed payment", userRow.wallet_balance === 0);

    restoreFetch();
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1");
    const res = await getAuthed("/api/wallet/fund/verify/does-not-exist", token, env);
    check("verify: unknown reference -> 404", res.status === 404);
  }

  // =========================================================================
  // paystackWebhook — signature verification + crediting
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 0 });
    const timestamp = new Date().toISOString();
    DB._raw
      .prepare(`INSERT INTO transactions (id, user_id, type, amount, status, reference, created_at, updated_at) VALUES (?, ?, 'deposit', 500, 'pending', ?, ?, ?)`)
      .run("tx3", "u1", "SHAREF-u1-333", timestamp, timestamp);

    const payload = JSON.stringify({ event: "charge.success", data: { status: "success", currency: "NGN", reference: "SHAREF-u1-333", amount: 50000 } }); // 50000 kobo = 500 naira
    const signature = crypto.createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(payload).digest("hex");

    const res = await app.fetch(
      new Request("http://localhost/api/wallet/webhook", { method: "POST", headers: { "x-paystack-signature": signature }, body: payload }),
      env
    );
    check("webhook: valid signature -> 200", res.status === 200, await res.text());

    const userRow = DB._raw.prepare("SELECT wallet_balance FROM users WHERE id = 'u1'").get();
    check("webhook: wallet credited (kobo converted to naira)", userRow.wallet_balance === 500, userRow.wallet_balance);
  }
  {
    // invalid signature rejected, no credit
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 0 });
    const timestamp = new Date().toISOString();
    DB._raw
      .prepare(`INSERT INTO transactions (id, user_id, type, amount, status, reference, created_at, updated_at) VALUES (?, ?, 'deposit', 500, 'pending', ?, ?, ?)`)
      .run("tx4", "u1", "SHAREF-u1-444", timestamp, timestamp);

    const payload = JSON.stringify({ event: "charge.success", data: { status: "success", currency: "NGN", reference: "SHAREF-u1-444", amount: 50000 } });
    const res = await app.fetch(
      new Request("http://localhost/api/wallet/webhook", { method: "POST", headers: { "x-paystack-signature": "totally-fake-signature" }, body: payload }),
      env
    );
    check("webhook: invalid signature -> 401", res.status === 401);
    const userRow = DB._raw.prepare("SELECT wallet_balance FROM users WHERE id = 'u1'").get();
    check("webhook: no credit on invalid signature", userRow.wallet_balance === 0);
  }
  {
    // webhook fires AFTER verifyFunding already claimed it — must not double-credit
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 0 });
    const timestamp = new Date().toISOString();
    DB._raw
      .prepare(`INSERT INTO transactions (id, user_id, type, amount, status, reference, created_at, updated_at) VALUES (?, ?, 'deposit', 500, 'pending', ?, ?, ?)`)
      .run("tx5", "u1", "SHAREF-u1-555", timestamp, timestamp);
    const token = await tokenFor(env, "u1");
    installPaystackMock({ verifyStatus: "success" });

    // frontend's verify call wins the race first
    await getAuthed("/api/wallet/fund/verify/SHAREF-u1-555", token, env);
    restoreFetch();

    // webhook arrives afterward for the same reference
    const payload = JSON.stringify({ event: "charge.success", data: { status: "success", currency: "NGN", reference: "SHAREF-u1-555", amount: 50000 } });
    const signature = crypto.createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(payload).digest("hex");
    await app.fetch(
      new Request("http://localhost/api/wallet/webhook", { method: "POST", headers: { "x-paystack-signature": signature }, body: payload }),
      env
    );

    const userRow = DB._raw.prepare("SELECT wallet_balance FROM users WHERE id = 'u1'").get();
    check("webhook after verify: NOT double-credited (still 500, not 1000)", userRow.wallet_balance === 500, userRow.wallet_balance);
  }

  // =========================================================================
  // chargeForDownload
  // =========================================================================
  {
    // sufficient balance -> deducted, transaction logged, download recorded
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 1000 });
    seedResource(DB, { id: "r1", pages: 10 }); // cost = 200 + (10-5)*20 = 300

    const token = await tokenFor(env, "u1");
    const res = await postJson("/api/wallet/charge", { resourceId: "r1" }, env, token);
    const body = await res.json();
    check("charge: 200 status", res.status === 200, JSON.stringify(body));
    check("charge: alreadyOwned=false", body.alreadyOwned === false);
    check("charge: correct cost deducted (300)", body.newBalance === 700, body.newBalance);
    check("charge: fileUrl issued", typeof body.fileUrl === "string" && body.fileUrl.includes("/stream?token="));

    const txRow = DB._raw.prepare("SELECT * FROM transactions WHERE user_id = 'u1' AND resource_id = 'r1'").get();
    check("charge: purchase transaction logged", !!txRow && txRow.amount === 300 && txRow.status === "successful");

    const resourceRow = DB._raw.prepare("SELECT downloads FROM resources WHERE id = 'r1'").get();
    check("charge: resource download count incremented", resourceRow.downloads === 1);

    const logRow = DB._raw.prepare("SELECT * FROM download_logs WHERE user_id = 'u1' AND resource_id = 'r1'").get();
    check("charge: download log created", !!logRow);
  }
  {
    // already owned -> free re-download, no new charge
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 1000 });
    seedResource(DB, { id: "r1", pages: 10 });
    const timestamp = new Date().toISOString();
    DB._raw
      .prepare(`INSERT INTO transactions (id, user_id, type, amount, status, resource_id, created_at, updated_at) VALUES (?, ?, 'purchase', 300, 'successful', ?, ?, ?)`)
      .run("prior-tx", "u1", "r1", timestamp, timestamp);

    const token = await tokenFor(env, "u1");
    const res = await postJson("/api/wallet/charge", { resourceId: "r1" }, env, token);
    const body = await res.json();
    check("charge: already owned -> alreadyOwned=true", body.alreadyOwned === true, JSON.stringify(body));

    const userRow = DB._raw.prepare("SELECT wallet_balance FROM users WHERE id = 'u1'").get();
    check("charge: no additional deduction for re-download", userRow.wallet_balance === 1000, userRow.wallet_balance);

    const resourceRow = DB._raw.prepare("SELECT downloads FROM resources WHERE id = 'r1'").get();
    check("charge: download count still increments on re-download", resourceRow.downloads === 1);
  }
  {
    // insufficient balance -> 402, nothing deducted
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 100 });
    seedResource(DB, { id: "r1", pages: 10 }); // cost = 300, balance = 100

    const token = await tokenFor(env, "u1");
    const res = await postJson("/api/wallet/charge", { resourceId: "r1" }, env, token);
    const body = await res.json();
    check("charge: insufficient balance -> 402", res.status === 402, JSON.stringify(body));
    check("charge: insufficientBalance flag set", body.insufficientBalance === true);
    check("charge: required cost shown", body.required === 300);
    check("charge: current balance shown", body.currentBalance === 100);

    const userRow = DB._raw.prepare("SELECT wallet_balance FROM users WHERE id = 'u1'").get();
    check("charge: balance untouched on failed charge", userRow.wallet_balance === 100);

    const txCount = DB._raw.prepare("SELECT COUNT(*) as c FROM transactions").get();
    check("charge: no transaction logged on failed charge", txCount.c === 0);
  }
  {
    // Sequential exercise of the atomic guard: balance covers exactly ONE
    // purchase, not two. This verifies the WHERE-clause guard condition
    // itself is correct — i.e. code-level correctness. The atomicity
    // guarantee against TRUE concurrent requests comes from D1/SQLite's
    // guarantee that a single UPDATE statement executes indivisibly; that
    // property isn't something this mock (which wraps synchronous
    // node:sqlite calls) can exercise under real concurrency, so it isn't
    // re-tested here — only the guard logic this code is responsible for.
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 300 });
    seedResource(DB, { id: "r1", pages: 10 }); // cost 300
    seedResource(DB, { id: "r2", pages: 10 }); // cost 300
    const token = await tokenFor(env, "u1");

    const res1 = await postJson("/api/wallet/charge", { resourceId: "r1" }, env, token);
    check("charge: first purchase succeeds (balance exactly covers it)", res1.status === 200);

    const res2 = await postJson("/api/wallet/charge", { resourceId: "r2" }, env, token);
    check("charge: second purchase correctly rejected (balance now 0)", res2.status === 402);

    const userRow = DB._raw.prepare("SELECT wallet_balance FROM users WHERE id = 'u1'").get();
    check("charge: balance never goes negative", userRow.wallet_balance === 0, userRow.wallet_balance);
  }
  {
    // non-approved resource can't be charged for
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1", walletBalance: 1000 });
    seedResource(DB, { id: "r1", status: "pending" });
    const token = await tokenFor(env, "u1");
    const res = await postJson("/api/wallet/charge", { resourceId: "r1" }, env, token);
    check("charge: pending resource -> 404", res.status === 404);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("TEST RUNNER CRASHED:", e);
  process.exit(1);
});
