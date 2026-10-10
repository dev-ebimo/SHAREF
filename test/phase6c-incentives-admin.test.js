// Phase 6c (update package, Phase 3): moderator-facing money views and safeguards. The reward preview in the
// moderation queue, automatic reversal when an approved resource is removed, reward rows in the admin
// transactions list, and one end-to-end run (approve → clear → spend → Overview totals).
// Run: node --experimental-sqlite test/phase6c-incentives-admin.test.js
import { check, summary, freshEnv, ctx, one, all, n, iso, setCfg, seedUser, seedResource, seedLedger, seedBounty, LIVE_RULES } from "./incentiveTestLib.js";
import { approveResourceById, getModerationQueue } from "../src/controllers/moderationController.js";
import { removeApprovedResource } from "../src/controllers/adminResourceController.js";
import { getTransactions, getTransactionSummary } from "../src/controllers/adminTransactionController.js";
import { getSummary, reversePayout } from "../src/controllers/adminIncentiveController.js";
import { getMyIncentives } from "../src/controllers/incentiveController.js";
import { chargeForDownload, getBalance } from "../src/controllers/walletController.js";
import { clearMaturedRewards } from "../src/jobs/incentiveJobs.js";

const R = (over = {}, rewards = {}) => ({ ...LIVE_RULES, ...over, rewards: { ...LIVE_RULES.rewards, ...rewards } });
const A1 = { id: "admin1", role: "admin" };
function world(status = "live", rules = LIVE_RULES) {
  const w = freshEnv();
  seedUser(w.DB, "admin1", { name: "Admin One", role: "admin" }); seedUser(w.DB, "admin2", { name: "Mod Two", role: "admin" });
  seedUser(w.DB, "stu", { name: "Student One" });
  setCfg(w.DB, status, rules);
  return w;
}
const approve = (env, admin, id, review = {}) => approveResourceById(ctx(env, { user: admin }), id, { pages: 5, snippet: "", rewardTier: undefined, rewardNote: "", fileHash: null, ...review });
const rows = (DB, where = "1=1", ...a) => all(DB, `SELECT * FROM reward_ledger WHERE ${where} ORDER BY created_at, rowid`, ...a);
const stu = (DB, id = "stu") => one(DB, "SELECT reward_pending p, reward_balance b, wallet_balance w FROM users WHERE id=?", id);
const queueItem = async (env, id, admin = A1) => (await getModerationQueue(ctx(env, { user: admin, query: { limit: "50" } }))).body.queue.find((q) => q.id === id);

