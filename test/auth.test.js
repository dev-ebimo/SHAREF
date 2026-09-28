import fs from "node:fs";
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

// Capture outbound "emails" instead of hitting the real SendGrid API.
const sentEmails = [];
const realFetch = globalThis.fetch;
function installFetchMock() {
  globalThis.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("api.sendgrid.com")) {
      sentEmails.push(JSON.parse(opts.body));
      return new Response(null, { status: 202 });
    }
    return realFetch(url, opts);
  };
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

function freshEnv() {
  const DB = createMockD1(schemaSql);
  return {
    env: {
      DB,
      JWT_SECRET: "test-secret-do-not-use-in-prod",
      SENDGRID_API_KEY: "SG.fake",
      SENDGRID_FROM_EMAIL: "noreply@sharef.test",
      SENDGRID_FROM_NAME: "Sharef",
      FRONTEND_URL: "https://sharef-test.vercel.app",
    },
    DB,
  };
}

// executionCtx.waitUntil needs to exist on the context Hono builds from the
// second fetch() arg — Workers normally supplies this; we stub it so
// c.executionCtx.waitUntil(...) in the controller doesn't throw, and so we
// can await the promise it was given before asserting on side effects.
function withExecutionCtx() {
  const tasks = [];
  return {
    ctx: { waitUntil: (p) => tasks.push(p), passThroughOnException() {} },
    async drain() {
      await Promise.all(tasks);
    },
  };
}

async function postJson(path, body, env, ctx) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    ctx
  );
}

