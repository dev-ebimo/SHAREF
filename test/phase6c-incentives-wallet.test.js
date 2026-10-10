// Phase 6c (update package, Phase 3): paying for downloads with earned rewards (up to 100% of the price),
// the combined wallet balance, and the reward debt rule. Controller-level tests (real schema, SQLite).
// Run: node --experimental-sqlite test/phase6c-incentives-wallet.test.js
import { check, summary, freshEnv, ctx, one, all, n, iso, seedUser, seedResource, seedLedger } from "./incentiveTestLib.js";
import { getBalance, chargeForDownload } from "../src/controllers/walletController.js";
import { verifyDownloadToken } from "../src/utils/downloadToken.js";
import { reversePayout } from "../src/controllers/adminIncentiveController.js";
import { calculateResourceCost } from "../src/utils/pricing.js";

const PAGES = 14;                       // ₦200 + 9 pages × ₦20 = ₦380
const COST = calculateResourceCost(PAGES);
check("test setup: a 14-page resource costs ₦380", COST === 380);

function world(userOpts = {}) {
  const w = freshEnv();
  seedUser(w.DB, "uploader"); seedUser(w.DB, "admin1", { name: "Admin One", role: "admin" });
  seedUser(w.DB, "me", userOpts);
  seedResource(w.DB, { id: "r1", pages: PAGES, uploader: "uploader" });
  seedResource(w.DB, { id: "r2", pages: PAGES, uploader: "uploader" });
  return w;
}
const charge = (env, resourceId = "r1", userId = "me") => chargeForDownload(ctx(env, { user: { id: userId, role: "student" }, body: { resourceId } }));
const me = (DB) => one(DB, "SELECT wallet_balance w, reward_balance r, reward_pending p FROM users WHERE id='me'");
const tx = (DB) => all(DB, "SELECT * FROM transactions WHERE user_id='me' AND type='purchase'");
const nothingChanged = (DB, before) => {
  const m = me(DB);
  return m.w === before.w && m.r === before.r && m.p === before.p && tx(DB).length === 0
    && n(DB, "SELECT COUNT(*) AS n FROM download_logs") === 0 && one(DB, "SELECT downloads d FROM resources WHERE id='r1'").d === 0;
};

// ============================================================ balance endpoint
{
  const { env, DB } = world({ wallet: 700, rb: 160, rp: 100 });
  const r = await getBalance(ctx(env, { user: { id: "me" } }));
  check("balance: `balance` is cash + spendable rewards (₦860); pending rewards are NOT included", r.body.success && r.body.balance === 860, JSON.stringify(r.body));
  check("balance: the parts are exposed too (funded / reward / pending)", r.body.fundedBalance === 700 && r.body.rewardBalance === 160 && r.body.rewardPending === 100);
  const d = world({ wallet: 100, rb: -150 });
  check("balance: a reward DEBT (negative balance) is netted off the total", (await getBalance(ctx(d.env, { user: { id: "me" } }))).body.balance === -50);
  const plain = world({ wallet: 250 });
  const p = await getBalance(ctx(plain.env, { user: { id: "me" } }));
  check("balance: a student with no rewards sees exactly what they always saw", p.body.balance === 250 && p.body.fundedBalance === 250 && p.body.rewardBalance === 0);
}

// ============================================================ charging: no rewards = exactly the old behaviour
{
  const { env, DB } = world({ wallet: 1000 });
  const r = await charge(env);
  const t = tx(DB)[0];
  check("no rewards: charge works exactly as before (₦1000 → ₦620)", r.status === 200 && r.body.success && r.body.newBalance === 620 && me(DB).w === 620 && me(DB).r === 0);
  check("no rewards: purchase recorded at the full price, ₦0 from rewards", t.amount === 380 && t.from_rewards === 0 && t.status === "successful" && t.resource_id === "r1");
  check("no rewards: download counted and logged; stream link is bound to this user + resource", one(DB, "SELECT downloads d FROM resources WHERE id='r1'").d === 1 && n(DB, "SELECT COUNT(*) AS n FROM download_logs") === 1);
  const token = new URL(r.body.fileUrl).searchParams.get("token");
  const payload = await verifyDownloadToken(env, token);
  check("no rewards: the file link is issued for this user and resource", payload.userId === "me" && payload.resourceId === "r1");
  check("no rewards: response reports how it was paid", r.body.rewardsUsed === 0 && r.body.fundedUsed === 380);
}
{
  const { env, DB } = world({ wallet: 100 });
  const before = me(DB);
  const r = await charge(env);
  check("no rewards: not enough money → 402 with the SAME shape the UI already handles", r.status === 402 && r.body.insufficientBalance === true && r.body.required === 380 && r.body.currentBalance === 100 && r.body.success === false);
  check("no rewards: an insufficient attempt changes NOTHING (balances, transactions, logs, counters)", nothingChanged(DB, before));
}

