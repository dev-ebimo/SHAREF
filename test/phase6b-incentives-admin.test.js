// Phase 6b (update package, Phase 2): admin /admin/incentives endpoints (summary, status, rules, payouts, reversal, flags, requests, audit)
// Controller-level tests: real controllers + real schema.sql in SQLite, with a fake request context.
// Run: node --experimental-sqlite test/phase6b-incentives-admin.test.js
import { check, summary, freshEnv, ctx, one, all, n, iso, setCfg, seedUser, seedResource, seedLedger, seedBounty, LIVE_RULES } from "./incentiveTestLib.js";
import * as A from "../src/controllers/adminIncentiveController.js";
import { reversalStatements } from "../src/services/rewardReversal.js";
import { startOfMonthInLagos, todayInLagosYmd } from "../src/utils/lagosDay.js";

const admin = { id: "admin1", role: "admin" };
const call = (fn, env, o = {}) => fn(ctx(env, { user: admin, ...o }));
const world = () => { const w = freshEnv(); seedUser(w.DB, "admin1", { name: "Admin One", role: "admin" }); seedUser(w.DB, "uploader"); return w; };
const monthStart = startOfMonthInLagos();
const prevMonth = new Date(monthStart.getTime() - 86400000).toISOString();
const auditRows = (DB) => all(DB, "SELECT * FROM incentive_audit ORDER BY created_at, rowid");

// ======================= SUMMARY
{
  const { env, DB } = world();
  let r = await call(A.getSummary, env);
  check("summary(off, empty DB): all zeros, no crash", r.body.success && r.body.status === "off" && r.body.budget.paidThisMonth === 0 && r.body.outstanding === 0 && r.body.flagsOpen === 0 && r.body.admins.length === 0);

  setCfg(DB, "live");
  ["u1", "u2", "stud"].forEach((id) => seedUser(DB, id));
  DB._raw.prepare("UPDATE users SET reward_balance=300, reward_pending=40 WHERE id='u1'").run();
  DB._raw.prepare("UPDATE users SET reward_balance=-80 WHERE id='u2'").run();
  seedLedger(DB, { user: "stud", amount: 100, status: "pending" });
  seedLedger(DB, { user: "stud", amount: 200, status: "cleared" });
  seedLedger(DB, { user: "stud", amount: 50, status: "reversed" });          // returned → not spend
  seedLedger(DB, { user: "stud", amount: 70, status: "shadow" });            // projection → not spend while live
  seedLedger(DB, { user: "stud", amount: 500, status: "cleared", createdAt: prevMonth }); // last month
  const tx = (id, type, amount, status, fromRewards = 0, at = iso(0)) =>
    DB._raw.prepare("INSERT INTO transactions (id,user_id,type,amount,status,from_rewards,description,created_at,updated_at) VALUES (?,?,?,?,?,?,'',?,?)").run(id, "stud", type, amount, status, fromRewards, at, at);
  tx("d1", "deposit", 5000, "successful"); tx("d2", "deposit", 999, "pending"); tx("d3", "deposit", 777, "successful", 0, prevMonth);
  tx("p1", "purchase", 380, "successful", 120); tx("p2", "purchase", 380, "failed", 50);
  for (let i = 0; i < 4; i++) seedResource(DB, { id: "ap" + i, status: "approved", reviewedBy: "admin1", reviewedAt: iso(0) });
  seedResource(DB, { id: "old", status: "approved", reviewedBy: "admin1", reviewedAt: prevMonth });
  DB._raw.prepare("INSERT INTO incentive_flags (id,user_id,status,created_at,updated_at) VALUES ('f1','stud','open',?,?),('f2','stud','open',?,?),('f3','stud','dismissed',?,?)").run(...Array(6).fill(iso(0)));

  r = (await call(A.getSummary, env)).body;
  check("summary(live): paid this month counts pending+cleared only (300), not reversed/shadow/last month", r.budget.paidThisMonth === 300 && r.budget.monthlyCap === 20000 && r.budget.shadow === false, JSON.stringify(r.budget));
  check("summary: owed to students = positive balances + pending (340); negative balance is not netted off", r.outstanding === 340, `outstanding=${r.outstanding}`);
  check("summary: redeemed = rewards used on SUCCESSFUL purchases this month (120)", r.redeemed === 120);
  check("summary: funded revenue = successful deposits this month only (5000)", r.fundedRevenue === 5000);
  check("summary: approved this month = 4 (last month's excluded)", r.approvedCount === 4);
  check("summary: open flags = 2 (dismissed excluded)", r.flagsOpen === 2);
  check("summary: config exposes ratioAlert + maxSinglePayout for the UI", r.config.ratioAlert === 40 && r.config.maxSinglePayout === 250);
  check("summary: no spurious alerts when budget and cap are set", r.alerts.length === 0);
  check("summary: moderator table row for the one admin", r.admins.length === 1 && r.admins[0].name === "Admin One" && r.admins[0].approvals === 4 && r.admins[0].paid === 300 && r.admins[0].highRare === 0 && r.admins[0].flagged === null, JSON.stringify(r.admins));

  setCfg(DB, "shadow");
  r = (await call(A.getSummary, env)).body;
  check("summary(shadow): projected shadow rows ARE counted (370) and flagged as shadow", r.budget.paidThisMonth === 370 && r.budget.shadow === true);
  setCfg(DB, "live", { ...LIVE_RULES, monthlyBudget: 0, weeklyCap: 0 });
  r = (await call(A.getSummary, env)).body;
  check("summary: live with no budget/cap raises alerts", r.alerts.some((a) => a.level === "bad" && /budget/i.test(a.text)) && r.alerts.some((a) => /weekly/i.test(a.text)));
  DB._raw.prepare("DELETE FROM incentive_config").run();
  check("summary: missing config row → treated as off, no crash", (await call(A.getSummary, env)).body.status === "off");
}