async function run() {
  installFetchMock();

  // ---------------------------------------------------------------------
  // 1. Register — happy path
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx, drain } = withExecutionCtx();
    sentEmails.length = 0;

    const res = await postJson(
      "/api/auth/register",
      { fullName: "Ada Lovelace", email: "Ada@Example.com", password: "supersecret1" },
      env,
      ctx
    );
    const body = await res.json();
    await drain();

    check("register: 201 status", res.status === 201, JSON.stringify(body));
    check("register: email echoed back lowercased", body.email === "ada@example.com", body.email);

    const row = DB._raw.prepare("SELECT * FROM users WHERE email = ?").get("ada@example.com");
    check("register: user row created", !!row);
    check("register: password is hashed, not plaintext", row.password !== "supersecret1" && row.password.startsWith("$2"));
    check("register: is_verified starts false", row.is_verified === 0);
    check("register: verification_otp is a 6-digit string", /^\d{6}$/.test(row.verification_otp));
    check("register: preferences default landingPage", JSON.parse(row.preferences).landingPage === "dashboard");
    check("register: verification email was sent", sentEmails.length === 1);
    check("register: email sent to correct address", sentEmails[0]?.personalizations[0].to[0].email === "ada@example.com");
  }

  // ---------------------------------------------------------------------
  // 2. Register — duplicate email rejected
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    DB._raw.exec(`
      INSERT INTO users (id, full_name, email, password, preferences)
      VALUES ('existing1', 'Existing User', 'taken@example.com', 'hash', '{}')
    `);

    const res = await postJson(
      "/api/auth/register",
      { fullName: "New Person", email: "taken@example.com", password: "supersecret1" },
      env,
      ctx
    );
    const body = await res.json();
    check("register: duplicate email -> 409", res.status === 409, JSON.stringify(body));
    check("register: duplicate email message", body.message.includes("email already exists"));
  }

  // ---------------------------------------------------------------------
  // 3. Register — validation errors (matches old {success:false, errors:[]} shape)
  // ---------------------------------------------------------------------
  {
    const { env } = freshEnv();
    const { ctx } = withExecutionCtx();
    const res = await postJson("/api/auth/register", { fullName: "", email: "not-an-email", password: "short" }, env, ctx);
    const body = await res.json();
    check("register: validation -> 400", res.status === 400);
    check("register: validation errors is an array", Array.isArray(body.errors));
    check("register: validation flags fullName", body.errors.some((e) => e.field === "fullName"));
    check("register: validation flags email", body.errors.some((e) => e.field === "email"));
    check("register: validation flags password", body.errors.some((e) => e.field === "password"));
  }

  // ---------------------------------------------------------------------
  // 4. verify-otp — happy path issues a working token
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    DB._raw
      .prepare(
        `INSERT INTO users (id, full_name, email, password, verification_otp, verification_otp_expires, preferences)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run("u2", "Bob Test", "bob@example.com", "hash", "123456", future, "{}");

    const res = await postJson("/api/auth/verify-otp", { email: "bob@example.com", otp: "123456" }, env, ctx);
    const body = await res.json();
    check("verify-otp: 200 status", res.status === 200, JSON.stringify(body));
    check("verify-otp: token issued", typeof body.token === "string" && body.token.length > 10);

    const row = DB._raw.prepare("SELECT * FROM users WHERE id = 'u2'").get();
    check("verify-otp: is_verified flips to true", row.is_verified === 1);
    check("verify-otp: OTP cleared after use", row.verification_otp === null);
  }

  // ---------------------------------------------------------------------
  // 5. verify-otp — wrong code rejected
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    DB._raw
      .prepare(
        `INSERT INTO users (id, full_name, email, password, verification_otp, verification_otp_expires, preferences)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run("u3", "Carl Test", "carl@example.com", "hash", "654321", future, "{}");

    const res = await postJson("/api/auth/verify-otp", { email: "carl@example.com", otp: "000000" }, env, ctx);
    const body = await res.json();
    check("verify-otp: wrong code -> 400", res.status === 400, JSON.stringify(body));
  }

  // ---------------------------------------------------------------------
  // 6. verify-otp — expired code rejected
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    DB._raw
      .prepare(
        `INSERT INTO users (id, full_name, email, password, verification_otp, verification_otp_expires, preferences)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run("u4", "Dana Test", "dana@example.com", "hash", "111111", past, "{}");

    const res = await postJson("/api/auth/verify-otp", { email: "dana@example.com", otp: "111111" }, env, ctx);
    const body = await res.json();
    check("verify-otp: expired code -> 400", res.status === 400, JSON.stringify(body));
    check("verify-otp: expired code message", body.message.includes("expired"));
  }

  // ---------------------------------------------------------------------
  // 7. login — happy path
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("correcthorse", 10);
    DB._raw
      .prepare(
        `INSERT INTO users (id, full_name, email, password, is_verified, preferences)
         VALUES (?, ?, ?, ?, 1, ?)`
      )
      .run("u5", "Eve Test", "eve@example.com", hash, JSON.stringify({
        landingPage: "resources",
        moderation: { landingPage: "approved" },
      }));

    const res = await postJson("/api/auth/login", { email: "eve@example.com", password: "correcthorse" }, env, ctx);
    const body = await res.json();
    check("login: 200 status", res.status === 200, JSON.stringify(body));
    check("login: token issued", typeof body.token === "string");
    check("login: landingPage passed through from preferences", body.user.landingPage === "resources");
    check("login: moderationLandingPage passed through", body.user.moderationLandingPage === "approved");

    const row = DB._raw.prepare("SELECT last_login_at FROM users WHERE id = 'u5'").get();
    check("login: last_login_at updated", !!row.last_login_at);
  }

  // ---------------------------------------------------------------------
  // 8. login — wrong password rejected
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("correcthorse", 10);
    DB._raw
      .prepare(`INSERT INTO users (id, full_name, email, password, is_verified, preferences) VALUES (?, ?, ?, ?, 1, ?)`)
      .run("u6", "Frank Test", "frank@example.com", hash, "{}");

    const res = await postJson("/api/auth/login", { email: "frank@example.com", password: "wrongpassword" }, env, ctx);
    check("login: wrong password -> 401", res.status === 401);
  }

  // ---------------------------------------------------------------------
  // 9. login — suspended account blocked
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("correcthorse", 10);
    DB._raw
      .prepare(
        `INSERT INTO users (id, full_name, email, password, is_verified, account_status, suspension_reason, preferences)
         VALUES (?, ?, ?, ?, 1, 'suspended', ?, ?)`
      )
      .run("u7", "Gina Test", "gina@example.com", hash, "Payment dispute", "{}");

    const res = await postJson("/api/auth/login", { email: "gina@example.com", password: "correcthorse" }, env, ctx);
    const body = await res.json();
    check("login: suspended -> 403", res.status === 403, JSON.stringify(body));
    check("login: suspended flag set", body.suspended === true);
    check("login: suspension reason passed through", body.reason === "Payment dispute");
  }

  // ---------------------------------------------------------------------
  // 10. login — unverified account blocked
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("correcthorse", 10);
    DB._raw
      .prepare(`INSERT INTO users (id, full_name, email, password, is_verified, preferences) VALUES (?, ?, ?, ?, 0, ?)`)
      .run("u8", "Hank Test", "hank@example.com", hash, "{}");

    const res = await postJson("/api/auth/login", { email: "hank@example.com", password: "correcthorse" }, env, ctx);
    const body = await res.json();
    check("login: unverified -> 403", res.status === 403, JSON.stringify(body));
    check("login: unverified flag set", body.unverified === true);
  }

  // ---------------------------------------------------------------------
  // 11. forgot-password — existing user gets an OTP + email, generic response
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx, drain } = withExecutionCtx();
    sentEmails.length = 0;
    DB._raw
      .prepare(`INSERT INTO users (id, full_name, email, password, preferences) VALUES (?, ?, ?, ?, ?)`)
      .run("u9", "Ivy Test", "ivy@example.com", "hash", "{}");

    const res = await postJson("/api/auth/forgot-password", { email: "ivy@example.com" }, env, ctx);
    const body = await res.json();
    await drain();
    check("forgot-password: 200 status", res.status === 200);
    check("forgot-password: generic message", body.message.includes("If an account exists"));

    const row = DB._raw.prepare("SELECT reset_password_otp FROM users WHERE id = 'u9'").get();
    check("forgot-password: OTP was set", /^\d{6}$/.test(row.reset_password_otp));
    check("forgot-password: reset email sent", sentEmails.length === 1);
  }

  // ---------------------------------------------------------------------
  // 12. forgot-password — nonexistent user gets the SAME generic response (no enumeration)
  // ---------------------------------------------------------------------
  {
    const { env } = freshEnv();
    const { ctx, drain } = withExecutionCtx();
    sentEmails.length = 0;

    const res = await postJson("/api/auth/forgot-password", { email: "ghost@example.com" }, env, ctx);
    const body = await res.json();
    await drain();
    check("forgot-password: nonexistent user -> still 200", res.status === 200);
    check("forgot-password: nonexistent user -> same generic message", body.message.includes("If an account exists"));
    check("forgot-password: no email sent for nonexistent user", sentEmails.length === 0);
  }

  // ---------------------------------------------------------------------
  // 13. reset-password — happy path, new password actually works for login
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const bcrypt = (await import("bcryptjs")).default;
    const oldHash = await bcrypt.hash("oldpassword1", 10);
    DB._raw
      .prepare(
        `INSERT INTO users (id, full_name, email, password, is_verified, reset_password_otp, reset_password_otp_expires, preferences)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run("u10", "Jack Test", "jack@example.com", oldHash, "222222", future, "{}");

    const res = await postJson(
      "/api/auth/reset-password",
      { email: "jack@example.com", otp: "222222", newPassword: "newpassword2" },
      env,
      ctx
    );
    const body = await res.json();
    check("reset-password: 200 status", res.status === 200, JSON.stringify(body));

    // Confirm the NEW password actually logs in, and the OLD one no longer does.
    const loginOld = await postJson("/api/auth/login", { email: "jack@example.com", password: "oldpassword1" }, env, ctx);
    check("reset-password: old password no longer works", loginOld.status === 401);

    const loginNew = await postJson("/api/auth/login", { email: "jack@example.com", password: "newpassword2" }, env, ctx);
    check("reset-password: new password works for login", loginNew.status === 200);

    const row = DB._raw.prepare("SELECT reset_password_otp FROM users WHERE id = 'u10'").get();
    check("reset-password: OTP cleared after use", row.reset_password_otp === null);
  }

  // ---------------------------------------------------------------------
  // 14. login — incomplete/legacy preferences blob doesn't crash, falls back to defaults
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("correcthorse", 10);
    DB._raw
      .prepare(`INSERT INTO users (id, full_name, email, password, is_verified, preferences) VALUES (?, ?, ?, ?, 1, ?)`)
      .run("u12", "Leo Test", "leo@example.com", hash, "{}"); // simulates a pre-migration/legacy row

    const res = await postJson("/api/auth/login", { email: "leo@example.com", password: "correcthorse" }, env, ctx);
    const body = await res.json();
    check("login: incomplete preferences -> still 200, not 500", res.status === 200, JSON.stringify(body));
    check("login: falls back to default landingPage", body.user.landingPage === "dashboard");
    check("login: falls back to default moderationLandingPage", body.user.moderationLandingPage === "pending");
  }

  // ---------------------------------------------------------------------
  // 15. Rate limiting — login limiter kicks in after 10 attempts from same IP
  // ---------------------------------------------------------------------
  {
    const { env, DB } = freshEnv();
    const { ctx } = withExecutionCtx();
    DB._raw
      .prepare(`INSERT INTO users (id, full_name, email, password, is_verified, preferences) VALUES (?, ?, ?, ?, 1, ?)`)
      .run("u11", "Kim Test", "kim@example.com", "hash", "{}");

    let lastStatus;
    for (let i = 0; i < 11; i++) {
      const res = await app.fetch(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
          body: JSON.stringify({ email: "kim@example.com", password: "wrongpassword" }),
        }),
        env,
        ctx
      );
      lastStatus = res.status;
    }
    check("rate limit: 11th attempt from same IP -> 429", lastStatus === 429, `got ${lastStatus}`);
  }

  restoreFetch();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("TEST RUNNER CRASHED:", e);
  process.exit(1);
});
