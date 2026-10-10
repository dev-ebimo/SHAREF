// Phase 6c (update package, Phase 3): the payout engine that runs when a moderator approves an upload.
// Controller-level tests: real controllers + real schema.sql in SQLite, with a fake request context.
// Run: node --experimental-sqlite test/phase6c-incentives-engine.test.js
import { check, summary, freshEnv, ctx, one, all, n, iso, setCfg, seedUser, seedResource, seedLedger, seedBounty, hookAfter, LIVE_RULES } from "./incentiveTestLib.js";
import { approveResourceById, getModerationQueue } from "../src/controllers/moderationController.js";
import { awardForApproval, applyLimits } from "../src/services/rewardEngine.js";

const R = (over = {}, rewards = {}) => ({ ...LIVE_RULES, ...over, rewards: { ...LIVE_RULES.rewards, ...rewards } });
const A1 = { id: "admin1", role: "admin" }, A2 = { id: "admin2", role: "admin" };

function world(status = "live", rules = LIVE_RULES) {
  const w = freshEnv();
  seedUser(w.DB, "admin1", { name: "Admin One", role: "admin" });
  seedUser(w.DB, "admin2", { name: "Mod Two", role: "admin" });
  seedUser(w.DB, "stu", { name: "Student One" });
  setCfg(w.DB, status, rules);
  return w;
}
const pend = (DB, id, o = {}) => seedResource(DB, { id, status: "pending", uploader: "stu", ...o });
const approve = (env, admin, id, review = {}) =>
  approveResourceById(ctx(env, { user: admin }), id, { pages: 5, snippet: "", rewardTier: undefined, rewardNote: "", fileHash: null, ...review });
const rows = (DB, where = "1=1", ...a) => all(DB, `SELECT * FROM reward_ledger WHERE ${where} ORDER BY created_at, rowid`, ...a);
const u = (DB, id = "stu") => one(DB, "SELECT reward_pending p, reward_balance b, rewards_frozen f FROM users WHERE id=?", id);
// The ledger and the balances must never disagree (valid whenever nothing has been spent).
const consistent = (DB) => all(DB, "SELECT id FROM users").every(({ id }) => {
  const sum = (s) => n(DB, "SELECT COALESCE(SUM(amount),0) AS n FROM reward_ledger WHERE user_id=? AND type='reward' AND status=?", id, s);
  const x = u(DB, id);
  return x.p === sum("pending") && x.b === sum("cleared");
});

// =============================================================== program off: nothing at all
{
  const { env, DB } = world("off");
  pend(DB, "r1");
  const r = await approve(env, A1, "r1");
  check("off: approval works and the response is EXACTLY what it always was", r.status === 200 && r.body.success && r.body.message === "Resource approved" && !("reward" in r.body), JSON.stringify(r.body));
  check("off: no ledger rows, no balance change", rows(DB).length === 0 && u(DB).p === 0 && u(DB).b === 0);
}

