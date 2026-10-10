// Phase 6b (update package, Phase 2): student-facing /incentives endpoints and program-off isolation
// Controller-level tests: real controllers + real schema.sql in SQLite, with a fake request context.
// Run: node --experimental-sqlite test/phase6b-incentives-student.test.js
import { check, summary, freshEnv, ctx, one, all, n, iso, setCfg, seedUser, seedResource, seedLedger, seedBounty, LIVE_RULES } from "./incentiveTestLib.js";
import { getIncentiveStatus, getMyIncentives, getOpenRequests, getLeaderboard } from "../src/controllers/incentiveController.js";
import { startOfWeekInLagos } from "../src/utils/lagosDay.js";
import { ensureReferralCode } from "../src/services/referralService.js";

const as = (id) => ({ id, role: "student" });

// ================= isolation: 'off' (the default) and 'shadow' must look like the feature doesn't exist
{
  const { env, DB } = freshEnv();
  seedUser(DB, "me");
  check("fresh DB defaults to status off (seeded config row)", one(DB, "SELECT status FROM incentive_config").status === "off");

  let r = await getIncentiveStatus(ctx(env, { user: as("me") }));
  check("off: config answers {enabled:false,status:'off'} and leaks no rules", r.status === 200 && r.body.enabled === false && r.body.status === "off" && Object.keys(r.body).sort().join() === "enabled,status,success");
  for (const [name, fn] of [["me", getMyIncentives], ["requests", getOpenRequests], ["leaderboard", getLeaderboard]]) {
    r = await fn(ctx(env, { user: as("me") }));
    check(`off: /${name} → 403 'not open yet'`, r.status === 403 && r.body.success === false);
  }
  check("off: no referral code was created as a side effect", one(DB, "SELECT referral_code FROM users WHERE id='me'").referral_code === null);

  setCfg(DB, "shadow");
  r = await getIncentiveStatus(ctx(env, { user: as("me") }));
  check("shadow: students still see enabled:false (shadow is invisible)", r.body.enabled === false && r.body.status === "off");
  r = await getMyIncentives(ctx(env, { user: as("me") }));
  check("shadow: /me → 403", r.status === 403);

  DB._raw.prepare("DELETE FROM incentive_config").run();
  r = await getIncentiveStatus(ctx(env, { user: as("me") }));
  check("missing config row behaves like off (no crash)", r.status === 200 && r.body.enabled === false);
  DB._raw.prepare("INSERT INTO incentive_config (id,status,rules) VALUES (1,'live','{not json')").run();
  r = await getIncentiveStatus(ctx(env, { user: as("me") }));
  check("corrupt rules JSON → safe inert defaults, not a 500", r.status === 200 && r.body.enabled === true && r.body.rewards.pastQuestion === 0 && r.body.weeklyCap === 0);
}