// moderator heuristics
{
  const { env, DB } = world();
  setCfg(DB, "live");
  ["adminA", "adminB", "adminC"].forEach((id, i) => seedUser(DB, id, { name: "Mod " + "ABC"[i], role: "admin" }));
  let k = 0;
  const mk = (admin, tier, amount, payee) => {
    const rid = "r" + ++k; seedUser(DB, "s" + k, { name: "S" + k });
    seedResource(DB, { id: rid, status: "approved", reviewedBy: admin, reviewedAt: iso(0) });
    seedLedger(DB, { user: payee || "s" + k, amount, tier, resource: rid, approver: admin });
  };
  for (let i = 0; i < 20; i++) mk("adminA", "standard", 100);                // A: 20 approvals × ₦100
  for (let i = 0; i < 3; i++) mk("adminB", i === 0 ? "high" : "rare", 500);  // B: 3 approvals × ₦500 → far above average
  seedUser(DB, "fav");
  for (let i = 0; i < 5; i++) mk("adminC", "standard", 100, "fav");          // C: pays one student five times
  const rows = Object.fromEntries((await call(A.getSummary, env)).body.admins.map((a) => [a.name, a]));
  check("heuristic: pays far above average → flagged", rows["Mod B"].flagged === "Pays far above average", JSON.stringify(rows["Mod B"]));
  check("heuristic: same student paid ≥5 times → flagged", rows["Mod C"].flagged === "Pays the same student repeatedly", JSON.stringify(rows["Mod C"]));
  check("heuristic: normal moderator not flagged", rows["Mod A"].flagged === null);
  check("heuristic: high/rare tiers counted per moderator", rows["Mod B"].highRare === 3 && rows["Mod A"].highRare === 0);
}

// ======================= STATUS
{
  const { env, DB } = world();
  const st = (body) => call(A.setStatus, env, { body });
  check("status: invalid value → 400", (await st({ status: "banana", reason: "because" })).status === 400);
  check("status: missing/short reason → 400", (await st({ status: "shadow", reason: "hi" })).status === 400 && (await st({ status: "shadow" })).status === 400);
  check("status: unparseable body → 400, not a crash", (await call(A.setStatus, env, {})).status === 400);
  let r = await st({ status: "live", reason: "launching now" });
  check("status: cannot go live with no monthly budget", r.status === 400 && /budget/i.test(r.body.message));
  check("status: same status → 400", (await st({ status: "off", reason: "no change" })).status === 400);
  r = await st({ status: "shadow", reason: "Learning the cost" });
  check("status: off → shadow works", r.status === 200 && one(DB, "SELECT status FROM incentive_config").status === "shadow");
  const a = auditRows(DB);
  check("status: audit row written with admin name, action and reason", a.length === 1 && a[0].admin_name === "Admin One" && a[0].action === "status" && /off → shadow/.test(a[0].detail) && /Learning the cost/.test(a[0].detail), JSON.stringify(a));
  setCfg(DB, "shadow");
  check("status: shadow → live OK once a budget exists", (await st({ status: "live", reason: "Go live" })).status === 200 && one(DB, "SELECT status FROM incentive_config").status === "live");
  DB._raw.prepare("DELETE FROM incentive_config").run();
  check("status: works even if the config row was never seeded (upsert)", (await st({ status: "shadow", reason: "reseed row" })).status === 200 && one(DB, "SELECT status FROM incentive_config").status === "shadow");
}