// =============================================================== live: tiers, bonus, clamps
{
  const { env, DB } = world();
  pend(DB, "r1");
  let r = await approve(env, A1, "r1");
  const rs = rows(DB);
  check("live: first approved past question pays standard ₦100 + first-upload bonus ₦50", r.body.reward.status === "paid" && r.body.reward.amount === 150 && rs.length === 2 && rs.find((x) => x.tier === "standard").amount === 100 && rs.find((x) => x.tier === "first").amount === 50, JSON.stringify(rs.map((x) => [x.tier, x.amount])));
  const std = rs.find((x) => x.tier === "standard");
  check("live: rows are PENDING, owned by the student, tied to the resource, stamped with the approver", rs.every((x) => x.status === "pending" && x.user_id === "stu" && x.resource_id === "r1" && x.approved_by === "admin1" && x.type === "reward"));
  check("live: clears_at is now + holdDays (3 days)", Math.abs(new Date(std.clears_at).getTime() - (Date.now() + 3 * 864e5)) < 10000);
  check("live: the money sits in reward_pending (not yet spendable)", u(DB).p === 150 && u(DB).b === 0);
  check("live: moderator is told what happened, in the approval message", /Resource approved\. Reward of ₦150 recorded/.test(r.body.message) && /3 days/.test(r.body.message), r.body.message);
  check("live: label is human-readable", /CSC 301 Past Question approved/.test(std.label) && rs.find((x) => x.tier === "first").label === "First approved upload bonus");

  pend(DB, "r2"); r = await approve(env, A1, "r2");
  check("live: the bonus is ONE-TIME (second upload earns only ₦100)", r.body.reward.amount === 100 && rows(DB, "resource_id='r2'").length === 1 && u(DB).p === 250);
  pend(DB, "r3"); r = await approve(env, A1, "r3");
  check("weekly cap: pays the REMAINDER (cap 300, earned 250 → ₦50)", r.body.reward.amount === 50 && u(DB).p === 300, r.body.message);
  pend(DB, "r4"); r = await approve(env, A1, "r4");
  check("weekly cap: once reached, approval still succeeds but nothing is paid, and the moderator is told why", r.status === 200 && r.body.success && r.body.reward.status === "blocked" && /Weekly cap reached/.test(r.body.message) && rows(DB, "resource_id='r4'").length === 0 && one(DB, "SELECT status FROM resources WHERE id='r4'").status === "approved");
  check("ledger always equals the balances after all of the above", consistent(DB));
}
{
  const { env, DB } = world();
  pend(DB, "ln", { type: "Lecture Note" }); seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  check("lecture note pays its own standard amount (₦60), no bonus when not first", (await approve(env, A1, "ln")).body.reward.amount === 60);
  pend(DB, "other", { type: "Other" });
  const r = await approve(env, A1, "other");
  check("types without a standard reward pay nothing and say so", r.body.reward.status === "blocked" && /No reward is set for this type/.test(r.body.message) && rows(DB, "resource_id='other'").length === 0);
}
{
  const { env, DB } = world("live", R({ maxSinglePayout: 120 }));
  pend(DB, "r1");
  const r = await approve(env, A1, "r1");
  check("maxSinglePayout clamps the TOTAL (₦100 + ₦50 bonus capped at ₦120 → 100 + 20)", r.body.reward.amount === 120 && rows(DB).map((x) => x.amount).sort((a, b) => a - b).join() === "20,100");
}
{
  const { env, DB } = world();
  seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  pend(DB, "hi"); pend(DB, "ra");
  check("high tier pays ₦150", (await approve(env, A1, "hi", { rewardTier: "high", rewardNote: "Not on Sharef yet" })).body.reward.amount === 150);
  check("the moderator's reason is stored with the reward", rows(DB, "tier='high'")[0].note === "Not on Sharef yet");
  check("rare tier pays ₦200 (the weekly cap leaves ₦150, so it is clamped)", (await approve(env, A1, "ra", { rewardTier: "rare", rewardNote: "Very hard to find" })).body.reward.amount === 150);
  const w2 = world(); seedResource(w2.DB, { id: "old", status: "approved", uploader: "stu" }); pend(w2.DB, "ra");
  check("rare tier pays ₦200 when the cap allows", (await approve(w2.env, A1, "ra", { rewardTier: "rare", rewardNote: "Very hard to find" })).body.reward.amount === 200);
  const w3 = world(); pend(w3.DB, "none");
  const r = await approve(w3.env, A1, "none", { rewardTier: "none" });
  check("tier 'none': approved, nothing paid (not even the first-upload bonus)", r.body.success && rows(w3.DB).length === 0 && r.body.message === "Resource approved");
}

