// Phase 6c (update package, Phase 3): scheduled jobs. Hourly clearing of rewards past their hold period,
// daily fraud-signal detection, and the cron dispatcher. Controller/service-level tests (real schema, SQLite).
// Run: node --experimental-sqlite test/phase6c-incentives-jobs.test.js
import { check, summary, freshEnv, ctx, one, all, n, iso, setCfg, seedUser, seedResource, seedLedger, LIVE_RULES } from "./incentiveTestLib.js";
import { clearMaturedRewards, detectFlags, runScheduledJobs, CRON_HOURLY, CRON_DAILY, FLAG_RULES, CLEAR_LIMITS } from "../src/jobs/incentiveJobs.js";
import { getFlags, getFlagCount } from "../src/controllers/adminIncentiveController.js";
import { reversalStatements } from "../src/services/rewardReversal.js";

const bal = (DB, id) => one(DB, "SELECT reward_pending p, reward_balance b FROM users WHERE id=?", id);
const pendingRow = (DB, o) => {
  const id = seedLedger(DB, { status: "pending", ...o });
  DB._raw.prepare("UPDATE reward_ledger SET clears_at=? WHERE id=?").run(o.clearsAt ?? iso(1), id);
  return id;
};
const status = (DB, id) => one(DB, "SELECT status s FROM reward_ledger WHERE id=?", id).s;
const consistent = (DB) => all(DB, "SELECT id FROM users").every(({ id }) => {
  const sum = (s) => n(DB, "SELECT COALESCE(SUM(amount),0) AS n FROM reward_ledger WHERE user_id=? AND type='reward' AND status=?", id, s);
  const x = bal(DB, id);
  return x.p === sum("pending") && x.b === sum("cleared");
});
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