// ============================================================ reward preview in the moderation queue
{
  const { env, DB } = world("off");
  seedResource(DB, { id: "p", status: "pending", uploader: "stu" });
  check("preview: program off → the queue has no reward fields at all", !("rewardPreview" in (await queueItem(env, "p"))));
}
{
  // each scenario builds a world with one pending item "it"; the preview must agree with what approving really does
  const scenarios = {
    "normal":            { build: () => world(), expect: { blocked: false, amount: 100 } },
    "own upload":        { build: () => { const w = world(); DB_uploader(w, "admin1"); return w; }, expect: { blocked: true, reason: /own upload/ } },
    "frozen student":    { build: () => { const w = world(); w.DB._raw.prepare("UPDATE users SET rewards_frozen=1 WHERE id='stu'").run(); return w; }, expect: { blocked: true, reason: /frozen/ } },
    "weekly cap hit":    { build: () => { const w = world(); seedLedger(w.DB, { user: "stu", amount: 300, status: "cleared", approver: "admin2" }); return w; }, expect: { blocked: true, reason: /Weekly cap/ } },
    "weekly cap partial":{ build: () => { const w = world(); seedLedger(w.DB, { user: "stu", amount: 250, status: "cleared", approver: "admin2" }); return w; }, expect: { blocked: false, amount: 50 } },
    "budget exhausted":  { build: () => { const w = world(); seedUser(w.DB, "o"); seedLedger(w.DB, { user: "o", amount: 20000, status: "cleared", approver: "admin2" }); return w; }, expect: { blocked: true, reason: /Monthly reward budget/ } },
    "budget partial":    { build: () => { const w = world(); seedUser(w.DB, "o"); seedLedger(w.DB, { user: "o", amount: 19970, status: "cleared", approver: "admin2" }); return w; }, expect: { blocked: false, amount: 30 } },
    "my daily limit":    { build: () => { const w = world("live", R({ adminDailyLimit: 50 })); return w; }, expect: { blocked: true, reason: /daily award limit/ } },
    "no budget set":     { build: () => world("live", R({ monthlyBudget: 0 })), expect: { blocked: true, reason: /No monthly budget/ } },
    "type with no reward": { build: () => world(), type: "Other", expect: { blocked: true, reason: /No reward is set/ } },
    "open request":      { build: () => { const w = world(); seedBounty(w.DB, { id: "B", course: "CSC 301", reward: 140, expires: iso(-5) }); return w; }, bounty: "B", expect: { blocked: false, amount: 140 } },
    "paused":            { build: () => world("paused"), expect: { blocked: true, reason: /paused/ } },
  };
  function DB_uploader(w, id) { w.DB._raw.prepare("UPDATE resources SET uploader_id=? WHERE id='it'").run(id); }
  for (const [name, sc] of Object.entries(scenarios)) {
    const { env, DB } = sc.build();
    seedResource(DB, { id: "old", status: "approved", uploader: name === "own upload" ? "admin1" : "stu" }); // not their first, so no bonus muddies the numbers
    seedResource(DB, { id: "it", status: "pending", uploader: name === "own upload" ? "admin1" : "stu", type: sc.type || "Past Question", bountyId: sc.bounty || null });
    const item = await queueItem(env, "it");
    const p = item.rewardPreview;
    const ok = p && p.blocked === sc.expect.blocked && (sc.expect.blocked ? sc.expect.reason.test(p.blockReason) : p.amount === sc.expect.amount);
    check(`preview[${name}]: ${sc.expect.blocked ? "blocked — " + p?.blockReason : "pays ₦" + p?.amount}`, ok, JSON.stringify(p));
    const real = await approve(env, A1, "it");           // quick-approve: the default tier, exactly what the preview describes
    const paid = rows(DB, "resource_id='it'").reduce((s, r) => s + r.amount, 0);
    check(`preview[${name}]: agrees with what approving really does`, sc.expect.blocked ? paid === 0 : paid === sc.expect.amount, `preview=${JSON.stringify(p)} paid=${paid} msg=${real.body.message}`);
  }
  const w = world("shadow"); seedResource(w.DB, { id: "p", status: "pending", uploader: "stu" });
  check("preview: also shown in shadow mode", (await queueItem(w.env, "p")).rewardPreview.blocked === false);
}