// ======================= CONFIG
{
  const { env, DB } = world();
  const put = (rules, reason = "tuning the rules") => call(A.updateConfig, env, { body: { rules, reason } });
  const good = () => JSON.parse(JSON.stringify(LIVE_RULES));
  let r = await call(A.getConfig, env);
  check("config GET: flat shape with status + defaults", r.body.success && r.body.status === "off" && r.body.monthlyBudget === 0 && r.body.rewards.pastQuestion === 0 && r.body.maxSinglePayout === 250);

  check("config PUT: reason required", (await call(A.updateConfig, env, { body: { rules: good() } })).status === 400);
  check("config PUT: rules object required", (await call(A.updateConfig, env, { body: { reason: "valid reason" } })).status === 400);
  let bad = good(); bad.weeklyCap = null;
  r = await put(bad);
  check("config PUT: cleared (null) field → 400 naming the field", r.status === 400 && /Weekly earning cap/.test(r.body.message), r.body.message);
  bad = good(); bad.monthlyBudget = -5; check("config PUT: negative → 400", (await put(bad)).status === 400);
  bad = good(); bad.rewards.pastQuestion = 99.5; check("config PUT: fractional naira → 400", (await put(bad)).status === 400);
  bad = good(); bad.holdDays = 31; check("config PUT: hold period > 30 days → 400", (await put(bad)).status === 400);
  bad = good(); delete bad.rewards.rare; check("config PUT: missing reward key → 400", (await put(bad)).status === 400);
  bad = good(); bad.monthlyBudget = "20000"; check("config PUT: numeric strings rejected (must be numbers)", (await put(bad)).status === 400);
  check("config PUT: rejected requests wrote nothing (config + audit untouched)", one(DB, "SELECT rules FROM incentive_config").rules === "{}" && auditRows(DB).length === 0);

  r = await put(good(), "Recommended launch values");
  check("config PUT: valid rules saved and returned flat", r.status === 200 && r.body.success && r.body.monthlyBudget === 20000 && r.body.rewards.pastQuestion === 100 && !r.body.clamped && !("maxRewardShare" in r.body));
  let a = auditRows(DB);
  check("config PUT: audit lists the changes AND the reason", a.length === 1 && a[0].action === "rules" && /monthlyBudget 0→20000/.test(a[0].detail) && /Recommended launch values/.test(a[0].detail), a[0]?.detail);
  const legacy = good(); legacy.maxRewardShare = 50;
  r = await put(legacy, "An older admin page still sends the removed share setting");
  check("config PUT: a legacy `maxRewardShare` from an older admin page is ignored, not an error, and never stored", r.status === 200 && r.body.unchanged === true && !("maxRewardShare" in r.body) && !/maxRewardShare/.test(one(DB, "SELECT rules FROM incentive_config").rules));
  r = await put(good(), "Saving the same values again");
  check("config PUT: identical values → success, flagged unchanged, NO audit noise", r.body.unchanged === true && auditRows(DB).length === 1);

  const over = good(); over.rewards.pastQuestion = 300; over.rewards.rare = 999;
  r = await put(over, "Trying to exceed the ceiling");
  check("config PUT: tiers above the largest single payout are CAPPED to it (250)", r.status === 200 && r.body.rewards.pastQuestion === 250 && r.body.rewards.rare === 250 && r.body.clamped.length === 2, JSON.stringify(r.body.clamped));
  check("config PUT: capping is recorded in the audit log", /Capped at the largest single payout/.test(auditRows(DB).at(-1).detail));
  check("config GET: persisted values are what was clamped", (await call(A.getConfig, env)).body.rewards.rare === 250);
}