// ============================================================ clearing
{
  const { env, DB } = freshEnv();
  ["a", "b", "ghost"].forEach((id) => seedUser(DB, id));
  DB._raw.prepare("UPDATE users SET reward_pending=250 WHERE id='a'").run();
  const due = pendingRow(DB, { user: "a", amount: 100, clearsAt: iso(1) });
  const notDue = pendingRow(DB, { user: "a", amount: 150, clearsAt: iso(-1) });
  const reversed = seedLedger(DB, { user: "b", amount: 70, status: "reversed" });
  DB._raw.prepare("UPDATE reward_ledger SET clears_at=? WHERE id=?").run(iso(1), reversed);
  const orphan = pendingRow(DB, { user: null, amount: 40, clearsAt: iso(1) });

  const r = await clearMaturedRewards(env);
  check("clearing: a reward past its hold period becomes 'cleared' and is moved pending → spendable", r.cleared === 1 && r.failed === 0 && status(DB, due) === "cleared" && bal(DB, "a").p === 150 && bal(DB, "a").b === 100, JSON.stringify([r, bal(DB, "a")]));
  check("clearing: a reward still inside its hold period is untouched", status(DB, notDue) === "pending");
  check("clearing: reversed rewards and rewards of deleted accounts are left alone", status(DB, reversed) === "reversed" && status(DB, orphan) === "pending" && bal(DB, "b").b === 0);
  const again = await clearMaturedRewards(env);
  check("clearing: running it again is a no-op (idempotent)", again.cleared === 0 && bal(DB, "a").p === 150 && bal(DB, "a").b === 100);
  check("clearing: balances still match the ledger", consistent(DB));
  const later = await clearMaturedRewards(env, { now: new Date(Date.now() + 2 * 864e5) });
  check("clearing: later, the remaining reward matures too", later.cleared === 1 && bal(DB, "a").p === 0 && bal(DB, "a").b === 250 && consistent(DB));
}
{
  const MAX = CLEAR_LIMITS.batch * CLEAR_LIMITS.rounds; // most rewards one hourly run will clear
  const { env, DB } = freshEnv(); seedUser(DB, "big");
  DB._raw.prepare("UPDATE users SET reward_pending=?1 WHERE id='big'").run(100 * 10);
  for (let i = 0; i < 100; i++) pendingRow(DB, { user: "big", amount: 10 });
  const r = await clearMaturedRewards(env);
  check("clearing: a backlog of 100 rewards is cleared in one run (several batches)", r.cleared === 100 && bal(DB, "big").b === 1000 && bal(DB, "big").p === 0 && consistent(DB));

  const w = freshEnv(); seedUser(w.DB, "huge");
  const total = MAX + 40;
  w.DB._raw.prepare("UPDATE users SET reward_pending=?1 WHERE id='huge'").run(total);
  for (let i = 0; i < total; i++) pendingRow(w.DB, { user: "huge", amount: 1 });
  const first = await clearMaturedRewards(w.env);
  check(`clearing: a run is BOUNDED (${MAX} max) so a huge backlog can never time a run out…`, first.cleared === MAX && n(w.DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE status='pending'") === 40);
  const second = await clearMaturedRewards(w.env);
  check("…and the next run simply continues where it stopped", second.cleared === 40 && bal(w.DB, "huge").b === total && consistent(w.DB));
}
{
  // one corrupt row must not stop everyone else getting paid
  const { env, DB } = freshEnv(); seedUser(DB, "broken"); seedUser(DB, "fine");
  DB._raw.prepare("UPDATE users SET reward_pending=50 WHERE id='fine'").run();
  const bad = pendingRow(DB, { user: "broken", amount: 100, clearsAt: iso(2) });   // ledger says 100 pending, balance says 0 → would violate CHECK
  const good = pendingRow(DB, { user: "fine", amount: 50, clearsAt: iso(1) });
  const r = await quiet(() => clearMaturedRewards(env));
  check("clearing: a corrupt row is skipped on its own, everyone else is still cleared", r.cleared === 1 && r.failed === 1 && status(DB, good) === "cleared" && status(DB, bad) === "pending" && bal(DB, "fine").b === 50, JSON.stringify(r));
  check("clearing: the corrupt row's student is NOT credited (no money created from nothing)", bal(DB, "broken").b === 0 && bal(DB, "broken").p === 0);
  const r2 = await quiet(() => clearMaturedRewards(env));
  check("clearing: a permanently bad row doesn't make the job spin", r2.cleared === 0 && r2.failed === 1);
}

{
  // The job reads "what is due", and only THEN does a moderator reverse one of those rewards. The job
  // must not move that reward's money (it would double-count the reversal).
  const { env, DB } = freshEnv(); seedUser(DB, "admin1", { role: "admin" }); seedUser(DB, "s");
  DB._raw.prepare("UPDATE users SET reward_pending=150 WHERE id='s'").run();
  const victim = pendingRow(DB, { user: "s", amount: 100, clearsAt: iso(2) });
  const other = pendingRow(DB, { user: "s", amount: 50, clearsAt: iso(1) });
  let hooked = false;
  const origPrepare = DB.prepare.bind(DB);
  const hookedDb = new Proxy(DB, { get(target, key) {
    if (key !== "prepare") return target[key];
    return (sql) => {
      const st = origPrepare(sql);
      if (!/clears_at <= \?/.test(sql) || !/LIMIT/.test(sql)) return st;
      return { bind: (...args) => { const b = st.bind(...args); return { all: async () => {
        const result = await b.all();
        if (!hooked) { hooked = true; const row = one(DB, "SELECT * FROM reward_ledger WHERE id=?", victim); await DB.batch(reversalStatements(DB, row, { adminId: "admin1", adminName: "Admin", reason: "reversed mid-run", ts: new Date().toISOString() })); }
        return result;
      } }; } };
    };
  } });
  const r = await clearMaturedRewards({ DB: hookedDb });
  check("clearing vs reversal race: the reversed reward is NOT moved to spendable by a stale list", hooked && status(DB, victim) === "reversed" && status(DB, other) === "cleared", JSON.stringify([r, status(DB, victim), status(DB, other)]));
  check("clearing vs reversal race: balances are exactly right (₦0 pending, ₦50 spendable), nothing failed", r.failed === 0 && bal(DB, "s").p === 0 && bal(DB, "s").b === 50, JSON.stringify([r, bal(DB, "s")]));
}

// ============================================================ flag detection
const flagsFor = (DB, userId) => all(DB, "SELECT * FROM incentive_flags WHERE user_id=?", userId);
const signalsOf = (DB, userId) => flagsFor(DB, userId).flatMap((f) => JSON.parse(f.signals));
const world = (status = "live", rules = LIVE_RULES) => { const w = freshEnv(); seedUser(w.DB, "uploader"); seedUser(w.DB, "admin1", { name: "Admin One", role: "admin" }); setCfg(w.DB, status, rules); return w; };

{
  const { env, DB } = world("off");
  seedUser(DB, "s1"); for (let i = 0; i < 3; i++) seedResource(DB, { id: "x" + i, status: "rejected", uploader: "s1", reviewedAt: iso(2) });
  DB._raw.prepare("UPDATE resources SET rejection_reason='Duplicate resource'").run();
  const r = await detectFlags(env);
  check("flags: program OFF → the job does nothing", r.skipped === true && n(DB, "SELECT COUNT(*) AS n FROM incentive_flags") === 0);
}
{
  const { env, DB } = world();
  const rej = (uid, reasons, daysAgo) => reasons.forEach((reason, i) => {
    seedResource(DB, { id: `${uid}-${i}`, status: "rejected", uploader: uid, reviewedAt: iso(daysAgo) });
    DB._raw.prepare("UPDATE resources SET rejection_reason=? WHERE id=?").run(reason, `${uid}-${i}`);
  });
  for (const id of ["s1", "s2", "s3", "s4"]) seedUser(DB, id);
  rej("s1", ["Duplicate resource", "SPAM / junk", "duplicate of CSC 301 notes"], 3);   // 3 duplicate/spam, recent → FLAG (case-insensitive)
  rej("s2", ["Duplicate resource", "spam"], 3);                                         // only 2 → no
  rej("s3", ["Duplicate", "Duplicate", "Duplicate"], 20);                               // too old → no
  rej("s4", ["Poor quality", "Wrong course", "Incomplete"], 3);                         // rejected, but not duplicate/spam → no
  const r = await detectFlags(env);
  check("flags/spam: 3+ duplicate-or-spam rejections in 14 days → flagged, in plain English", r.opened === 1 && signalsOf(DB, "s1").some((s) => /3 duplicate or spam uploads rejected/.test(s)), JSON.stringify(signalsOf(DB, "s1")));
  check("flags/spam: 2 recent, 3 old, or 3 for other reasons → NOT flagged", [flagsFor(DB, "s2"), flagsFor(DB, "s3"), flagsFor(DB, "s4")].every((f) => f.length === 0));
  const rows = flagsFor(DB, "s1");
  check("flags: opened as 'open' with a timestamp; nothing was frozen or reversed automatically", rows[0].status === "open" && !!rows[0].created_at && one(DB, "SELECT rewards_frozen f FROM users WHERE id='s1'").f === 0);
}
{
  const { env, DB } = world();
  const invite = (inv, ids, ipFor) => ids.forEach((id) => { seedUser(DB, id, { ip: ipFor(id) }); DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES (?,?,?,'verified',?,?)").run("rf-" + id, inv, id, iso(3), iso(3)); });
  seedUser(DB, "i1", { ip: "H1" }); seedUser(DB, "i2", { ip: "H2" }); seedUser(DB, "i3", { ip: "H3" });
  invite("i1", ["a1", "a2"], () => "H1");               // 2 friends on the inviter's own connection → FLAG
  invite("i2", ["b1"], () => "H2");                     // 1 → no (could be a roommate)
  invite("i3", ["c1", "c2"], (id) => "OTHER-" + id);    // 2 friends on different connections → no
  await detectFlags(env);
  check("flags/ring: 2+ referred friends on the inviter's own connection → flagged", signalsOf(DB, "i1").some((s) => /2 referred friends signed up from the same connection/.test(s)));
  check("flags/ring: a single shared connection, or different connections → NOT flagged", flagsFor(DB, "i2").length === 0 && flagsFor(DB, "i3").length === 0);
}
{
  const { env, DB } = world();                // weekly cap ₦300
  const earn = (uid, daysAgo, amount, status = "cleared") => seedLedger(DB, { user: uid, amount, status, createdAt: iso(daysAgo) });
  for (const id of ["k1", "k2", "k3", "k4"]) seedUser(DB, id);
  [1, 8, 15, 22].forEach((d) => earn("k1", d, 300));                    // at the cap in 4 consecutive weeks → FLAG
  [1, 8, 15].forEach((d) => earn("k2", d, 300));                        // only 3 weeks → no
  [1, 8, 15, 22].forEach((d, i) => earn("k3", d, i === 2 ? 299 : 300)); // one week ₦1 under the cap → no
  [1, 8, 15, 22].forEach((d) => earn("k4", d, 300, "reversed"));         // reversed rewards don't count
  await detectFlags(env);
  check("flags/cap-streak: at the weekly cap 4 weeks in a row → flagged", signalsOf(DB, "k1").some((s) => /full weekly cap \(₦300\) 4 weeks in a row/.test(s)), JSON.stringify(signalsOf(DB, "k1")));
  // (these students may still be flagged by the separate "never spent" signal; here we only assert the CAP-STREAK signal)
  const streakSignal = (id) => signalsOf(DB, id).some((s) => /weekly cap/.test(s));
  check("flags/cap-streak: 3 weeks, ₦1 under the cap in one week, or reversed rewards → no cap-streak signal", ["k2", "k3", "k4"].every((id) => !streakSignal(id)), JSON.stringify(["k2", "k3", "k4"].map((id) => signalsOf(DB, id))));
  const z = world("live", { ...LIVE_RULES, weeklyCap: 0 }); seedUser(z.DB, "k1"); [1, 8, 15, 22].forEach((d) => seedLedger(z.DB, { user: "k1", amount: 300, status: "cleared", createdAt: iso(d) }));
  await detectFlags(z.env);
  check("flags/cap-streak: with no weekly cap configured this signal is simply off", !signalsOf(z.DB, "k1").some((s) => /weekly cap/.test(s)));
}
{
  const { env, DB } = world();
  for (const id of ["h1", "h2", "h3", "h4"]) seedUser(DB, id);
  const rewards = (uid, amount, oldestDaysAgo) => { seedLedger(DB, { user: uid, amount: amount - 100, status: "cleared", createdAt: iso(oldestDaysAgo) }); seedLedger(DB, { user: uid, amount: 100, status: "cleared", createdAt: iso(1) }); };
  rewards("h1", 600, 20); DB._raw.prepare("UPDATE users SET reward_balance=600 WHERE id='h1'").run();    // earned, never spent → FLAG
  rewards("h2", 600, 20);
  DB._raw.prepare("INSERT INTO transactions (id,user_id,type,amount,status,resource_id,description,created_at,updated_at) VALUES ('p','h2','purchase',200,'successful',NULL,'',?,?)").run(iso(5), iso(5)); // has bought something
  rewards("h3", 600, 5);                                                                                  // too recent
  rewards("h4", 400, 20);                                                                                 // under ₦500
  await detectFlags(env);
  check("flags/never-spent: ≥₦500 earned over 14+ days and nothing ever downloaded → flagged", signalsOf(DB, "h1").some((s) => /earned ₦600 in rewards but has never downloaded anything/.test(s)), JSON.stringify(signalsOf(DB, "h1")));
  check("flags/never-spent: someone who HAS downloaded, is too new, or earned less → NOT flagged", [flagsFor(DB, "h2"), flagsFor(DB, "h3"), flagsFor(DB, "h4")].every((f) => f.length === 0));
  check("flags: `exposure` is the unspent money at risk (balance ₦600 here)", flagsFor(DB, "h1")[0].exposure === 600);
}
{
  const { env, DB } = world();
  seedUser(DB, "admin2", { role: "admin" });
  for (const id of ["m1", "m2", "m3"]) seedUser(DB, id);
  const give = (uid, admin, count) => { for (let i = 0; i < count; i++) seedLedger(DB, { user: uid, amount: 100, status: "cleared", approver: admin, createdAt: iso(2) }); };
  give("m1", "admin1", 5);                         // one moderator, 5 times → FLAG
  give("m2", "admin1", 4);                         // 4 → no
  give("m3", "admin1", 3); give("m3", "admin2", 2); // 5 total but two moderators → no
  await detectFlags(env);
  check("flags/same-moderator: 5 approvals of one student by one moderator in 14 days → flagged", signalsOf(DB, "m1").some((s) => /5 of this student's uploads were approved by the same moderator/.test(s)));
  check("flags/same-moderator: 4, or 5 split across two moderators → NOT flagged", flagsFor(DB, "m2").length === 0 && flagsFor(DB, "m3").length === 0);
}
{
  // several signals for one student → ONE flag with both lines; re-running updates it, never duplicates
  const { env, DB } = world(); seedUser(DB, "multi");
  for (let i = 0; i < 3; i++) { seedResource(DB, { id: "mm" + i, status: "rejected", uploader: "multi", reviewedAt: iso(1) }); DB._raw.prepare("UPDATE resources SET rejection_reason='Spam' WHERE id=?").run("mm" + i); }
  for (let i = 0; i < 5; i++) seedLedger(DB, { user: "multi", amount: 100, status: "cleared", approver: "admin1", createdAt: iso(2) });
  const r1 = await detectFlags(env);
  check("flags: two signals on one student → a single flag listing both", r1.opened === 1 && flagsFor(DB, "multi").length === 1 && signalsOf(DB, "multi").length === 2);
  const id1 = flagsFor(DB, "multi")[0].id;
  const auditsAfterFirst = n(DB, "SELECT COUNT(*) AS n FROM incentive_audit WHERE action='flags'");
  const r2 = await detectFlags(env);
  check("flags: running again updates the SAME open flag (no duplicates, no new audit noise)", r2.opened === 0 && r2.updated === 1 && flagsFor(DB, "multi").length === 1 && flagsFor(DB, "multi")[0].id === id1 && n(DB, "SELECT COUNT(*) AS n FROM incentive_audit WHERE action='flags'") === auditsAfterFirst);
  const audit = one(DB, "SELECT * FROM incentive_audit WHERE action='flags'");
  check("flags: opening new flags is recorded in the audit log by 'System'", auditsAfterFirst === 1 && audit.admin_name === "System" && audit.admin_id === null && /opened 1 new flag/.test(audit.detail));
  // visible to moderators through the admin API
  const list = await getFlags(ctx(env, { user: { id: "admin1", role: "admin" }, query: {} }));
  const cnt = await getFlagCount(ctx(env, { user: { id: "admin1", role: "admin" } }));
  check("flags: they show up in the admin Flags tab and the sidebar count", list.body.flags.some((f) => f.student === "User multi" && f.signals.length === 2) && cnt.body.flagsOpen === 1);
}
{
  // don't nag: recently-resolved flags are skipped; old ones can come back
  const { env, DB } = world(); seedUser(DB, "recent"); seedUser(DB, "long-ago");
  for (const uid of ["recent", "long-ago"]) for (let i = 0; i < 5; i++) seedLedger(DB, { user: uid, amount: 100, status: "cleared", approver: "admin1", createdAt: iso(2) });
  const resolved = (uid, daysAgo) => DB._raw.prepare("INSERT INTO incentive_flags (id,user_id,signals,exposure,status,resolved_at,created_at,updated_at) VALUES (?,?,'[]',0,'dismissed',?,?,?)").run("old-" + uid, uid, iso(daysAgo), iso(daysAgo + 1), iso(daysAgo));
  resolved("recent", 3); resolved("long-ago", 20);
  const r = await detectFlags(env);
  check("flags: a flag dismissed 3 days ago is NOT re-raised (quiet period)…", flagsFor(DB, "recent").filter((f) => f.status === "open").length === 0);
  check("…but one dismissed 20 days ago can be", flagsFor(DB, "long-ago").filter((f) => f.status === "open").length === 1 && r.opened === 1);
}
{
  const { env, DB } = world("shadow"); seedUser(DB, "sh");
  for (let i = 0; i < 3; i++) { seedResource(DB, { id: "sh" + i, status: "rejected", uploader: "sh", reviewedAt: iso(1) }); DB._raw.prepare("UPDATE resources SET rejection_reason='duplicate' WHERE id=?").run("sh" + i); }
  check("flags: also runs in shadow mode (so you can tune before going live)", (await detectFlags(env)).opened === 1);
  setCfg(DB, "paused"); DB._raw.prepare("DELETE FROM incentive_flags").run();
  check("flags: and while paused", (await detectFlags(env)).opened === 1);
}
check("flag thresholds are the documented, conservative ones", FLAG_RULES.spamRejections === 3 && FLAG_RULES.sharedConnectionReferrals === 2 && FLAG_RULES.capStreakWeeks === 4 && FLAG_RULES.neverSpentMin === 500 && FLAG_RULES.sameModerator === 5);

// ============================================================ cron dispatch
{
  const { env, DB } = world("off");
  const mk = () => { const waits = []; return { waits, ctx: { waitUntil: (p) => waits.push(p) } }; };
  let purged = [];
  const purge = async (e, opts) => { purged.push(opts); };
  let m = mk(); let ran = runScheduledJobs({ cron: CRON_HOURLY }, env, m.ctx, { purgeStaleUploads: purge }); await Promise.all(m.waits);
  check("cron(hourly): only the reward clearing runs", ran.join() === "clearMaturedRewards" && purged.length === 0);
  m = mk(); ran = runScheduledJobs({ cron: CRON_DAILY }, env, m.ctx, { purgeStaleUploads: purge }); await Promise.all(m.waits);
  check("cron(daily): upload cleanup + flag scan run (clearing doesn't)", ran.join() === "purgeStaleUploads,detectFlags" && purged.length === 1 && purged[0].limit === 20);
  m = mk(); purged = []; ran = runScheduledJobs({}, env, m.ctx, { purgeStaleUploads: purge }); await Promise.all(m.waits);
  check("cron(unknown / --test-scheduled): everything runs", ran.length === 3 && purged.length === 1);
  m = mk(); ran = runScheduledJobs({ cron: CRON_DAILY }, env, m.ctx, { purgeStaleUploads: async () => { throw new Error("cloudinary down"); } });
  const settled = await quiet(() => Promise.all(m.waits).then(() => "ok", () => "rejected"));
  check("cron: one job failing never breaks the others or crashes the run", settled === "ok");
  check("cron strings match what wrangler.toml declares", CRON_HOURLY === "0 * * * *" && CRON_DAILY === "0 2 * * *");
}

summary();