// ============================================================ automatic reversal when an approved resource is removed
const remove = (env, id, reason = "Wrong course") => removeApprovedResource(ctx(env, { user: A1, params: { id }, body: { reason } }));
{
  const { env, DB } = world();
  seedUser(DB, "inv", { name: "Inviter" });
  DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu','verified',?,?)").run(iso(5), iso(5));
  seedResource(DB, { id: "r1", status: "pending", uploader: "stu" });
  await approve(env, A1, "r1");
  check("removal setup: student has ₦150 pending and the inviter ₦50", stu(DB).p === 150 && stu(DB, "inv").p === 50);
  const r = await remove(env, "r1", "Wrong course, it's actually CSC 302");
  check("removal: succeeds and tells the moderator the rewards were taken back", r.status === 200 && r.body.success && /3 reward\(s\) paid for it were taken back automatically/.test(r.body.message), r.body.message);
  check("removal: the resource is moved to Rejected", one(DB, "SELECT status FROM resources WHERE id='r1'").status === "rejected");
  check("removal: the student's AND the inviter's pending rewards are returned to ₦0", stu(DB).p === 0 && stu(DB, "inv").p === 0);
  check("removal: every reward marked reversed, each with a negative reversal row carrying the reason", rows(DB, "type='reward'").every((x) => x.status === "reversed") && rows(DB, "type='reversal'").length === 3 && rows(DB, "type='reversal'").every((x) => /Wrong course/.test(x.reversal_reason)));
  check("removal: the inviter's 'earned from this friend' is wound back", one(DB, "SELECT earned FROM referrals WHERE id='rf'").earned === 0);
  const a = one(DB, "SELECT * FROM incentive_audit WHERE action='auto-reverse'");
  check("removal: written to the audit log with who, how many, how much and why", a && a.admin_name === "Admin One" && /reversed 3 reward\(s\) totalling ₦200/.test(a.detail) && /Wrong course/.test(a.detail), JSON.stringify(a));
}
{
  const { env, DB } = world(); seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  seedResource(DB, { id: "plain", status: "approved", uploader: "stu" });
  const r = await remove(env, "plain", "Poor quality");
  check("removal with no rewards: the response is EXACTLY what it always was", r.body.message === "Resource removed and moved to Rejected" && all(DB, "SELECT id FROM incentive_audit WHERE action='auto-reverse'").length === 0);
}
{
  const { env, DB } = world("off"); seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  seedResource(DB, { id: "late", status: "approved", uploader: "stu" });
  seedLedger(DB, { id: "L", user: "stu", amount: 100, status: "pending", resource: "late" });
  DB._raw.prepare("UPDATE users SET reward_pending=100 WHERE id='stu'").run();
  await remove(env, "late");
  check("removal: rewards already paid are still taken back even if the program has since been switched OFF", stu(DB).p === 0 && one(DB, "SELECT status s FROM reward_ledger WHERE id='L'").s === "reversed");
}
{
  // a cleared reward that was already SPENT: removal leaves a reward debt (negative balance), not an error
  const { env, DB } = world("live", R({ holdDays: 0 }));   // (no earlier approved upload, so the first-upload bonus applies)
  seedResource(DB, { id: "r1", status: "pending", uploader: "stu" });
  seedResource(DB, { id: "dl", status: "approved", uploader: "admin2", pages: 5 });   // costs ₦200
  seedResource(DB, { id: "dl2", status: "approved", uploader: "admin2", pages: 5 });  // costs ₦200
  await approve(env, A1, "r1");                                                      // ₦100 + ₦50 first bonus, spendable at once (holdDays 0)
  check("spent-then-removed setup: ₦150 spendable", stu(DB).b === 150 && stu(DB).p === 0);
  DB._raw.prepare("UPDATE users SET wallet_balance=50 WHERE id='stu'").run();
  const pay = await chargeForDownload(ctx(env, { user: { id: "stu" }, body: { resourceId: "dl" } }));
  check("spent-then-removed setup: the ₦200 download used the ₦150 reward + ₦50 cash", pay.status === 200 && pay.body.rewardsUsed === 150 && stu(DB).b === 0 && stu(DB).w === 0);
  const r = await remove(env, "r1", "Duplicate of another resource");
  check("removal after the reward was SPENT: succeeds and the balance goes to exactly ₦-150 (a debt)", r.status === 200 && stu(DB).b === -150, JSON.stringify(stu(DB)));
  check("removal: both rewards are reversed", rows(DB, "type='reward' AND resource_id='r1'").every((x) => x.status === "reversed"));
  const blocked = await chargeForDownload(ctx(env, { user: { id: "stu" }, body: { resourceId: "dl2" } }));
  check("…and the student can't download again until they top up (₦200 + ₦150 debt)", blocked.status === 402 && blocked.body.currentBalance === 0);
  DB._raw.prepare("UPDATE users SET wallet_balance=350 WHERE id='stu'").run();
  const ok = await chargeForDownload(ctx(env, { user: { id: "stu" }, body: { resourceId: "dl2" } }));
  check("…after topping up ₦350 the debt is settled and the download works, leaving ₦0 and no debt", ok.status === 200 && stu(DB).w === 0 && stu(DB).b === 0);
}
{
  const { env, DB } = world();
  seedBounty(DB, { id: "BNT", course: "CSC 301", reward: 120, max: 1, expires: iso(-5) });
  seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  seedResource(DB, { id: "r1", status: "pending", uploader: "stu", bountyId: "BNT" });
  await approve(env, A1, "r1", { rewardTier: "bounty" });
  check("request setup: fulfilled by this upload", one(DB, "SELECT paid, status FROM bounties WHERE id='BNT'").status === "fulfilled");
  await remove(env, "r1", "Not the right course");
  const b = one(DB, "SELECT paid, status FROM bounties WHERE id='BNT'");
  check("removal: the request REOPENS (its need is still unmet) and can be fulfilled again", b.paid === 0 && b.status === "open", JSON.stringify(b));
}
{
  const { env, DB } = world();
  seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  seedResource(DB, { id: "r1", status: "pending", uploader: "stu" });
  await approve(env, A1, "r1");
  const ledgerRow = rows(DB, "tier='standard'")[0];
  const rev = await reversePayout(ctx(env, { user: A1, params: { id: ledgerRow.id }, body: { reason: "Manual correction" } }));
  check("a bounty/referral/standard manual reversal still works through the same engine (regression)", rev.status === 200 && stu(DB).p === 0);
}
{
  const { env, DB } = world();
  seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  seedResource(DB, { id: "r1", status: "pending", uploader: "stu" });
  await approve(env, A1, "r1");
  DB._raw.exec("DROP TABLE reward_ledger");
  const r = await remove(env, "r1");
  check("removal NEVER fails because of the reward side: it succeeds with a warning to check Payouts", r.status === 200 && r.body.success && /could not be reversed automatically/.test(r.body.message) && one(DB, "SELECT status FROM resources WHERE id='r1'").status === "rejected", r.body.message);
}
{
  // reversing a REFERRAL / BOUNTY reward by hand also unwinds its side effects
  const { env, DB } = world(); seedUser(DB, "inv");
  DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf','inv','stu','verified',?,?)").run(iso(5), iso(5));
  seedBounty(DB, { id: "B2", course: "CSC 301", reward: 100, expires: iso(-5) });
  seedResource(DB, { id: "r1", status: "pending", uploader: "stu", bountyId: "B2" });
  await approve(env, A1, "r1", { rewardTier: "bounty" });
  const refRow = rows(DB, "tier='referral'")[0], bountyRow = rows(DB, "tier='bounty'")[0];
  await reversePayout(ctx(env, { user: A1, params: { id: refRow.id }, body: { reason: "Ring suspected" } }));
  await reversePayout(ctx(env, { user: A1, params: { id: bountyRow.id }, body: { reason: "Fake upload" } }));
  check("manual reversal: a referral reward reduces what the inviter 'earned' from that friend", one(DB, "SELECT earned FROM referrals WHERE id='rf'").earned === 0);
  check("manual reversal: a request reward reopens the request", one(DB, "SELECT paid, status FROM bounties WHERE id='B2'").status === "open" && one(DB, "SELECT paid FROM bounties WHERE id='B2'").paid === 0);
}