// ======================= PAYOUTS
{
  const { env, DB } = world();
  seedUser(DB, "ada", { name: "Ada Obi" }); seedUser(DB, "bayo", { name: "Bayo Lawal" });
  for (let i = 0; i < 45; i++) seedLedger(DB, { user: i % 2 ? "ada" : "bayo", amount: 100, status: i < 5 ? "pending" : "cleared", label: i === 7 ? "100% bonus_special" : `CSC ${i}`, createdAt: iso(i / 100) });
  seedLedger(DB, { user: "ada", amount: -100, status: "reversed", type: "reversal", label: "Reversed: x" });
  seedLedger(DB, { user: null, amount: 60, status: "cleared", label: "orphan reward" });
  let r = (await call(A.getPayouts, env, { query: {} })).body;
  check("payouts: 20 per page; reversal-type rows excluded from the list", r.payouts.length === 20 && r.pagination.total === 46 && r.pagination.pages === 3 && !r.payouts.some((p) => p.amount < 0));
  check("payouts: row shape id/date/student/label/tier/amount/status/approvedBy", ["id", "date", "student", "label", "tier", "amount", "status", "approvedBy"].every((k) => k in r.payouts[0]) && r.payouts[0].approvedBy === "Admin One");
  r = (await call(A.getPayouts, env, { query: { page: "3" } })).body;
  check("payouts: last page has the remainder (6)", r.payouts.length === 6 && r.pagination.page === 3);
  r = (await call(A.getPayouts, env, { query: { status: "pending" } })).body;
  check("payouts: status filter", r.pagination.total === 5 && r.payouts.every((p) => p.status === "pending"));
  r = (await call(A.getPayouts, env, { query: { q: "ada" } })).body;
  check("payouts: search by student name", r.payouts.length > 0 && r.payouts.every((p) => p.student === "Ada Obi"));
  r = (await call(A.getPayouts, env, { query: { q: "orphan" } })).body;
  check("payouts: reward of a deleted account shows 'Deleted account'", r.payouts.length === 1 && r.payouts[0].student === "Deleted account");
  r = (await call(A.getPayouts, env, { query: { q: "%" } })).body;
  check("payouts: '%' in search is literal (matches only the label containing it, not everything)", r.pagination.total === 1 && /100%/.test(r.payouts[0].label), JSON.stringify(r.pagination));
  r = (await call(A.getPayouts, env, { query: { page: "-4", status: "garbage" } })).body;
  check("payouts: junk page/status handled gracefully", r.success && r.pagination.page === 1 && r.pagination.total === 46);
}

