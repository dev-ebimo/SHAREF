// Save point 2 — security hardening.
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { sign } from "hono/jwt";
import app from "../src/index.js";
import { createMockD1 } from "./mockD1.js";
import { hashOtp } from "../src/utils/otp.js";
import { hashPassword, verifyPassword, configuredIterations } from "../src/utils/password.js";
import { sendVerificationEmail, sendAnnouncementEmail, sendResourceStatusEmail } from "../src/services/emailService.js";
import { _clearAuthCache } from "../src/middleware/protect.js";

const schemaSql = fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
let passed = 0, failed = 0;
function check(label, cond, extra = "") {
  if (cond) { console.log("OK  -", label); passed++; } else { console.log("FAIL-", label, extra); failed++; }
}
const realFetch = globalThis.fetch;
const sent = [];
function mockSendgrid() {
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("api.sendgrid.com")) { sent.push(JSON.parse(opts.body)); return new Response(null, { status: 202 }); }
    return realFetch(url, opts);
  };
}
const restore = () => { globalThis.fetch = realFetch; };

function freshEnv(extra = {}) {
  const DB = createMockD1(schemaSql);
  _clearAuthCache();
  return { DB, env: { DB, JWT_SECRET: "s3cret", FRONTEND_URL: "https://app.test", SENDGRID_API_KEY: "SG.x", SENDGRID_FROM_EMAIL: "n@s.test", SENDGRID_FROM_NAME: "Sharef", ...extra } };
}
const ctx = () => { const t = []; return { ctx: { waitUntil: (p) => t.push(p), passThroughOnException() {} }, drain: () => Promise.all(t) }; };
function seedUser(DB, id, o = {}) {
  DB._raw.prepare(`INSERT INTO users (id, full_name, email, password, role, is_verified, account_status, preferences) VALUES (?,?,?,?,?,?,?, '{}')`)
    .run(id, o.name ?? id, o.email ?? `${id}@e.com`, o.password ?? "x", o.role ?? "student", o.verified ?? 1, o.status ?? "active");
}
const tok = (env, id, role = "student", iat = Math.floor(Date.now() / 1000)) => sign({ id, role, iat, exp: iat + 3600 }, env.JWT_SECRET);
let ipCounter = 0;
async function call(method, path, { body, token, env, origin, ip } = {}) {
  const { ctx: c, drain } = ctx();
  const res = await app.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip ?? `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env, c);
  await drain();
  return res;
}
const row = (DB, id) => DB._raw.prepare("SELECT * FROM users WHERE id=?").get(id);
const future = (m = 10) => new Date(Date.now() + m * 60000).toISOString();

async function run() {
  // ======================= password hashing =======================
  {
    const env = {};
    const h = await hashPassword(env, "correct horse");
    check("password: format pbkdf2-sha256$iters$salt$hash", /^pbkdf2-sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(h));
    check("password: same password hashes differently (random salt)", h !== (await hashPassword(env, "correct horse")));
    check("password: correct verifies", (await verifyPassword(env, "correct horse", h)).ok === true);
    check("password: wrong rejected", (await verifyPassword(env, "wrong", h)).ok === false);
    for (const bad of [null, undefined, "", "garbage", "pbkdf2-sha256$x$y$z", "pbkdf2-sha256$99999999$aa$bb", "pbkdf2-sha256$10$$"]) {
      const r = await verifyPassword(env, "x", bad);
      if (r.ok !== false) check(`password: malformed hash ${bad} rejected`, false);
    }
    check("password: malformed stored hashes never verify or throw", true);
    const legacy = await bcrypt.hash("oldpass99", 10);
    const lr = await verifyPassword(env, "oldpass99", legacy);
    check("password: legacy bcrypt verifies and asks for rehash", lr.ok && lr.needsRehash);
    check("password: legacy bcrypt wrong rejected", (await verifyPassword(env, "nope", legacy)).ok === false);
    const low = await hashPassword({ PBKDF2_ITERATIONS: "5000" }, "pw");
    const up = await verifyPassword({ PBKDF2_ITERATIONS: "20000" }, "pw", low);
    check("password: raising PBKDF2_ITERATIONS flags old hashes for upgrade", up.ok && up.needsRehash);
    check("password: iterations capped at Workers' 100k limit", configuredIterations({ PBKDF2_ITERATIONS: "5000000" }) === 100000);
    check("password: nonsense iterations fall back to default", configuredIterations({ PBKDF2_ITERATIONS: "abc" }) === 10000);
  }

  // ======================= suspension enforcement =======================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "adm", { role: "admin" }); seedUser(DB, "stu");
    const sTok = await tok(env, "stu"), aTok = await tok(env, "adm", "admin");
    check("suspend: active student can use API", (await call("GET", "/api/wallet/balance", { token: sTok, env })).status === 200);
    const sus = await call("POST", "/api/admin/users/stu/suspend", { body: { reason: "abuse" }, token: aTok, env });
    check("suspend: admin suspends student", sus.status === 200);
    const blocked = await call("GET", "/api/wallet/balance", { token: sTok, env });
    const bb = await blocked.json();
    check("suspend: existing token rejected IMMEDIATELY (401 + suspended flag)", blocked.status === 401 && bb.suspended === true, JSON.stringify(bb));
    await call("POST", "/api/admin/users/stu/reactivate", { token: aTok, env });
    check("suspend: reactivation restores access immediately", (await call("GET", "/api/wallet/balance", { token: sTok, env })).status === 200);
    const adm = await call("POST", "/api/admin/users/adm/suspend", { body: { reason: "x" }, token: aTok, env });
    check("suspend: admins (incl. self) cannot be suspended -> 403", adm.status === 403 && row(DB, "adm").account_status === "active");
    check("suspend: unknown user -> 404", (await call("POST", "/api/admin/users/nobody/suspend", { body: { reason: "x" }, token: aTok, env })).status === 404);
  }

  // ======================= session revocation on password change =======================
  {
    const { env, DB } = freshEnv();
    const pw = await hashPassword(env, "oldpassword1");
    seedUser(DB, "u1", { password: pw });
    const oldTok = await tok(env, "u1", "student", Math.floor(Date.now() / 1000) - 120);
    check("revoke: old token works before change", (await call("GET", "/api/wallet/balance", { token: oldTok, env })).status === 200);
    const res = await call("PATCH", "/api/users/me/password", { body: { currentPassword: "oldpassword1", newPassword: "newpassword22" }, token: oldTok, env });
    const b = await res.json();
    check("revoke: change password ok and returns fresh token", res.status === 200 && typeof b.token === "string", JSON.stringify(b));
    check("revoke: old (possibly stolen) token now dead", (await call("GET", "/api/wallet/balance", { token: oldTok, env })).status === 401);
    check("revoke: fresh token works", (await call("GET", "/api/wallet/balance", { token: b.token, env })).status === 200);
    check("revoke: stored hash is pbkdf2", row(DB, "u1").password.startsWith("pbkdf2-sha256$"));
    const wrong = await call("PATCH", "/api/users/me/password", { body: { currentPassword: "WRONG-pass1", newPassword: "another12345" }, token: b.token, env });
    check("revoke: wrong current password -> 401", wrong.status === 401);
  }

  // ======================= login: legacy upgrade, lockout =======================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", { email: "a@e.com", password: await bcrypt.hash("correcthorse", 10) });
    const r1 = await call("POST", "/api/auth/login", { body: { email: "a@e.com", password: "correcthorse" }, env });
    check("login: legacy bcrypt user can log in", r1.status === 200);
    check("login: hash silently upgraded to pbkdf2", row(DB, "u1").password.startsWith("pbkdf2-sha256$"));
    const r2 = await call("POST", "/api/auth/login", { body: { email: "a@e.com", password: "correcthorse" }, env });
    check("login: works again with upgraded hash", r2.status === 200);
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", { email: "a@e.com", password: await hashPassword(env, "correcthorse") });
    // unknown vs wrong password: identical response
    const unk = await call("POST", "/api/auth/login", { body: { email: "ghost@e.com", password: "whatever12" }, env });
    const wrong = await call("POST", "/api/auth/login", { body: { email: "a@e.com", password: "whatever12" }, env });
    check("login: unknown email and wrong password are indistinguishable", unk.status === 401 && wrong.status === 401 && (await unk.json()).message === (await wrong.json()).message);
    for (let i = 0; i < 8; i++) await call("POST", "/api/auth/login", { body: { email: "a@e.com", password: "bad-password" + i }, env });
    check("lockout: 10th failure still just 401", (await call("POST", "/api/auth/login", { body: { email: "a@e.com", password: "bad-x" }, env })).status === 401);
    const locked = await call("POST", "/api/auth/login", { body: { email: "a@e.com", password: "correcthorse" }, env });
    const lb = await locked.json();
    check("lockout: after 10 failures even the CORRECT password is refused (429, locked)", locked.status === 429 && lb.locked === true, JSON.stringify(lb));
    DB._raw.prepare("UPDATE users SET lockout_until = ? WHERE id='u1'").run(new Date(Date.now() - 1000).toISOString());
    check("lockout: works again once the lock expires", (await call("POST", "/api/auth/login", { body: { email: "a@e.com", password: "correcthorse" }, env })).status === 200);
    check("lockout: success clears the counter", row(DB, "u1").failed_logins === 0 && row(DB, "u1").lockout_until === null);
    // expired lock + one typo must NOT instantly re-lock
    for (let i = 0; i < 10; i++) await call("POST", "/api/auth/login", { body: { email: "a@e.com", password: "bad-password" + i }, env });
    DB._raw.prepare("UPDATE users SET lockout_until = ? WHERE id='u1'").run(new Date(Date.now() - 1000).toISOString());
    await call("POST", "/api/auth/login", { body: { email: "a@e.com", password: "typo-typo-1" }, env });
    check("lockout: after expiry the counter restarts (1, not 11)", row(DB, "u1").failed_logins === 1 && row(DB, "u1").lockout_until === null, JSON.stringify(row(DB, "u1")));
  }
  {
    // 30 PARALLEL guesses must still be capped at 10 real attempts
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", { email: "a@e.com", password: await hashPassword(env, "correcthorse") });
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => call("POST", "/api/auth/login", { body: { email: "a@e.com", password: "guess-number-" + i }, env })));
    const n401 = rs.filter((r) => r.status === 401).length, n429 = rs.filter((r) => r.status === 429).length;
    check("lockout: 30 parallel guesses -> only 10 evaluated, 20 blocked", n401 === 10 && n429 === 20, `${n401}/${n429}`);
  }
  {
    // suspended / unverified still handled, after password proves identity
    const { env, DB } = freshEnv();
    const pw = await hashPassword(env, "correcthorse");
    seedUser(DB, "s", { email: "s@e.com", password: pw, status: "suspended" });
    seedUser(DB, "n", { email: "n@e.com", password: pw, verified: 0 });
    check("login: suspended -> 403 suspended", (await call("POST", "/api/auth/login", { body: { email: "s@e.com", password: "correcthorse" }, env })).status === 403);
    const un = await call("POST", "/api/auth/login", { body: { email: "n@e.com", password: "correcthorse" }, env });
    check("login: unverified -> 403 unverified", un.status === 403 && (await un.json()).unverified === true);
  }

  // ======================= OTP security =======================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", { email: "o@e.com", verified: 0 });
    DB._raw.prepare("UPDATE users SET verification_otp=?, verification_otp_expires=? WHERE id='u1'").run(await hashOtp(env, "u1", "verify", "123456"), future());
    for (let i = 0; i < 4; i++) {
      const r = await call("POST", "/api/auth/verify-otp", { body: { email: "o@e.com", otp: "00000" + i }, env });
      if (r.status !== 400) check("otp: wrong guesses 1-4 are plain 400", false, r.status);
    }
    const fifth = await call("POST", "/api/auth/verify-otp", { body: { email: "o@e.com", otp: "000009" }, env });
    check("otp: 5th wrong guess -> 400 and code is destroyed", fifth.status === 400 && row(DB, "u1").verification_otp === null);
    const correctLate = await call("POST", "/api/auth/verify-otp", { body: { email: "o@e.com", otp: "123456" }, env });
    check("otp: the CORRECT code no longer works after the cap", correctLate.status === 400 && row(DB, "u1").is_verified === 0);
  }
  {
    // 40 parallel guesses against a live code: at most 5 evaluated
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", { email: "o@e.com", verified: 0 });
    DB._raw.prepare("UPDATE users SET verification_otp=?, verification_otp_expires=? WHERE id='u1'").run(await hashOtp(env, "u1", "verify", "123456"), future());
    const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => call("POST", "/api/auth/verify-otp", { body: { email: "o@e.com", otp: String(100000 + i) }, env })));
    check("otp: 40 parallel guesses -> attempt counter capped at 5", row(DB, "u1").verification_otp_attempts === 5, String(row(DB, "u1").verification_otp_attempts));
    check("otp: parallel guesses mostly answered 429", rs.filter((r) => r.status === 429).length >= 30);
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", { email: "o@e.com", verified: 0 });
    DB._raw.prepare("UPDATE users SET verification_otp=?, verification_otp_expires=? WHERE id='u1'").run(await hashOtp(env, "u1", "verify", "123456"), future());
    const ok = await call("POST", "/api/auth/verify-otp", { body: { email: "o@e.com", otp: "123456" }, env });
    check("otp: correct code verifies and clears state", ok.status === 200 && row(DB, "u1").is_verified === 1 && row(DB, "u1").verification_otp === null && row(DB, "u1").verification_otp_attempts === 0);
    // an OTP for the verify purpose must not work as a reset code
    seedUser(DB, "u2", { email: "p@e.com" });
    DB._raw.prepare("UPDATE users SET reset_password_otp=?, reset_password_otp_expires=? WHERE id='u2'").run(await hashOtp(env, "u2", "verify", "654321"), future());
    const cross = await call("POST", "/api/auth/reset-password", { body: { email: "p@e.com", otp: "654321", newPassword: "newpassword9" }, env });
    check("otp: codes are purpose-bound (verify code can't reset a password)", cross.status === 400);
  }
  {
    // enumeration: unknown / verified accounts look identical
    const { env, DB } = freshEnv();
    seedUser(DB, "v", { email: "v@e.com", verified: 1 });
    mockSendgrid(); sent.length = 0;
    const a = await call("POST", "/api/auth/verify-otp", { body: { email: "nobody@e.com", otp: "123456" }, env });
    const b = await call("POST", "/api/auth/verify-otp", { body: { email: "v@e.com", otp: "123456" }, env });
    check("enum: verify-otp unknown vs already-verified identical", a.status === 400 && b.status === 400 && (await a.json()).message === (await b.json()).message);
    const r1 = await call("POST", "/api/auth/resend-otp", { body: { email: "nobody@e.com" }, env });
    const r2 = await call("POST", "/api/auth/resend-otp", { body: { email: "v@e.com" }, env });
    check("enum: resend-otp unknown vs verified identical success, no email sent", r1.status === 200 && r2.status === 200 && sent.length === 0);
    restore();
  }
  {
    // resend + forgot-password cooldown (silent, still generic)
    const { env, DB } = freshEnv();
    seedUser(DB, "u1", { email: "o@e.com", verified: 0 });
    mockSendgrid(); sent.length = 0;
    const first = await call("POST", "/api/auth/resend-otp", { body: { email: "o@e.com" }, env });
    const second = await call("POST", "/api/auth/resend-otp", { body: { email: "o@e.com" }, env });
    check("cooldown: first resend sends, immediate second is silently skipped", first.status === 200 && second.status === 200 && sent.length === 1);
    DB._raw.prepare("UPDATE users SET verification_otp_expires=? WHERE id='u1'").run(future(8)); // issued 2 min ago
    await call("POST", "/api/auth/resend-otp", { body: { email: "o@e.com" }, env });
    check("cooldown: after 60s a resend works again", sent.length === 2);
    DB._raw.prepare("UPDATE users SET verification_otp_attempts=4 WHERE id='u1'").run();
    DB._raw.prepare("UPDATE users SET verification_otp_expires=? WHERE id='u1'").run(future(8));
    await call("POST", "/api/auth/resend-otp", { body: { email: "o@e.com" }, env });
    check("cooldown: a fresh code resets the attempt counter", row(DB, "u1").verification_otp_attempts === 0);
    seedUser(DB, "u2", { email: "f@e.com" });
    sent.length = 0;
    await call("POST", "/api/auth/forgot-password", { body: { email: "f@e.com" }, env });
    await call("POST", "/api/auth/forgot-password", { body: { email: "f@e.com" }, env });
    check("cooldown: forgot-password can't be used to spam an inbox", sent.length === 1);
    restore();
  }
  {
    // reset password: brute force cap + session revocation + lockout cleared
    const { env, DB } = freshEnv();
    const pw = await hashPassword(env, "oldpassword1");
    seedUser(DB, "u1", { email: "r@e.com", password: pw });
    DB._raw.prepare("UPDATE users SET reset_password_otp=?, reset_password_otp_expires=?, failed_logins=10, lockout_until=? WHERE id='u1'").run(await hashOtp(env, "u1", "reset", "222222"), future(), future(15));
    const oldTok = await tok(env, "u1", "student", Math.floor(Date.now() / 1000) - 60);
    for (let i = 0; i < 5; i++) await call("POST", "/api/auth/reset-password", { body: { email: "r@e.com", otp: "11111" + i, newPassword: "newpassword9" }, env });
    const late = await call("POST", "/api/auth/reset-password", { body: { email: "r@e.com", otp: "222222", newPassword: "newpassword9" }, env });
    check("reset: 5 wrong codes burn the code (correct one rejected after)", late.status === 400 && (await verifyPassword(env, "oldpassword1", row(DB, "u1").password)).ok);
    DB._raw.prepare("UPDATE users SET reset_password_otp=?, reset_password_otp_expires=?, reset_password_otp_attempts=0 WHERE id='u1'").run(await hashOtp(env, "u1", "reset", "222222"), future());
    const good = await call("POST", "/api/auth/reset-password", { body: { email: "r@e.com", otp: "222222", newPassword: "newpassword9" }, env });
    check("reset: correct code resets password", good.status === 200);
    check("reset: old session token revoked", (await call("GET", "/api/wallet/balance", { token: oldTok, env })).status === 401);
    check("reset: login lockout cleared so the owner can sign in", row(DB, "u1").failed_logins === 0 && row(DB, "u1").lockout_until === null);
    check("reset: can log in with new password", (await call("POST", "/api/auth/login", { body: { email: "r@e.com", password: "newpassword9" }, env })).status === 200);
  }

  // ======================= HTML injection in emails =======================
  {
    const { env } = freshEnv();
    mockSendgrid(); sent.length = 0;
    const evil = `<img src=x onerror=alert(1)>"&'`;
    await sendVerificationEmail(env, "a@e.com", evil, "123456");
    await sendResourceStatusEmail(env, "a@e.com", evil, evil, "rejected", evil);
    await sendAnnouncementEmail(env, "a@e.com", evil, `Hi\r\nBcc: x@y.z ${evil}`, evil);
    restore();
    const html = sent.map((m) => m.content.map((c) => c.value).join("")).join("\n");
    check("email: no raw <img> tag survives in any email body", !html.includes("<img"));
    check("email: text is escaped instead", html.includes("&lt;img src=x onerror=alert(1)&gt;"));
    check("email: subject has no CR/LF", !/[\r\n]/.test(sent[2].subject), JSON.stringify(sent[2].subject));
  }

  // ======================= error leakage, headers, CORS, health =======================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "u1");
    DB._raw.exec("DROP TABLE bookmarks");
    const res = await call("GET", "/api/bookmarks", { token: await tok(env, "u1"), env });
    const b = await res.json();
    check("leak: a DB failure returns 500 with NO raw error text", res.status === 500 && b.error === undefined && !JSON.stringify(b).includes("no such table"), JSON.stringify(b));
    const dev = freshEnv({ NODE_ENV: "development" });
    seedUser(dev.DB, "u1"); dev.DB._raw.exec("DROP TABLE bookmarks");
    const rd = await call("GET", "/api/bookmarks", { token: await tok(dev.env, "u1"), env: dev.env });
    check("leak: in development the detail is still available for debugging", typeof (await rd.json()).error === "string");
  }
  {
    const { env } = freshEnv();
    const prod = await call("GET", "/", { env, origin: "http://localhost:5000" });
    check("cors: production does NOT trust http://localhost:5000", prod.headers.get("access-control-allow-origin") !== "http://localhost:5000");
    const real = await call("GET", "/", { env, origin: "https://app.test" });
    check("cors: production trusts FRONTEND_URL", real.headers.get("access-control-allow-origin") === "https://app.test");
    const dev = freshEnv({ NODE_ENV: "development" });
    const d = await call("GET", "/", { env: dev.env, origin: "http://localhost:5000" });
    check("cors: dev mode allows localhost", d.headers.get("access-control-allow-origin") === "http://localhost:5000");
    const evil = await call("GET", "/", { env, origin: "https://evil.example" });
    check("cors: unknown origin not reflected", evil.headers.get("access-control-allow-origin") !== "https://evil.example");
    check("headers: nosniff + no-store + no-referrer", prod.headers.get("x-content-type-options") === "nosniff" && prod.headers.get("cache-control") === "no-store" && prod.headers.get("referrer-policy") === "no-referrer");
    const health = await (await call("GET", "/api/health", { env })).json();
    check("health: no longer publishes user count", health.success === true && health.usersInDb === undefined);
  }

  // ======================= misc input hardening =======================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, "u1");
    const big = { preferences: { junk: "x".repeat(10000) } };
    const res = await call("PATCH", "/api/users/me/preferences", { body: big, token: await tok(env, "u1"), env });
    check("prefs: oversized preferences payload rejected (400)", res.status === 400, res.status);
  }
  {
    // register limiter: 15 / hour / IP; the 16th gets 429
    const { env } = freshEnv();
    mockSendgrid();
    let last;
    for (let i = 0; i < 16; i++) {
      last = await call("POST", "/api/auth/register", { body: { fullName: "N", email: `x${i}@e.com`, password: "password123" }, env, ip: "9.9.9.9" });
    }
    restore();
    check("register: 16th sign-up from one IP in an hour -> 429", last.status === 429, last.status);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run().catch((e) => { console.error("TEST RUNNER CRASHED:", e); process.exit(1); });