// ============================================================ admin transactions: rewards as virtual types
{
  const { env, DB } = world();
  seedUser(DB, "u1", { name: "Ada Obi", email: "ada@x.com" }); seedUser(DB, "u2", { name: "Bayo Lawal" });
  const tx = (id, user, type, amount, status, fromRewards = 0, at = iso(1)) =>
    DB._raw.prepare("INSERT INTO transactions (id,user_id,type,amount,status,from_rewards,description,created_at,updated_at) VALUES (?,?,?,?,?,?,'',?,?)").run(id, user, type, amount, status, fromRewards, at, at);
  tx("t1", "u1", "deposit", 5000, "successful"); tx("t2", "u1", "purchase", 380, "successful", 100); tx("t3", "u2", "purchase", 200, "successful"); tx("t4", "u2", "deposit", 999, "failed");
  seedLedger(DB, { id: "R1", user: "u1", amount: 100, status: "cleared" });
  seedLedger(DB, { id: "R2", user: "u1", amount: 50, status: "pending" });
  seedLedger(DB, { id: "R3", user: "u1", amount: 80, status: "reversed" });
  seedLedger(DB, { id: "R3r", user: "u1", amount: -80, status: "reversed", type: "reversal", reverses: "R3" });
  seedLedger(DB, { id: "R4", user: "u1", amount: 70, status: "shadow" });
  seedLedger(DB, { id: "R5", user: null, amount: 60, status: "cleared" });
  const list = async (query = {}) => (await getTransactions(ctx(env, { user: A1, query: { limit: "100", ...query } }))).body;

  let r = await list();
  const ids = r.transactions.map((t) => t.id).sort();
  check("transactions: wallet transactions AND reward rows appear in one list", ids.join() === ["R1", "R2", "R3", "R3r", "t1", "t2", "t3", "t4"].sort().join(), ids.join());
  check("transactions: shadow rows and rewards of deleted accounts are NOT shown", !ids.includes("R4") && !ids.includes("R5"));
  r = await list({ type: "reward" });
  check("transactions: filter 'reward' → the 3 reward credits (pending shows as pending, the rest successful)", r.transactions.length === 3 && r.transactions.find((t) => t.id === "R2").status === "pending" && r.transactions.find((t) => t.id === "R1").status === "successful");
  r = await list({ type: "reward_reversal" });
  check("transactions: filter 'reward_reversal' → one row, shown as a POSITIVE amount (the UI renders it as a debit)", r.transactions.length === 1 && r.transactions[0].amount === 80 && r.transactions[0].type === "reward_reversal");
  r = await list({ search: "Ada" });
  check("transactions: searching a student's name finds their reward rows too", r.transactions.some((t) => t.id === "R1") && r.transactions.every((t) => t.user === "Ada Obi"));
  r = await list({ status: "pending" });
  check("transactions: the status filter works on reward rows", r.transactions.length === 1 && r.transactions[0].id === "R2");
  r = await list({ limit: "3", page: "2" });
  check("transactions: pagination counts reward rows consistently", r.pagination.total === 8 && r.transactions.length === 3 && r.pagination.pages === 3);

  const s = (await getTransactionSummary(ctx(env, { user: A1 }))).body;
  check("summary: deposit VOLUME ignores rewards entirely (₦5,000 + the failed one is excluded)", s.totalDepositVolume === 5000, JSON.stringify(s));
  check("summary: 'spent' counts only the CASH part of purchases (₦380−₦100 + ₦200 = ₦480)", s.totalSpentVolume === 480, JSON.stringify(s));
}