// ======================= REVERSAL
{
  const { env, DB } = world();
  seedUser(DB, "stud", { name: "Stud Ent", rb: 200, rp: 100 });
  const P = seedLedger(DB, { id: "P", user: "stud", amount: 100, status: "pending", label: "CSC 301", tier: "standard" });
  const C = seedLedger(DB, { id: "C", user: "stud", amount: 150, status: "cleared", label: "Notes", tier: "high" });
  const bal = () => one(DB, "SELECT reward_balance rb, reward_pending rp FROM users WHERE id='stud'");
  const rev = (id, reason = "Duplicate upload found") => call(A.reversePayout, env, { params: { id }, body: { reason } });

  check("reverse: reason required (>=5 chars)", (await rev(P, "no")).status === 400 && bal().rp === 100);
  check("reverse: unknown id → 404", (await rev("nope")).status === 404);
  let r = await rev(P);
  check("reverse(pending): success; pending balance reduced, spendable untouched", r.status === 200 && bal().rp === 0 && bal().rb === 200, JSON.stringify(bal()));
  const orig = one(DB, "SELECT * FROM reward_ledger WHERE id='P'");
  check("reverse: original marked reversed with who/when/why", orig.status === "reversed" && orig.reversed_by === "admin1" && orig.reversal_reason === "Duplicate upload found" && !!orig.reversed_at);
  const negRow = one(DB, "SELECT * FROM reward_ledger WHERE reverses_id='P'");
  check("reverse: a separate NEGATIVE reversal row is written (history never rewritten)", negRow && negRow.type === "reversal" && negRow.amount === -100 && negRow.user_id === "stud" && negRow.status === "reversed" && /Reversed: CSC 301/.test(negRow.label));
  check("reverse: audit entry names admin, student, amount and reason", /Stud Ent: took back ₦100/.test(auditRows(DB).at(-1).detail) && /Duplicate upload/.test(auditRows(DB).at(-1).detail) && auditRows(DB).at(-1).action === "reverse");

  r = await rev(P);
  check("reverse: second attempt → 409 and NOTHING changes (no double deduction, one reversal row)", r.status === 409 && bal().rp === 0 && n(DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE reverses_id='P'") === 1);

  r = await rev(C);
  check("reverse(cleared): spendable balance reduced (200→50)", r.status === 200 && bal().rb === 50 && bal().rp === 0);

  // student already spent it: balance may go negative (blocks future downloads), not an error
  const C2 = seedLedger(DB, { user: "stud", amount: 300, status: "cleared" });
  r = await rev(C2);
  check("reverse: if the reward was already spent the balance goes NEGATIVE (allowed by design)", r.status === 200 && bal().rb === -250, JSON.stringify(bal()));

  // shadow + deleted account
  const S = seedLedger(DB, { user: "stud", amount: 80, status: "shadow" });
  r = await rev(S);
  check("reverse: shadow rows can't be reversed (no money ever moved)", r.status === 400 && one(DB, "SELECT status FROM reward_ledger WHERE id=?", S).status === "shadow");
  const D = seedLedger(DB, { user: null, amount: 80, status: "cleared" });
  r = await rev(D);
  check("reverse: deleted student's reward → 409, untouched", r.status === 409 && one(DB, "SELECT status FROM reward_ledger WHERE id=?", D).status === "cleared");

  // the real race: two moderators both read the row while it was still 'pending'
  seedUser(DB, "racer", { rp: 100 });
  seedLedger(DB, { id: "R", user: "racer", amount: 100, status: "pending", label: "race" });
  const snapshot = one(DB, "SELECT * FROM reward_ledger WHERE id='R'");
  const opts = (ts, who) => ({ adminId: "admin1", adminName: who, reason: "race test", ts, audit: { action: "reverse", detail: "race " + who } });
  await DB.batch(reversalStatements(DB, snapshot, opts(new Date().toISOString(), "first")));
  let threw = false;
  try { await DB.batch(reversalStatements(DB, snapshot, opts(new Date(Date.now() + 7).toISOString(), "second"))); } catch { threw = true; }
  check("race: second moderator's stale-snapshot batch is a harmless no-op (no throw)", threw === false);
  check("race: balance deducted exactly once; exactly one reversal row; exactly one audit row", one(DB, "SELECT reward_pending p FROM users WHERE id='racer'").p === 0 && n(DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE reverses_id='R'") === 1 && n(DB, "SELECT COUNT(*) AS n FROM incentive_audit WHERE detail LIKE 'race %'") === 1);
  // and the hard backstop independent of the guards
  let dupBlocked = false;
  try { DB._raw.prepare("INSERT INTO reward_ledger (id,user_id,type,amount,status,reverses_id,created_at) VALUES ('dup','racer','reversal',-100,'reversed','R',?)").run(iso(0)); } catch { dupBlocked = true; }
  check("backstop: unique index forbids a second reversal row for the same reward", dupBlocked);
}

// ======================= FLAGS
{
  const { env, DB } = world();
  seedUser(DB, "bad", { name: "Bad Actor", rb: 400, rp: 600 }); seedUser(DB, "meh", { name: "Mild Case" }); seedUser(DB, "fz", { name: "Freeze Me" });
  const flag = (id, user, signals, exposure = 500, status = "open") =>
    DB._raw.prepare("INSERT INTO incentive_flags (id,user_id,signals,exposure,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id, user, signals, exposure, status, iso(0), iso(0));
  flag("F1", "bad", JSON.stringify(["5 uploads rejected this week", "Shares a connection with 3 accounts"]), 1000);
  flag("F2", "meh", "{corrupt", 50); flag("F3", "fz", "[]", 10); flag("F4", "meh", "[]", 5, "dismissed");
  let r = (await call(A.getFlags, env, { query: {} })).body;
  check("flags: default lists OPEN flags only, with student name + parsed signals", r.flags.length === 3 && !r.flags.some((f) => f.id === "F4") && r.flags.find((f) => f.id === "F1").signals.length === 2 && r.flags.find((f) => f.id === "F1").student === "Bad Actor");
  check("flags: corrupt signals JSON degrades to an empty list (no 500)", r.flags.find((f) => f.id === "F2").signals.length === 0);
  check("flags: status filter works", (await call(A.getFlags, env, { query: { status: "dismissed" } })).body.flags.length === 1);
  check("flag-count: open flags only", (await call(A.getFlagCount, env)).body.flagsOpen === 3);

  const res = (id, action, note = "Reviewed the evidence") => call(A.resolveFlag, env, { params: { id }, body: { action, note } });
  check("resolve: invalid action → 400", (await res("F1", "nuke")).status === 400);
  check("resolve: note (reason) required → 400", (await res("F1", "dismiss", "x")).status === 400);
  check("resolve: unknown flag → 404", (await res("zzz", "dismiss")).status === 404);

  let rr = await res("F2", "dismiss");
  check("resolve(dismiss): flag closed, audited, user untouched", rr.status === 200 && one(DB, "SELECT status FROM incentive_flags WHERE id='F2'").status === "dismissed" && one(DB, "SELECT rewards_frozen f FROM users WHERE id='meh'").f === 0 && auditRows(DB).at(-1).action === "flag.dismiss");
  rr = await res("F3", "freeze");
  check("resolve(freeze): student's rewards frozen + flag 'frozen' + audited", rr.status === 200 && one(DB, "SELECT rewards_frozen f FROM users WHERE id='fz'").f === 1 && one(DB, "SELECT status FROM incentive_flags WHERE id='F3'").status === "frozen" && auditRows(DB).at(-1).action === "flag.freeze");
  rr = await res("F3", "dismiss");
  check("resolve: an already-resolved flag → 404 (can't be resolved twice)", rr.status === 404);

  // reverse_all across more rows than one chunk (15) to exercise chunking
  for (let i = 0; i < 12; i++) seedLedger(DB, { user: "bad", amount: 50, status: "pending", resource: null, label: "p" + i });
  for (let i = 0; i < 8; i++) seedLedger(DB, { user: "bad", amount: 50, status: "cleared", label: "c" + i });
  seedLedger(DB, { id: "BAD-SHADOW", user: "bad", amount: 77, status: "shadow" });
  seedLedger(DB, { id: "BAD-ALREADY", user: "bad", amount: 33, status: "reversed" });
  rr = await res("F1", "reverse_all", "Confirmed ring of fake accounts");
  const bad = one(DB, "SELECT reward_balance rb, reward_pending rp FROM users WHERE id='bad'");
  check("resolve(reverse_all): all 20 live rewards reversed across chunks; message reports count + total", rr.status === 200 && /Reversed 20 reward\(s\) totalling/.test(rr.body.message) && /1,000/.test(rr.body.message), rr.body.message);
  check("resolve(reverse_all): pending 600→0 and spendable 400→0 exactly", bad.rp === 0 && bad.rb === 0, JSON.stringify(bad));
  check("resolve(reverse_all): shadow + already-reversed rows left alone; 20 negative rows written", one(DB, "SELECT status FROM reward_ledger WHERE id='BAD-SHADOW'").status === "shadow" && n(DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE user_id='bad' AND type='reversal'") === 20);
  check("resolve(reverse_all): flag 'reversed' + ONE summary audit row", one(DB, "SELECT status FROM incentive_flags WHERE id='F1'").status === "reversed" && /reversed 20 reward/.test(auditRows(DB).at(-1).detail) && auditRows(DB).filter((a) => a.action === "flag.reverse_all").length === 1);
  rr = await call(A.resolveFlag, env, { params: { id: "F1" }, body: { action: "reverse_all", reason: "using reason field" } });
  check("resolve: a second reverse_all on a closed flag is rejected", rr.status === 404);
  flag("F5", "meh", "[]");
  rr = await call(A.resolveFlag, env, { params: { id: "F5" }, body: { action: "dismiss", reason: "accepts `reason` as a fallback" } });
  check("resolve: accepts `reason` as a fallback for `note`", rr.status === 200);
  flag("F6", "meh", "[]");
  rr = await res("F6", "reverse_all", "nothing to take back");
  check("resolve(reverse_all) with nothing to reverse still closes the flag cleanly", rr.status === 200 && /Reversed 0/.test(rr.body.message) && one(DB, "SELECT status FROM incentive_flags WHERE id='F6'").status === "reversed");
}

// ======================= REQUESTS
{
  const { env, DB } = world();
  setCfg(DB, "live");
  const tomorrow = new Date(Date.parse(todayInLagosYmd()) + 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(todayInLagosYmd()) - 86400000).toISOString().slice(0, 10);
  const farOff = new Date(Date.parse(todayInLagosYmd()) + 400 * 86400000).toISOString().slice(0, 10);
  const ok = () => ({ course: "csc 305", type: "Past Questions", level: "300 Level", reward: 100, maxPayouts: 2, expiresAt: tomorrow });
  const mk = (over = {}) => call(A.createRequest, env, { body: { ...ok(), ...over } });

  let r = await mk();
  check("request: valid → created (no reason needed: the form has none)", r.status === 200 && r.body.success && !!r.body.id);
  const row = one(DB, "SELECT * FROM bounties WHERE id=?", r.body.id);
  check("request: course normalised (upper-case) + matching key; max payouts and reward stored", row.course === "CSC 305" && row.course_key === "CSC305" && row.reward === 100 && row.max_payouts === 2 && row.status === "open" && row.created_by === "admin1");
  check("request: closes at END of the chosen Lagos day", row.expires_at > new Date().toISOString() && /T22:59:59\.999Z$/.test(row.expires_at), row.expires_at);
  check("request: audit entry written", auditRows(DB).at(-1).action === "request.create" && /CSC 305 Past Questions/.test(auditRows(DB).at(-1).detail));

  check("request: duplicate open request → 409", (await mk({ course: "CSC-305" })).status === 409);
  check("request: bad course → 400", (await mk({ course: "!!" })).status === 400 && (await mk({ course: "" })).status === 400);
  check("request: bad type / level → 400", (await mk({ type: "Gossip" })).status === 400 && (await mk({ level: "900 Level" })).status === 400);
  check("request: reward above the largest single payout (250) → 400; fractional/zero → 400", (await mk({ course: "AAA 1", reward: 251 })).status === 400 && (await mk({ course: "AAA 2", reward: 0 })).status === 400 && (await mk({ course: "AAA 3", reward: 10.5 })).status === 400);
  check("request: maxPayouts must be 1–3", (await mk({ course: "BBB 1", maxPayouts: 0 })).status === 400 && (await mk({ course: "BBB 2", maxPayouts: 4 })).status === 400);
  check("request: closing date must be a real date, not past, within a year", (await mk({ course: "CCC 1", expiresAt: "2026-02-31" })).status === 400 && (await mk({ course: "CCC 2", expiresAt: yesterday })).status === 400 && (await mk({ course: "CCC 3", expiresAt: farOff })).status === 400 && (await mk({ course: "CCC 4", expiresAt: "soon" })).status === 400);

  const list = (await call(A.listRequests, env)).body.requests;
  check("request list: shape id/course/type/level/reward/paid/maxPayouts/expiresAt/status", ["id", "course", "type", "level", "reward", "paid", "maxPayouts", "expiresAt", "status"].every((k) => k in list[0]));
  seedBounty(DB, { id: "stale", course: "OLD 101", expires: iso(1) });
  check("request list: lapsed open request is reported as 'expired'", (await call(A.listRequests, env)).body.requests.find((b) => b.id === "stale").status === "expired");

  const cl = (id, reason = "No longer needed") => call(A.closeRequest, env, { params: { id }, body: { reason } });
  check("close: reason required; unknown → 404", (await cl(r.body.id, "x")).status === 400 && (await cl("nope")).status === 404);
  check("close: closes it, audits it", (await cl(r.body.id)).status === 200 && one(DB, "SELECT status FROM bounties WHERE id=?", r.body.id).status === "closed" && auditRows(DB).at(-1).action === "request.close");
  check("close: already closed → 409", (await cl(r.body.id)).status === 409);
  check("request: after closing, the same course can be requested again", (await mk()).status === 200);
}

// ======================= AUDIT
{
  const { env, DB } = world();
  for (let i = 0; i < 105; i++) DB._raw.prepare("INSERT INTO incentive_audit (id,admin_name,action,detail,created_at) VALUES (?,?,?,?,?)").run("a" + i, "Admin One", "rules", "entry " + i, iso(i / 1000));
  const e = (await call(A.getAudit, env)).body.entries;
  check("audit: newest first, capped at 100, shape date/admin/action/detail", e.length === 100 && e[0].detail === "entry 0" && e[1].detail === "entry 1" && ["date", "admin", "action", "detail"].every((k) => k in e[0]));
  let blocked = 0;
  try { DB._raw.prepare("UPDATE incentive_audit SET detail='tampered'").run(); } catch { blocked++; }
  try { DB._raw.prepare("DELETE FROM incentive_audit").run(); } catch { blocked++; }
  check("audit: log is append-only (UPDATE and DELETE both refused)", blocked === 2);
}

summary();
