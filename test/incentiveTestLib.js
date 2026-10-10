// Shared helpers for the phase6b incentive tests: a fake request context (so controllers run without
// the Hono router), seed helpers, and check()/summary(). Used by test/phase6b-incentives-*.test.js.
import fs from "node:fs";
import { createMockD1 } from "./mockD1.js";

export const schemaSql = fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
let passed = 0, failed = 0;
export const check = (label, cond, extra = "") => { console.log(cond ? "OK  -" : "FAIL-", label, cond ? "" : extra); cond ? passed++ : failed++; };
export const summary = () => { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); };
export const iso = (daysAgo = 0) => new Date(Date.now() - daysAgo * 864e5).toISOString();

export function freshEnv(extra = {}) {
  const DB = createMockD1(schemaSql);
  return { DB, env: { DB, JWT_SECRET: "test-secret", CLOUDINARY_CLOUD_NAME: "cloud", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s", ...extra } };
}
export function ctx(env, { user, query = {}, params = {}, body, headers = {} } = {}) {
  const waits = [];
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    env, waits,
    get: (k) => (k === "user" ? user : undefined),
    req: {
      url: "https://api.example.workers.dev/api/x",
      query: (k) => query[k], param: (k) => params[k], header: (k) => h[k.toLowerCase()],
      json: async () => { if (body === undefined) throw new Error("no body"); return body; },
      valid: () => body,
    },
    json: (b, status = 200) => ({ status, body: b }),
    executionCtx: { waitUntil: (p) => { waits.push(Promise.resolve(p).catch(() => {})); } },
  };
}
export const raw = (DB) => DB._raw;
export const one = (DB, sql, ...a) => DB._raw.prepare(sql).get(...a);
export const all = (DB, sql, ...a) => DB._raw.prepare(sql).all(...a);
export const n = (DB, sql, ...a) => DB._raw.prepare(sql).get(...a).n;

export const LIVE_RULES = {
  monthlyBudget: 20000, weeklyCap: 300, maxSinglePayout: 250, adminDailyLimit: 3000, holdDays: 3, ratioAlert: 40,
  rewards: { pastQuestion: 100, lectureNote: 60, high: 150, rare: 200, firstApproval: 50, referralSignup: 0, referralFirstApproval: 50 },
};
export function setCfg(DB, status, rules = LIVE_RULES) {
  DB._raw.prepare("UPDATE incentive_config SET status = ?, rules = ? WHERE id = 1").run(status, typeof rules === "string" ? rules : JSON.stringify(rules));
}
export function seedUser(DB, id, o = {}) {
  const { name = `User ${id}`, role = "student", department = "Computer Science", level = "300", wallet = 0, rb = 0, rp = 0, frozen = 0,
          status = "active", verified = 1, ip = null, created = iso(60), code = null, referredBy = null } = o;
  DB._raw.prepare(`INSERT INTO users (id,full_name,email,password,role,department,level,wallet_balance,reward_balance,reward_pending,rewards_frozen,
      account_status,is_verified,signup_ip_hash,created_at,preferences,referral_code,referred_by) VALUES (?,?,?,'h',?,?,?,?,?,?,?,?,?,?,?,'{}',?,?)`)
    .run(id, name, `${id}@x.com`, role, department, level, wallet, rb, rp, frozen, status, verified, ip, created, code, referredBy);
}
export function seedResource(DB, o) {
  const { id, status = "approved", type = "Past Question", uploader = "uploader", reviewedBy = null, reviewedAt = null, bountyId = null,
          course = "CSC 301", createdAt = iso(1), hash = null, pages = 5 } = o;
  DB._raw.prepare(`INSERT INTO resources (id,title,type,department,course,level,semester,session,uploader_id,file_name,file_url,cloudinary_public_id,
      file_size_bytes,file_extension,pages,status,reviewed_by,reviewed_at,bounty_id,file_hash,created_at,updated_at)
      VALUES (?,?,?,'Computer Science',?,'300','First','2024/2025',?,'f.pdf','https://x/f.pdf','pub',1000,'pdf',?,?,?,?,?,?,?,?)`)
    .run(id, "T " + id, type, course, uploader, pages, status, reviewedBy, reviewedAt, bountyId, hash, createdAt, createdAt);
}
let lid = 0;
export function seedLedger(DB, o) {
  const { id = "L" + ++lid, user = null, amount, status = "cleared", tier = "standard", label = "Reward", resource = null, approver = "admin1",
          createdAt = iso(0), type = "reward", reverses = null } = o;
  DB._raw.prepare(`INSERT INTO reward_ledger (id,user_id,type,amount,status,tier,label,resource_id,approved_by,created_at,reverses_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, user, type, amount, status, tier, label, resource, approver, createdAt, reverses);
  return id;
}
export function seedBounty(DB, o = {}) {
  const { id = "B" + ++lid, course = "CSC 305", type = "Past Questions", level = "300 Level", reward = 100, max = 1, paid = 0, status = "open", expires = iso(-7), created = iso(1) } = o;
  DB._raw.prepare(`INSERT INTO bounties (id,course,course_key,type,level,reward,max_payouts,paid,note,expires_at,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'',?,?,?,?)`).run(id, course, course.toUpperCase().replace(/[^A-Z0-9]/g, ""), type, level, reward, max, paid, expires, status, created, created);
  return id;
}

// Wraps a DB so that, the first time a statement whose SQL matches `regex` finishes reading, `after()` runs
// (once). Lets a test change the world BETWEEN a controller's checks and its write, which is the only way to
// prove that the guards inside the write itself (not just the checks before it) really hold.
export function hookAfter(DB, regex, after) {
  let fired = false;
  const original = DB.prepare.bind(DB);
  return new Proxy(DB, {
    get(target, key) {
      if (key !== "prepare") return target[key];
      return (sql) => {
        const st = original(sql);
        if (!regex.test(sql)) return st;
        return {
          bind: (...args) => {
            const b = st.bind(...args);
            const wrap = (method) => async () => { const r = await b[method](); if (!fired) { fired = true; await after(); } return r; };
            return { first: wrap("first"), all: wrap("all"), run: () => b.run() };
          },
        };
      };
    },
  });
}