// ============================================================ 100% of rewards can be used
{
  const { env, DB } = world({ wallet: 0, rb: 500 });
  const r = await charge(env);
  const t = tx(DB)[0];
  check("rewards cover the WHOLE price: ₦0 cash needed, ₦500 → ₦120", r.status === 200 && r.body.success && me(DB).w === 0 && me(DB).r === 120 && r.body.newBalance === 120, JSON.stringify([r.status, me(DB)]));
  check("rewards cover the whole price: recorded as ₦380 from rewards, ₦0 funded", t.amount === 380 && t.from_rewards === 380 && r.body.rewardsUsed === 380 && r.body.fundedUsed === 0);
}
{
  const { env, DB } = world({ wallet: 1000, rb: 100 });
  const r = await charge(env);
  check("rewards are spent FIRST, then cash (₦100 rewards + ₦280 cash)", me(DB).r === 0 && me(DB).w === 720 && tx(DB)[0].from_rewards === 100 && r.body.rewardsUsed === 100 && r.body.fundedUsed === 280 && r.body.newBalance === 720);
}
{
  const { env, DB } = world({ wallet: 100, rb: 100 });
  const before = me(DB);
  const r = await charge(env);
  check("rewards + cash together still short → 402; `currentBalance` is what they could spend (₦200)", r.status === 402 && r.body.currentBalance === 200 && r.body.required === 380);
  check("…and nothing at all changed", nothingChanged(DB, before));
}
{
  const { env, DB } = world({ wallet: 0, rb: 0, rp: 1000 });
  const before = me(DB);
  const r = await charge(env);
  check("PENDING rewards (still in their hold period) cannot be spent", r.status === 402 && r.body.currentBalance === 0 && nothingChanged(DB, before));
}
{
  const { env, DB } = world({ wallet: 380, rb: 380 });
  const r = await charge(env);
  check("exact money (rewards = price): spends the rewards, keeps the cash untouched", r.status === 200 && me(DB).r === 0 && me(DB).w === 380);
}

// ============================================================ frozen students
{
  const { env, DB } = world({ wallet: 100, rb: 500, frozen: 1 });
  const before = me(DB);
  const r = await charge(env);
  check("frozen: rewards can't be spent, so ₦100 cash isn't enough (and `currentBalance` says ₦100)", r.status === 402 && r.body.currentBalance === 100 && nothingChanged(DB, before));
  const rich = world({ wallet: 1000, rb: 500, frozen: 1 });
  const ok = await charge(rich.env);
  check("frozen: with enough cash the download works and the frozen rewards stay untouched", ok.status === 200 && me(rich.DB).w === 620 && me(rich.DB).r === 500 && tx(rich.DB)[0].from_rewards === 0);
}

// ============================================================ reward DEBT (a reward reversed after it was spent)
{
  const { env, DB } = world({ wallet: 480, rb: -100 });
  const r = await charge(env);
  check("debt: ₦100 owed is settled from cash first (₦380 + ₦100 = ₦480 needed)", r.status === 200 && me(DB).w === 0 && me(DB).r === 0 && tx(DB)[0].from_rewards === 0 && r.body.newBalance === 0, JSON.stringify(me(DB)));
  const short = world({ wallet: 479, rb: -100 });
  const before = me(short.DB);
  const s = await charge(short.env);
  check("debt: ₦1 short of (price + debt) → blocked, and the UI is told they have ₦379 against ₦380", s.status === 402 && s.body.required === 380 && s.body.currentBalance === 379 && nothingChanged(short.DB, before));
}