// ============================================================ end to end: approve → clear → spend → totals
{
  const { env, DB } = world();
  seedResource(DB, { id: "old", status: "approved", uploader: "stu" });
  seedResource(DB, { id: "up", status: "pending", uploader: "stu" });
  seedResource(DB, { id: "dl", status: "approved", uploader: "admin2", pages: 5 });  // costs ₦200
  await approve(env, A1, "up");
  let s = (await getSummary(ctx(env, { user: A1 }))).body;
  check("e2e: after approval the Overview shows ₦100 paid this month and ₦100 owed to students", s.budget.paidThisMonth === 100 && s.outstanding === 100 && s.redeemed === 0, JSON.stringify(s.budget));
  let me = (await getMyIncentives(ctx(env, { user: { id: "stu" } }))).body;
  check("e2e: the student sees ₦100 PENDING (not spendable yet) and ₦0 spendable", me.balance.pending === 100 && me.balance.reward === 0 && me.weekEarned === 100);
  const early = await chargeForDownload(ctx(env, { user: { id: "stu" }, body: { resourceId: "dl" } }));
  check("e2e: during the hold period the reward can't be spent", early.status === 402 && early.body.currentBalance === 0);
  const cleared = await clearMaturedRewards(env, { now: new Date(Date.now() + 4 * 864e5) });
  check("e2e: after the hold period the hourly job makes it spendable", cleared.cleared === 1);
  me = (await getMyIncentives(ctx(env, { user: { id: "stu" } }))).body;
  check("e2e: the student now sees ₦100 spendable, ₦0 pending, and the ledger row is 'cleared'", me.balance.reward === 100 && me.balance.pending === 0 && me.ledger[0].status === "cleared");
  DB._raw.prepare("UPDATE users SET wallet_balance=150 WHERE id='stu'").run();
  const bal = await getBalance(ctx(env, { user: { id: "stu" } }));
  check("e2e: wallet balance shows cash + rewards (₦250)", bal.body.balance === 250);
  const buy = await chargeForDownload(ctx(env, { user: { id: "stu" }, body: { resourceId: "dl" } }));
  check("e2e: a ₦200 download uses the ₦100 reward first, then ₦100 cash", buy.status === 200 && buy.body.rewardsUsed === 100 && buy.body.fundedUsed === 100 && buy.body.newBalance === 50);
  s = (await getSummary(ctx(env, { user: A1 }))).body;
  check("e2e: Overview now shows ₦100 redeemed, and nothing owed (it was spent)", s.redeemed === 100 && s.outstanding === 0, JSON.stringify([s.redeemed, s.outstanding]));
  const t = (await getTransactionSummary(ctx(env, { user: A1 }))).body;
  check("e2e: cash revenue counts only the ₦100 of real money", t.totalSpentVolume === 100);
}

summary();