// =============================================================== self-approval, frozen, suspended, duplicates
{
  const { env, DB } = world();
  seedUser(DB, "admin3", { name: "Self Approver", role: "admin" });
  pend(DB, "mine", { uploader: "admin3" });
  const r = await approve(env, { id: "admin3", role: "admin" }, "mine");
  check("self-approval: the approval goes through but earns nothing, with an explanation", r.body.success && rows(DB).length === 0 && /themselves|own/i.test(r.body.message), r.body.message);
  DB._raw.prepare("UPDATE users SET rewards_frozen=1 WHERE id='stu'").run();
  pend(DB, "fz"); const f = await approve(env, A1, "fz");
  check("frozen student: approved, no reward, told why", f.body.success && /frozen/i.test(f.body.message) && rows(DB, "user_id='stu'").length === 0);
  DB._raw.prepare("UPDATE users SET rewards_frozen=0, account_status='suspended' WHERE id='stu'").run();
  pend(DB, "sp"); check("suspended student earns nothing", rows(DB, "user_id='stu'").length === 0 && (await approve(env, A1, "sp")).body.reward.status === "blocked");
}
{
  const { env, DB } = world();
  const H = "a".repeat(64);
  pend(DB, "d1"); pend(DB, "d2"); pend(DB, "d3"); seedUser(DB, "other");
  pend(DB, "d4", { uploader: "other" });
  check("duplicates: the first copy of a file is paid", (await approve(env, A1, "d1", { fileHash: H })).body.reward.status === "paid");
  const dup = await approve(env, A1, "d2", { fileHash: H });
  check("duplicates: re-uploading the SAME file (same hash) earns nothing", dup.body.reward.status === "blocked" && /already approved/.test(dup.body.message) && rows(DB, "resource_id='d2'").length === 0);
  const dup2 = await approve(env, A1, "d4", { fileHash: H });
  check("duplicates: also when a DIFFERENT student uploads the same file", dup2.body.reward.status === "blocked" && rows(DB, "resource_id='d4'").length === 0);
  check("duplicates: a different file (other hash) is paid; no hash = can't tell, so paid", (await approve(env, A1, "d3", { fileHash: "b".repeat(64) })).body.reward.status === "paid");
}