// ============================================================ re-downloads and races
{
  const { env, DB } = world({ wallet: 380 });
  await charge(env);
  const after1 = me(DB);
  seedLedger(DB, { user: "me", amount: 10, status: "cleared" }); DB._raw.prepare("UPDATE users SET rewards_frozen=1, reward_balance=-999 WHERE id='me'").run(); // frozen AND in debt
  const again = await charge(env);
  check("re-download of something already bought is FREE, even for a frozen student in debt", again.status === 200 && again.body.alreadyOwned === true && tx(DB).length === 1 && me(DB).w === after1.w);
}
{
  const { env, DB } = world({ wallet: 1000 });
  const [a, b] = await Promise.all([charge(env), charge(env)]);
  check("double-click: two simultaneous charges for the same file bill ONCE", tx(DB).length === 1 && me(DB).w === 620 && [a, b].filter((x) => x.body.alreadyOwned).length + [a, b].filter((x) => x.body.alreadyOwned === false).length === 2);
}
{
  const { env, DB } = world({ wallet: 0, rb: 400 });
  const [a, b] = await Promise.all([charge(env, "r1"), charge(env, "r2")]);
  const ok = [a, b].filter((x) => x.status === 200), fail = [a, b].filter((x) => x.status === 402);
  check("race: ₦400 of rewards can't pay for TWO ₦380 downloads at once — exactly one succeeds", ok.length === 1 && fail.length === 1 && me(DB).r === 20 && tx(DB).length === 1, JSON.stringify([a.status, b.status, me(DB)]));
}
{
  const { env, DB } = world({ wallet: 300, rb: 200 });
  const [a, b] = await Promise.all([charge(env, "r1"), charge(env, "r2")]);
  check("race: cash + rewards (₦500) pays for one ₦380 download, never two", [a, b].filter((x) => x.status === 200).length === 1 && me(DB).w + me(DB).r === 120 && me(DB).w >= 0);
}
{
  const { env, DB } = world({ wallet: 0, rb: 800 });
  await Promise.all([charge(env, "r1"), charge(env, "r2")]);
  check("race: ₦800 of rewards CAN pay for two ₦380 downloads (₦40 left)", tx(DB).length === 2 && me(DB).r === 40 && me(DB).w === 0);
}

// ============================================================ the full story: earn, spend, get reversed, owe, top up
{
  const { env, DB } = world({ wallet: 0, rb: 380 });
  const L = seedLedger(DB, { id: "REWARD1", user: "me", amount: 380, status: "cleared", label: "CSC 301 approved" });
  const spend = await charge(env, "r1");
  check("story: the student spends a ₦380 reward on a download", spend.status === 200 && me(DB).r === 0 && me(DB).w === 0);
  const rev = await reversePayout(ctx(env, { user: { id: "admin1", role: "admin" }, params: { id: L }, body: { reason: "Duplicate of an existing resource" } }));
  check("story: the reward is then reversed — the balance goes NEGATIVE (₦-380), nothing breaks", rev.status === 200 && me(DB).r === -380);
  const blocked = await charge(env, "r2");
  check("story: with no cash and a reward debt, the next download is blocked", blocked.status === 402 && blocked.body.currentBalance === 0);
  DB._raw.prepare("UPDATE users SET wallet_balance = 500 WHERE id='me'").run();
  const still = await charge(env, "r2");
  check("story: topping up ₦500 isn't enough (needs ₦380 + ₦380 debt); they are told they have ₦120", still.status === 402 && still.body.currentBalance === 120);
  DB._raw.prepare("UPDATE users SET wallet_balance = 760 WHERE id='me'").run();
  const done = await charge(env, "r2");
  check("story: after topping up ₦760 the debt is settled and the download works (₦0 left, no debt)", done.status === 200 && me(DB).w === 0 && me(DB).r === 0);
  check("story: a purchase made with rewards that were later reversed still shows the original facts", tx(DB).find((t) => t.resource_id === "r1").from_rewards === 380);
}

summary();