// ================= live: config + me
{
  const { env, DB } = freshEnv();
  for (const id of ["me", "a", "b", "uploader"]) seedUser(DB, id);
  DB._raw.prepare("UPDATE users SET full_name='Peace Adeyemi' WHERE id='a'").run();
  DB._raw.prepare("UPDATE users SET full_name='Tunde Bakare' WHERE id='b'").run();
  DB._raw.prepare("UPDATE users SET wallet_balance=700, reward_balance=160, reward_pending=100 WHERE id='me'").run();
  setCfg(DB, "live");

  let r = await getIncentiveStatus(ctx(env, { user: as("me") }));
  check("live: config exposes only student-relevant fields", r.body.enabled && r.body.status === "live" && r.body.holdDays === 3 && r.body.weeklyCap === 300
    && Object.keys(r.body.rewards).sort().join() === "firstApproval,lectureNote,pastQuestion,referralFirstApproval" && r.body.rewards.pastQuestion === 100, JSON.stringify(r.body));
  check("live: there is no share cap any more (rewards can cover a whole download)", !("maxRewardShare" in r.body));
  check("live: internal limits (monthly budget, tiers high/rare, admin limit) are NOT exposed", !("monthlyBudget" in r.body) && !("high" in r.body.rewards) && !("adminDailyLimit" in r.body));

  seedLedger(DB, { user: "me", amount: 100, status: "pending", label: "CSC 301 approved", createdAt: iso(0) });
  seedLedger(DB, { user: "me", amount: 60, status: "cleared", createdAt: iso(2) });
  seedLedger(DB, { user: "me", amount: 50, status: "reversed", createdAt: iso(1) });          // reversed: not counted toward the cap
  seedLedger(DB, { user: "me", amount: 40, status: "cleared", createdAt: iso(10) });          // outside the rolling 7 days
  seedLedger(DB, { user: "me", amount: 999, status: "shadow", createdAt: iso(0) });           // admin what-if data: must stay hidden
  seedLedger(DB, { user: "me", amount: -50, status: "reversed", type: "reversal", label: "Reversed: x", createdAt: iso(0) });
  DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,earned,created_at,updated_at) VALUES ('r1','me','a','verified',50,?,?),('r2','me','b','signed_up',0,?,?)").run(iso(3), iso(3), iso(2), iso(2));

  r = await getMyIncentives(ctx(env, { user: as("me") }));
  const m = r.body;
  check("me: balances map to funded/reward/pending", m.balance.funded === 700 && m.balance.reward === 160 && m.balance.pending === 100, JSON.stringify(m.balance));
  check("me: weekEarned = rolling 7 days of pending+cleared only (160), weekCap from rules", m.weekEarned === 160 && m.weekCap === 300, `earned=${m.weekEarned}`);
  check("me: ledger hides the shadow row (5 of 6 rows shown)", m.ledger.length === 5 && !m.ledger.some((l) => l.amount === 999));
  check("me: reversal appears as a negative 'reversed' row", m.ledger.some((l) => l.amount === -50 && l.status === "reversed"));
  check("me: ledger is ordered newest first", m.ledger.every((l, i) => i === 0 || m.ledger[i - 1].date >= l.date));
  check("me: ledger rows have id/date/label/amount/status", ["id", "date", "label", "amount", "status"].every((k) => m.ledger[0][k] !== undefined));
  check("me: referrals expose FIRST NAME only (no surnames)", m.referrals.map((x) => x.name).sort().join() === "Peace,Tunde" && !JSON.stringify(m.referrals).includes("Adeyemi") && !JSON.stringify(m.referrals).includes("Bakare"));
  check("me: referral statuses/earned carried through", m.referrals.find((x) => x.name === "Peace").status === "verified" && m.referrals.find((x) => x.name === "Peace").earned === 50);
  check("me: frozen false by default", m.frozen === false);
  check("me: referral code is 8 unambiguous chars and persisted", /^[A-HJ-NP-Z2-9]{8}$/.test(m.referralCode) && one(DB, "SELECT referral_code c FROM users WHERE id='me'").c === m.referralCode);
  const again = await getMyIncentives(ctx(env, { user: as("me") }));
  check("me: referral code is stable across calls", again.body.referralCode === m.referralCode);

  DB._raw.prepare("UPDATE users SET rewards_frozen=1 WHERE id='me'").run();
  check("me: frozen reflected", (await getMyIncentives(ctx(env, { user: as("me") }))).body.frozen === true);

  // 35 ledger rows → capped at 30 (newest first)
  seedUser(DB, "many");
  for (let i = 0; i < 35; i++) seedLedger(DB, { user: "many", amount: i + 1, createdAt: iso(i / 100) });
  const many = (await getMyIncentives(ctx(env, { user: as("many") }))).body;
  check("me: ledger capped at 30 rows, newest first", many.ledger.length === 30 && many.ledger[0].amount === 1);

  // codes: stable under concurrency, unique across users
  seedUser(DB, "c1");
  const codes = await Promise.all([1, 2, 3, 4, 5].map(() => ensureReferralCode(DB, "c1")));
  check("referral code: 5 concurrent first calls all return the SAME code", new Set(codes).size === 1 && codes[0]);
  const ids = Array.from({ length: 40 }, (_, i) => "bulk" + i);
  ids.forEach((id) => seedUser(DB, id));
  const bulk = await Promise.all(ids.map((id) => ensureReferralCode(DB, id)));
  check("referral code: 40 users get 40 distinct codes", new Set(bulk).size === 40);
  check("referral code: unknown user → null (no crash)", (await ensureReferralCode(DB, "ghost")) === null);

  // paused still serves students
  setCfg(DB, "paused");
  r = await getIncentiveStatus(ctx(env, { user: as("me") }));
  check("paused: config enabled with status 'paused'", r.body.enabled === true && r.body.status === "paused");
  check("paused: /me still works (students keep seeing their balance)", (await getMyIncentives(ctx(env, { user: as("me") }))).status === 200);
}