// =============================================================== requests (bounties)
{
  const { env, DB } = world();
  seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  seedBounty(DB, { id: "BNT", course: "CSC 305", reward: 120, max: 1, expires: iso(-5) });
  pend(DB, "b1", { course: "CSC 305", bountyId: "BNT" });
  let r = await approve(env, A1, "b1", { rewardTier: "bounty" });
  const row = rows(DB, "resource_id='b1'")[0];
  check("request: pays the request's reward (₦120), tagged with the request", r.body.reward.amount === 120 && row.tier === "bounty" && row.bounty_id === "BNT");
  check("request: slot used up → request marked fulfilled", one(DB, "SELECT paid, status FROM bounties WHERE id='BNT'").paid === 1 && one(DB, "SELECT status FROM bounties WHERE id='BNT'").status === "fulfilled");
  pend(DB, "b2", { course: "CSC 305", bountyId: "BNT" });
  r = await approve(env, A1, "b2", { rewardTier: "bounty" });
  check("request: a later upload for a FULL request quietly falls back to the standard reward", r.body.reward.amount === 100 && rows(DB, "resource_id='b2'")[0].tier === "standard");
}
{
  const { env, DB } = world("live", R({ weeklyCap: 5000 })); // roomy cap: this block tests request RULES, not the cap
  seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  seedBounty(DB, { id: "WRONG", course: "MTH 101", reward: 200, expires: iso(-5) });
  pend(DB, "m1", { course: "CSC 305", bountyId: "WRONG" });
  check("request: a request for a DIFFERENT course is never paid (standard instead)", (await approve(env, A1, "m1", { rewardTier: "bounty" })).body.reward.amount === 100);
  seedBounty(DB, { id: "LATE", course: "CSC 400", reward: 180, expires: iso(1) }); // closed yesterday
  pend(DB, "l1", { course: "CSC 400", bountyId: "LATE", createdAt: iso(3) }); // uploaded while it was still open
  check("request: judged on UPLOAD time, so a slow moderator can't make a student miss the deadline", (await approve(env, A1, "l1", { rewardTier: "bounty" })).body.reward.amount === 180);
  seedBounty(DB, { id: "LATE2", course: "CSC 401", reward: 180, expires: iso(1) });
  pend(DB, "l2", { course: "CSC 401", bountyId: "LATE2", createdAt: iso(0) }); // uploaded AFTER it closed
  check("request: but an upload made after the deadline doesn't qualify", (await approve(env, A1, "l2", { rewardTier: "bounty" })).body.reward.amount === 100);
  seedBounty(DB, { id: "QUICK", course: "CSC 500", reward: 90, expires: iso(-5) });
  pend(DB, "q1", { course: "CSC 500", bountyId: "QUICK" });
  check("quick-approve (no reward choice) defaults to the request's reward when there is one", (await approve(env, A1, "q1")).body.reward.amount === 90 && rows(DB, "resource_id='q1'")[0].tier === "bounty");
}
{
  // two uploads race for the LAST slot of one request
  const { env, DB } = world();
  seedUser(DB, "s2", { name: "Student Two" });
  seedBounty(DB, { id: "ONE", course: "CSC 305", reward: 120, max: 1, expires: iso(-5) });
  pend(DB, "x1", { course: "CSC 305", bountyId: "ONE" }); pend(DB, "x2", { uploader: "s2", course: "CSC 305", bountyId: "ONE" });
  await Promise.all([approve(env, A1, "x1", { rewardTier: "bounty" }), approve(env, A2, "x2", { rewardTier: "bounty" })]);
  check("request race: exactly ONE student gets the single slot, never two", n(DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE tier='bounty'") === 1 && one(DB, "SELECT paid FROM bounties WHERE id='ONE'").paid === 1);
  check("request race: ledger still matches the balances", consistent(DB));
}

// =============================================================== monthly budget + auto-pause, moderator daily limit
{
  const { env, DB } = world("live", R({ monthlyBudget: 120 }));
  seedUser(DB, "other");
  seedLedger(DB, { user: "other", amount: 100, status: "cleared", approver: "admin2" });
  pend(DB, "r1");
  const r = await approve(env, A1, "r1");
  check("monthly budget: pays what is left (₦120 − ₦100 = ₦20), not the full amount", r.body.reward.amount === 20 && rows(DB, "user_id='stu'").length === 1, r.body.message);
  check("monthly budget: reaching it AUTO-PAUSES the program", one(DB, "SELECT status FROM incentive_config").status === "paused");
  const a = all(DB, "SELECT * FROM incentive_audit WHERE action='auto-pause'");
  check("auto-pause is written to the audit log by 'System' with the figures", a.length === 1 && a[0].admin_name === "System" && a[0].admin_id === null && /budget reached/i.test(a[0].detail) && /₦120/.test(a[0].detail), JSON.stringify(a));
  pend(DB, "r2"); const r2 = await approve(env, A1, "r2");
  check("paused: approvals still succeed, nothing new is paid, the moderator is told", r2.body.success && rows(DB, "resource_id='r2'").length === 0 && /paused/i.test(r2.body.message) && all(DB, "SELECT id FROM incentive_audit WHERE action='auto-pause'").length === 1);
  const s = await (await import("../src/controllers/adminIncentiveController.js")).getSummary(ctx(env, { user: A1 }));
  check("auto-pause raises an alert on the Overview tab", s.body.alerts.some((x) => /paused automatically/i.test(x.text)));
}
{
  const { env, DB } = world("live", R({ monthlyBudget: 100 }));
  pend(DB, "r1"); seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  await approve(env, A1, "r1");
  check("monthly budget: paying EXACTLY the budget also pauses", one(DB, "SELECT status FROM incentive_config").status === "paused");
}
{
  const { env, DB } = world("live", R({ monthlyBudget: 0 }));
  pend(DB, "r1"); const r = await approve(env, A1, "r1");
  check("no budget set: pays nothing and says to set one (inert by default)", r.body.reward.status === "blocked" && /No monthly budget/.test(r.body.message) && rows(DB).length === 0);
  const w = world("live", R({ weeklyCap: 0 })); pend(w.DB, "r1");
  check("no weekly cap set: pays nothing and says to set one", /No weekly earning cap/.test((await approve(w.env, A1, "r1")).body.message));
}
{
  const { env, DB } = world("live", R({ adminDailyLimit: 150 }));
  seedUser(DB, "other"); seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  seedLedger(DB, { user: "other", amount: 100, status: "pending", approver: "admin1" });                 // admin1 awarded ₦100 today
  seedLedger(DB, { user: "other", amount: 500, status: "cleared", approver: "admin1", createdAt: iso(2) }); // two days ago: doesn't count
  pend(DB, "r1"); pend(DB, "r2");
  let r = await approve(env, A1, "r1");
  check("moderator daily limit: if this award would exceed it, NOTHING is paid (all-or-nothing) and they're told", r.body.reward.status === "blocked" && /daily award limit/.test(r.body.message) && rows(DB, "resource_id='r1'").length === 0);
  r = await approve(env, A2, "r2");
  check("moderator daily limit: is per moderator (another moderator can still award)", r.body.reward.amount === 100);
}

// =============================================================== races: limits are enforced INSIDE the write
{
  const { env, DB } = world("live", R({ weeklyCap: 150 }));
  seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  pend(DB, "a"); pend(DB, "b");
  await Promise.all([approve(env, A1, "a"), approve(env, A2, "b")]);
  const total = n(DB, "SELECT COALESCE(SUM(amount),0) AS n FROM reward_ledger WHERE user_id='stu'");
  check("race: two approvals for one student can NEVER exceed the weekly cap together (₦150)", total === 150, `total=${total}`);
  check("race: balance equals the ledger", consistent(DB));
}
{
  const { env, DB } = world("live", R({ monthlyBudget: 120 }));
  seedUser(DB, "s2", { name: "Student Two" }); seedUser(DB, "s3", { name: "Student Three" });
  for (const id of ["s1", "s2", "s3"]) seedResource(DB, { id: "old-" + id, status: "approved", uploader: id === "s1" ? "stu" : id });
  pend(DB, "a"); pend(DB, "b", { uploader: "s2" }); pend(DB, "c", { uploader: "s3" });
  await Promise.all([approve(env, A1, "a"), approve(env, A2, "b"), approve(env, A1, "c")]);
  const total = n(DB, "SELECT COALESCE(SUM(amount),0) AS n FROM reward_ledger");
  check("race: three approvals together can never overspend the monthly budget (₦120)", total === 120, `total=${total}`);
  check("race: ledger still matches the balances", consistent(DB));
}

{
  // a brand-new student's TWO first uploads approved at the same moment: both look "first", only one may get the bonus
  const { env, DB } = world("live", R({ weeklyCap: 5000 }));
  pend(DB, "a"); pend(DB, "b");
  await Promise.all([approve(env, A1, "a"), approve(env, A2, "b")]);
  check("race: two simultaneous first uploads earn the first-upload bonus exactly ONCE", n(DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE tier='first'") === 1, `bonuses=${n(DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE tier='first'")}`);
  check("race: and both uploads still earned their standard reward", n(DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE tier='standard'") === 2 && consistent(DB));
}

// =============================================================== shadow + paused + hold days
{
  const { env, DB } = world("shadow", R({ weeklyCap: 150 }));
  seedUser(DB, "inv"); seedBounty(DB, { id: "BS", course: "CSC 305", reward: 100, expires: iso(-5) });
  DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu','verified',?,?)").run(iso(5), iso(5));
  pend(DB, "r1", { course: "CSC 305", bountyId: "BS" });
  let r = await approve(env, A1, "r1", { rewardTier: "bounty" });
  const rs = rows(DB);
  check("shadow: rows are written with status 'shadow' (the same maths as live)", rs.length >= 2 && rs.every((x) => x.status === "shadow") && r.body.reward.status === "shadow" && /Shadow mode/.test(r.body.message), r.body.message);
  check("shadow: NO balance moves for anyone", u(DB).p === 0 && u(DB).b === 0 && u(DB, "inv").p === 0);
  check("shadow: request and referral state are NOT touched", one(DB, "SELECT paid, status FROM bounties WHERE id='BS'").paid === 0 && one(DB, "SELECT status FROM referrals WHERE id='rf'").status === "verified");
  pend(DB, "r2"); r = await approve(env, A1, "r2");
  check("shadow: shadow rows count toward limits WHILE in shadow (projection matches live)", r.body.reward.status === "blocked" && /Weekly cap/.test(r.body.message), r.body.message);
  setCfg(DB, "live", R({ weeklyCap: 150 }));
  pend(DB, "r3"); r = await approve(env, A1, "r3");
  check("going live: earlier SHADOW rows don't eat the real weekly cap", r.body.reward.status === "paid" && r.body.reward.amount === 100 && u(DB).p === 100, r.body.message);
}
{
  // restored + re-approved after the program went live: a shadow row must not block the real payment
  const { env, DB } = world("shadow");
  pend(DB, "r1"); await approve(env, A1, "r1");
  DB._raw.prepare("UPDATE resources SET status='pending', reviewed_by=NULL, reviewed_at=NULL WHERE id='r1'").run();
  DB._raw.prepare("DELETE FROM reward_ledger WHERE tier='first'").run(); // (the one-time bonus has its own guard, tested separately)
  setCfg(DB, "live");
  const r = await approve(env, A1, "r1");
  check("shadow→live: re-approving an upload that only has a SHADOW row is paid for real", r.body.reward.status === "paid" && rows(DB, "status='pending' AND resource_id='r1'").length >= 1, r.body.message);
}
{
  const { env, DB } = world("paused");
  pend(DB, "r1"); const r = await approve(env, A1, "r1");
  check("paused: approved, nothing paid, balances untouched", r.body.success && rows(DB).length === 0 && /paused/i.test(r.body.message));
}
{
  const { env, DB } = world("live", R({ holdDays: 0 }));
  pend(DB, "r1"); const r = await approve(env, A1, "r1");
  check("holdDays 0: paid straight into the spendable balance as 'cleared'", rows(DB).every((x) => x.status === "cleared") && u(DB).p === 0 && u(DB).b === 150 && !/becomes spendable/.test(r.body.message));
  check("holdDays 0: ledger matches balances", consistent(DB));
}

// =============================================================== referrals
{
  const { env, DB } = world();
  seedUser(DB, "inv", { name: "Inviter" });
  const ref = (status = "verified") => DB._raw.prepare("INSERT OR REPLACE INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu',?,?,?)").run(status, iso(5), iso(5));
  ref();
  pend(DB, "r1"); const r = await approve(env, A1, "r1");
  const inv = rows(DB, "user_id='inv'");
  check("referral: the inviter is paid when the friend's first upload is approved", inv.length === 1 && inv[0].tier === "referral" && inv[0].amount === 50 && inv[0].referral_id === "rf" && inv[0].resource_id === "r1" && u(DB, "inv").p === 50);
  check("referral: friend is marked 'contributed' and the inviter's earnings recorded", one(DB, "SELECT status, earned FROM referrals WHERE id='rf'").status === "contributed" && one(DB, "SELECT earned FROM referrals WHERE id='rf'").earned === 50);
  check("referral: the approval message mentions the inviter's bonus; the student still gets their own reward", /Referral bonus ₦50/.test(r.body.message) && r.body.reward.amount === 150);
  pend(DB, "r2"); await approve(env, A1, "r2");
  check("referral: paid ONCE only (the friend's second upload pays no one else)", rows(DB, "tier='referral'").length === 1);
  check("referral: ledger matches balances", consistent(DB));
}
{
  const { env, DB } = world(); seedUser(DB, "inv");
  DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu','signed_up',?,?)").run(iso(5), iso(5));
  pend(DB, "r1"); await approve(env, A1, "r1");
  check("referral: NOT paid until the friend has verified their account", rows(DB, "user_id='inv'").length === 0 && one(DB, "SELECT status FROM referrals WHERE id='rf'").status === "signed_up");
}
{
  const { env, DB } = world(); seedUser(DB, "inv", { frozen: 1 });
  DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu','verified',?,?)").run(iso(5), iso(5));
  pend(DB, "r1"); await approve(env, A1, "r1");
  check("referral: a frozen inviter isn't paid, and the referral is closed so it can't be retried later", rows(DB, "user_id='inv'").length === 0 && one(DB, "SELECT status, earned FROM referrals WHERE id='rf'").status === "contributed");
}
{
  const { env, DB } = world();
  seedUser(DB, "inv", { ip: "samehash" }); DB._raw.prepare("UPDATE users SET signup_ip_hash='samehash' WHERE id='stu'").run();
  DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu','verified',?,?)").run(iso(5), iso(5));
  pend(DB, "r1"); const r = await approve(env, A1, "r1");
  check("referral ring: a friend who signed up from the inviter's own connection earns the inviter NOTHING", rows(DB, "user_id='inv'").length === 0 && /withheld/.test(r.body.message) && one(DB, "SELECT status FROM referrals WHERE id='rf'").status === "contributed");
  check("referral ring: the student's own reward is unaffected", r.body.reward.amount === 150);
}
{
  const { env, DB } = world("live", R({}, { referralFirstApproval: 0 })); seedUser(DB, "inv");
  DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu','verified',?,?)").run(iso(5), iso(5));
  pend(DB, "r1"); await approve(env, A1, "r1");
  check("referral: configured to ₦0 → no payment", rows(DB, "user_id='inv'").length === 0);
  const w = world(); seedUser(w.DB, "inv"); seedLedger(w.DB, { user: "inv", amount: 300, status: "cleared" }); // inviter already at weekly cap
  w.DB._raw.prepare("UPDATE users SET reward_balance=300 WHERE id='inv'").run();
  w.DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu','verified',?,?)").run(iso(5), iso(5));
  pend(w.DB, "r1"); const r = await approve(w.env, A1, "r1");
  check("referral: the INVITER's own weekly cap applies to the bonus", rows(w.DB, "user_id='inv' AND tier='referral'").length === 0 && r.body.reward.amount === 150);
}
{
  const { env, DB } = world("shadow"); seedUser(DB, "inv");
  DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu','verified',?,?)").run(iso(5), iso(5));
  pend(DB, "r1"); await approve(env, A1, "r1");
  check("referral (shadow): recorded as a shadow row, no money, status unchanged", rows(DB, "user_id='inv'")[0]?.status === "shadow" && u(DB, "inv").p === 0 && one(DB, "SELECT status FROM referrals WHERE id='rf'").status === "verified");
}
{
  const { env, DB } = world(); seedUser(DB, "inv");
  DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu','verified',?,?)").run(iso(5), iso(5));
  pend(DB, "r1"); await approve(env, A1, "r1", { rewardTier: "none" });
  check("referral: an approval that earns nothing doesn't use up the referral", one(DB, "SELECT status FROM referrals WHERE id='rf'").status === "verified" && rows(DB).length === 0);
}

// =============================================================== idempotency
{
  const { env, DB } = world();
  pend(DB, "r1"); await approve(env, A1, "r1");
  const before = { rows: rows(DB).length, p: u(DB).p };
  const second = await approve(env, A1, "r1");
  check("double-click: a second approval of the same item is rejected (409) and pays nothing", second.status === 409 && rows(DB).length === before.rows && u(DB).p === before.p);
  const resource = one(DB, "SELECT * FROM resources WHERE id='r1'");
  const again = await awardForApproval(DB, { resource, admin: A1, review: {}, ts: new Date().toISOString() });
  check("engine retry: calling it twice for the same upload pays once — the 2nd is refused and the batch rolls back", again.status === "blocked" && /already rewarded once/.test(again.message) && rows(DB).length === before.rows && u(DB).p === before.p);
  check("idempotency: the ledger still matches the balances", consistent(DB));
}
{
  // removed then restored then approved again: no double-dip even though the first reward was reversed
  const { env, DB } = world(); seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  pend(DB, "r1"); await approve(env, A1, "r1");
  const { removeApprovedResource, restoreToPending } = await import("../src/controllers/adminResourceController.js");
  await removeApprovedResource(ctx(env, { user: A1, params: { id: "r1" }, body: { reason: "Wrong course" } }));
  await restoreToPending(ctx(env, { user: A1, params: { id: "r1" } }));
  const r = await approve(env, A1, "r1");
  check("remove → restore → re-approve cannot be paid a second time", r.body.reward.status === "blocked" && /already rewarded once/.test(r.body.message) && u(DB).p === 0 && rows(DB, "status IN ('pending','cleared')").length === 0);
}

// =============================================================== defaults for quick-approve + safety nets
{
  const { env, DB } = world();
  pend(DB, "risky"); const t0 = (id) => seedResource(DB, { id, status: "rejected", uploader: "stu", reviewedAt: iso(1) });
  ["j1", "j2", "j3"].forEach(t0);
  let r = await approve(env, A1, "risky");
  check("quick-approve for a HIGH-risk student pays nothing automatically and says to use the full dialog", r.body.reward.status === "blocked" && /high-risk/.test(r.body.message) && rows(DB).length === 0, r.body.message);
  pend(DB, "risky2");
  r = await approve(env, A1, "risky2", { rewardTier: "standard" });
  check("…but when a moderator deliberately chooses a reward in the dialog, it is paid", r.body.reward.status === "paid");
}
{
  const { env, DB } = world();
  pend(DB, "r1");
  DB._raw.exec("DROP TABLE reward_ledger");
  const r = await approve(env, A1, "r1");
  check("engine failure NEVER undoes an approval: success, with a clear warning for the moderator", r.status === 200 && r.body.success && r.body.reward.status === "error" && /could not be recorded/.test(r.body.message) && one(DB, "SELECT status FROM resources WHERE id='r1'").status === "approved", JSON.stringify(r.body));
}

// =============================================================== the guards INSIDE the write (world changes mid-approval)
// Everything above checks the plan; these prove the write itself refuses what became illegal a moment after the plan was made.
{
  // another approval hands this student the one-time bonus after our check said "no bonus given yet"
  const { env, DB } = world("live", R({ weeklyCap: 5000 }));
  pend(DB, "mine"); seedResource(DB, { id: "elsewhere", status: "pending", uploader: "stu" });
  const resource = one(DB, "SELECT * FROM resources WHERE id='mine'");
  const racing = hookAfter(DB, /tier = 'first'.*LIMIT 1/s, async () => {
    DB._raw.prepare("INSERT INTO reward_ledger (id,user_id,type,amount,status,tier,label,resource_id,approved_by,created_at) VALUES ('RACED','stu','reward',50,'pending','first','First approved upload bonus','elsewhere','admin2',?)").run(new Date().toISOString());
    DB._raw.prepare("UPDATE users SET reward_pending = 50 WHERE id='stu'").run();
  });
  const r = await awardForApproval(racing, { resource, admin: A1, review: {}, ts: new Date().toISOString() });
  check("write-time guard: a bonus granted by someone else a moment ago is NOT granted again (still exactly one bonus)", n(DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE tier='first'") === 1 && r.amount === 100, JSON.stringify(r));
  check("write-time guard: the standard reward was still paid and the balances agree (₦50 raced bonus + ₦100)", u(DB).p === 150 && consistent(DB));
}
{
  // the moderator's daily limit is used up by a parallel approval after our check passed
  const { env, DB } = world("live", R({ adminDailyLimit: 150 }));
  seedUser(DB, "other"); seedResource(DB, { id: "old", status: "approved", uploader: "stu" }); pend(DB, "mine");
  const resource = one(DB, "SELECT * FROM resources WHERE id='mine'");
  const racing = hookAfter(DB, /FROM resources\s+WHERE uploader_id = \?/, async () => {
    DB._raw.prepare("INSERT INTO reward_ledger (id,user_id,type,amount,status,tier,label,approved_by,created_at) VALUES ('PARALLEL','other','reward',100,'pending','standard','x','admin1',?)").run(new Date().toISOString());
  });
  const r = await awardForApproval(racing, { resource, admin: A1, review: {}, ts: new Date().toISOString() });
  check("write-time guard: a moderator's daily limit used up a moment earlier by a parallel approval stops THIS payout", rows(DB, "resource_id='mine'").length === 0 && r.status === "blocked" && /moment of approval/.test(r.message), JSON.stringify(r));
  check("write-time guard: and nothing was credited to the student", u(DB).p === 0 && u(DB).b === 0);
}

// =============================================================== limits maths (pure)
{
  const rules = R();
  const L = (o) => applyLimits(rules, { total: 100, earned7d: 0, paidMonth: 0, adminToday: 0, ...o });
  check("limits: nothing used → full amount", L({}).amount === 100);
  check("limits: weekly remainder clamps", L({ earned7d: 250 }).amount === 50);
  check("limits: monthly remainder clamps", L({ paidMonth: 19950 }).amount === 50);
  check("limits: the smaller of the two clamps wins", L({ earned7d: 280, paidMonth: 19950 }).amount === 20);
  check("limits: moderator limit is all-or-nothing", L({ adminToday: 2950 }).amount === 0 && L({ adminToday: 2900 }).amount === 100);
  check("limits: exhausted → zero with a reason", L({ earned7d: 300 }).reason === "Weekly cap reached for this student." && L({ paidMonth: 20000 }).reason === "Monthly reward budget reached.");
}

summary();