// ================= requests ("Wanted")
{
  const { env, DB } = freshEnv();
  seedUser(DB, "me"); setCfg(DB, "live");
  seedBounty(DB, { id: "open-lo", reward: 60, course: "MTH 101" });
  seedBounty(DB, { id: "open-hi", reward: 200, course: "CSC 305" });
  seedBounty(DB, { id: "expired", expires: iso(1) });
  seedBounty(DB, { id: "closed", status: "closed" });
  seedBounty(DB, { id: "full", max: 2, paid: 2 });
  seedBounty(DB, { id: "partly", max: 3, paid: 2, reward: 80, course: "PHY 102" });
  const r = await getOpenRequests(ctx(env, { user: as("me") }));
  check("requests: only open, unexpired, not-fully-paid; biggest reward first", r.body.requests.map((x) => x.id).join() === "open-hi,partly,open-lo", r.body.requests.map((x) => x.id).join());
  check("requests: item shape id/course/type/level/reward/note", ["id", "course", "type", "level", "reward", "note"].every((k) => r.body.requests[0][k] !== undefined));
}

// ================= leaderboard
{
  const { env, DB } = freshEnv();
  seedUser(DB, "uploader");
  const users = { me: "Ngozi Eze", a: "Chidinma Okafor", b: "Madonna", c: "Femi Adebayo", d: "Banned Person" };
  for (const [id, name] of Object.entries(users)) seedUser(DB, id, { name, status: id === "d" ? "suspended" : "active" });
  setCfg(DB, "live");
  const weekStart = startOfWeekInLagos();
  const thisWeek = (mins) => new Date(Math.max(weekStart.getTime() + 1000, Date.now() - mins * 60000)).toISOString();
  let k = 0;
  const approve = (uid, when) => seedResource(DB, { id: "r" + ++k, uploader: uid, status: "approved", reviewedAt: when });
  [thisWeek(50), thisWeek(40), thisWeek(30)].forEach((w) => approve("a", w));          // a: 3 (earliest)
  [thisWeek(20), thisWeek(15), thisWeek(10)].forEach((w) => approve("c", w));          // c: 3 (later → ranks below a)
  [thisWeek(9), thisWeek(8)].forEach((w) => approve("b", w));                          // b: 2
  approve("me", thisWeek(5));                                                          // me: 1
  approve("c", new Date(weekStart.getTime() - 3600e3).toISOString());                  // last week: not counted
  for (let i = 0; i < 5; i++) approve("d", thisWeek(3));                               // suspended: excluded
  seedResource(DB, { id: "pend", uploader: "me", status: "pending" });                 // pending: not counted

  const r = await getLeaderboard(ctx(env, { user: as("me") }));
  const L = r.body.leaders;
  check("leaderboard: ranks by approved this week; ties broken by who got there first (a before c)", L.map((x) => x.name).join("|") === "Chidinma O.|Femi A.|Madonna|Ngozi E.", L.map((x) => x.name).join("|"));
  check("leaderboard: counts are this-week only (last week's, pending, suspended excluded)", L.map((x) => x.approved).join() === "3,3,2,1");
  check("leaderboard: names are 'First L.' (no surname exposed), single names intact", !JSON.stringify(L).includes("Okafor") && !JSON.stringify(L).includes("Adebayo") && L.some((x) => x.name === "Madonna"));
  check("leaderboard: isMe flags only the caller; rank is 1-based", L.filter((x) => x.isMe).length === 1 && L.find((x) => x.isMe).name === "Ngozi E." && L[0].rank === 1);
  check("leaderboard: nothing paid is needed to appear (works with an empty ledger)", n(DB, "SELECT COUNT(*) AS n FROM reward_ledger") === 0);

  // limit 10
  for (let i = 0; i < 14; i++) { seedUser(DB, "x" + i, { name: `Xavier Z${i}` }); approve("x" + i, thisWeek(1)); }
  check("leaderboard: capped at 10 entries", (await getLeaderboard(ctx(env, { user: as("me") }))).body.leaders.length === 10);
}

summary();
