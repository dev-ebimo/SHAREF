import { generateId } from "../utils/id.js";
import { startOfMonthInLagos, startOfTodayInLagos } from "../utils/lagosDay.js";
import { getIncentiveConfig, paidStatuses, courseKey } from "./incentiveConfig.js";
import { loadUploaderRisk } from "./uploaderRisk.js";

// The payout engine: decides and records the reward for one approved upload.
//
// Two layers, on purpose:
//   1. planAward()    - PURE decision logic (which tier, how much, why blocked). Used for the
//                       moderator's preview and for the messages they see.
//   2. awardForApproval() - the writer. Every limit (weekly cap, monthly budget, moderator's
//                       daily limit, bounty slots, one first-upload bonus) is enforced INSIDE the
//                       INSERT's own SQL, so two approvals racing each other can't both squeeze
//                       past a cap that was checked a moment earlier in JavaScript.
//
// While the program is 'off' nothing happens at all. In 'shadow' the same maths run but rows are
// written with status 'shadow' and NO balance, bounty or referral state is touched. In 'paused'
// approvals go through and nothing new is paid.

const DAY = 86400000;
const naira = (n) => "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");

// ---------------------------------------------------------------------------- limits
// Shared by the preview and the writer's plan. Returns what survives the limits, or why not.
// Order matters and matches the guide: weekly cap (clamp) -> monthly budget (clamp) -> the
// moderator's daily limit (all-or-nothing: "if exceeded, pay nothing").
export function applyLimits(rules, { total, earned7d, paidMonth, adminToday }) {
  if (!(rules.weeklyCap > 0)) return { amount: 0, reason: "No weekly earning cap is set (set one in Rules)." };
  if (!(rules.monthlyBudget > 0)) return { amount: 0, reason: "No monthly budget is set (set one in Rules)." };
  const weekRemaining = rules.weeklyCap - earned7d;
  if (weekRemaining <= 0) return { amount: 0, reason: "Weekly cap reached for this student." };
  const monthRemaining = rules.monthlyBudget - paidMonth;
  if (monthRemaining <= 0) return { amount: 0, reason: "Monthly reward budget reached." };
  const amount = Math.min(total, weekRemaining, monthRemaining);
  if (adminToday + amount > rules.adminDailyLimit) {
    return { amount: 0, reason: `You've reached your daily award limit (${naira(rules.adminDailyLimit)}).` };
  }
  return { amount, reason: null };
}

export function standardAmount(rules, type) {
  if (type === "Past Question") return rules.rewards.pastQuestion;
  if (type === "Lecture Note") return rules.rewards.lectureNote;
  return 0;
}

// Preview shown next to each item in the moderation queue (default tier, no bonus).
export function previewAward(cfg, { adminId, uploaderId, frozen, type, hasBounty, bountyReward, earned7d, paidMonth, adminToday }) {
  if (cfg.status === "off") return null;
  if (cfg.status === "paused") return { blocked: true, blockReason: "Rewards are paused." };
  if (adminId === uploaderId) return { blocked: true, blockReason: "No reward is paid for your own upload." };
  if (frozen) return { blocked: true, blockReason: "Rewards are frozen for this student." };
  const base = hasBounty ? bountyReward : standardAmount(cfg.rules, type);
  if (!(base > 0)) return { blocked: true, blockReason: "No reward is set for this type of resource." };
  const total = Math.min(base, cfg.rules.maxSinglePayout);
  const r = applyLimits(cfg.rules, { total, earned7d, paidMonth, adminToday });
  return r.amount > 0 ? { blocked: false, amount: r.amount } : { blocked: true, blockReason: r.reason };
}

// ---------------------------------------------------------------------------- context
function windows(now) {
  return {
    week: new Date(now.getTime() - 7 * DAY).toISOString(),
    month: startOfMonthInLagos().toISOString(),
    day: startOfTodayInLagos().toISOString(),
  };
}

export async function sumRewards(DB, { userId = null, approverId = null, since, counted }) {
  const marks = counted.map(() => "?").join(",");
  const where = ["type = 'reward'", `status IN (${marks})`, "created_at >= ?"];
  const args = [...counted, since];
  if (userId) { where.push("user_id = ?"); args.push(userId); }
  if (approverId) { where.push("approved_by = ?"); args.push(approverId); }
  const row = await DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM reward_ledger WHERE ${where.join(" AND ")}`).bind(...args).first();
  return row.n;
}

async function loadContext(DB, { resource, adminId, cfg, now }) {
  const counted = paidStatuses(cfg.status);
  const w = windows(now);
  const nowMs = now.getTime();

  const [uploader, earned7d, paidMonth, adminToday, approvedBefore, hasFirst, dup, bounty, risk, referral] = await Promise.all([
    DB.prepare("SELECT rewards_frozen, account_status FROM users WHERE id = ?").bind(resource.uploader_id).first(),
    sumRewards(DB, { userId: resource.uploader_id, since: w.week, counted }),
    sumRewards(DB, { since: w.month, counted }),
    sumRewards(DB, { approverId: adminId, since: w.day, counted }),
    // "First approved upload" = no OTHER approved upload of theirs came earlier (by approval time, then id as a
    // tie-break). Counting every other approved upload would let two first uploads approved at the same moment
    // each see the other and BOTH lose the bonus. Approved uploads with no recorded time count as earlier.
    DB.prepare(
      `SELECT COUNT(*) AS n FROM resources
        WHERE uploader_id = ? AND status = 'approved' AND id != ?
          AND (? IS NULL OR reviewed_at IS NULL OR reviewed_at < ? OR (reviewed_at = ? AND id < ?))`
    ).bind(resource.uploader_id, resource.id, resource.reviewed_at ?? null, resource.reviewed_at ?? null, resource.reviewed_at ?? null, resource.id).first(),
    DB.prepare("SELECT 1 AS x FROM reward_ledger WHERE user_id = ? AND type = 'reward' AND tier = 'first' AND (status != 'shadow' OR ?) LIMIT 1")
      .bind(resource.uploader_id, cfg.status === "shadow" ? 1 : 0).first(),
    resource.file_hash
      ? DB.prepare("SELECT 1 AS x FROM resources WHERE file_hash = ? AND status = 'approved' AND id != ? LIMIT 1").bind(resource.file_hash, resource.id).first()
      : Promise.resolve(null),
    resource.bounty_id
      ? DB.prepare("SELECT id, reward, course_key FROM bounties WHERE id = ? AND status = 'open' AND paid < max_payouts AND expires_at >= ?")
          .bind(resource.bounty_id, resource.created_at).first()
      : Promise.resolve(null),
    loadUploaderRisk(DB, resource.uploader_id, nowMs),
    DB.prepare(
      `SELECT r.id, r.inviter_id, i.rewards_frozen AS inviter_frozen, i.account_status AS inviter_status, i.signup_ip_hash AS inviter_ip, v.signup_ip_hash AS invitee_ip
         FROM referrals r JOIN users i ON i.id = r.inviter_id JOIN users v ON v.id = r.invitee_id
        WHERE r.invitee_id = ? AND r.status = 'verified'`
    ).bind(resource.uploader_id).first(),
  ]);

  // An upload only counts toward a request for the SAME course, and it's judged on when it was
  // uploaded, so a slow moderator can't make a student miss the deadline.
  const validBounty = bounty && bounty.course_key === courseKey(resource.course) ? bounty : null;

  return {
    uploader, earned7d, paidMonth, adminToday, riskLevel: risk.level, referral,
    approvedBefore: approvedBefore.n, hasFirstRow: !!hasFirst, duplicate: !!dup, bounty: validBounty,
  };
}

// ---------------------------------------------------------------------------- plan
export function planAward({ cfg, resource, adminId, review, ctx }) {
  const rules = cfg.rules;
  const stop = (reason, silent = false) => ({ stop: { reason, silent } });

  if (adminId === resource.uploader_id) return stop("Moderators aren't paid for uploads they approve themselves.");
  if (!ctx.uploader || ctx.uploader.account_status !== "active") return stop("The student's account isn't active.");
  if (ctx.uploader.rewards_frozen) return stop("Rewards are frozen for this student.");

  let tier = review.rewardTier;
  if (tier === "none") return stop("No reward was chosen for this upload.", true);
  if (!tier) {
    // Quick-approve (no reward choice made): pay the sensible default, but never to a risky account.
    if (ctx.riskLevel === "high") return stop("This student is high-risk, so no reward is applied automatically. Use the full review dialog to decide.");
    tier = ctx.bounty ? "bounty" : "standard";
  }
  if (tier === "bounty" && !ctx.bounty) tier = "standard"; // the request closed or filled in the meantime

  let base;
  if (tier === "bounty") base = ctx.bounty.reward;
  else if (tier === "high") base = rules.rewards.high;
  else if (tier === "rare") base = rules.rewards.rare;
  else base = standardAmount(rules, resource.type);
  if (!(base > 0)) return stop("No reward is set for this type of resource.");

  if (ctx.duplicate) return stop("This file was already approved before, so it earns nothing.");

  const wantsBonus = rules.rewards.firstApproval > 0 && ctx.approvedBefore === 0 && !ctx.hasFirstRow;
  const total = Math.min(base + (wantsBonus ? rules.rewards.firstApproval : 0), rules.maxSinglePayout);
  if (!(total > 0)) return stop("The largest single payout is ₦0, so nothing can be paid.");

  const limited = applyLimits(rules, { total, earned7d: ctx.earned7d, paidMonth: ctx.paidMonth, adminToday: ctx.adminToday });
  if (limited.amount <= 0) return stop(limited.reason);

  const main = Math.min(base, total);
  const bonus = wantsBonus ? total - main : 0;
  const rows = [{ kind: "main", tier, amount: main, bountyId: tier === "bounty" ? ctx.bounty.id : null }];
  if (bonus > 0) rows.push({ kind: "first", tier: "first", amount: bonus, bountyId: null });
  return { tier, rows };
}

// ---------------------------------------------------------------------------- writer
// One conditional INSERT. Everything that can change under our feet is re-checked in SQL.
function rewardInsert(DB, o) {
  const { cfg, counted, since, row } = o;
  const marks = counted.map(() => "?").join(",");
  let sql = `
    INSERT INTO reward_ledger
      (id, user_id, type, amount, status, tier, label, resource_id, bounty_id, referral_id, approved_by, note, clears_at, created_at)
    SELECT ?, ?, 'reward', x.amt, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM (
        SELECT CASE WHEN a.admin_sum + m.cl <= ? THEN m.cl ELSE 0 END AS amt
          FROM (SELECT MAX(0, MIN(?,
                  ? - (SELECT COALESCE(SUM(amount), 0) FROM reward_ledger WHERE user_id = ? AND type = 'reward' AND status IN (${marks}) AND created_at >= ?),
                  ? - (SELECT COALESCE(SUM(amount), 0) FROM reward_ledger WHERE type = 'reward' AND status IN (${marks}) AND created_at >= ?)
                )) AS cl) m,
               (SELECT COALESCE(SUM(amount), 0) AS admin_sum FROM reward_ledger WHERE approved_by = ? AND type = 'reward' AND status IN (${marks}) AND created_at >= ?) a
      ) x
     WHERE x.amt > 0
       AND EXISTS (SELECT 1 FROM users WHERE id = ? AND rewards_frozen = 0 AND account_status = 'active')`;
  const args = [
    row.id, row.userId, row.status, row.tier, row.label, row.resourceId, row.bountyId ?? null, row.referralId ?? null, row.approver, row.note, row.clearsAt, o.ts,
    cfg.rules.adminDailyLimit, row.amount,
    cfg.rules.weeklyCap, row.userId, ...counted, since.week,
    cfg.rules.monthlyBudget, ...counted, since.month,
    row.approver, ...counted, since.day,
    row.userId,
  ];
  if (row.tier === "first") {
    sql += " AND NOT EXISTS (SELECT 1 FROM reward_ledger WHERE user_id = ? AND type = 'reward' AND tier = 'first' AND (status != 'shadow' OR ?))";
    args.push(row.userId, cfg.status === "shadow" ? 1 : 0);
  }
  if (row.tier === "bounty") {
    sql += " AND EXISTS (SELECT 1 FROM bounties WHERE id = ? AND status = 'open' AND paid < max_payouts)";
    args.push(row.bountyId);
  }
  if (row.tier === "referral") {
    sql += " AND EXISTS (SELECT 1 FROM referrals WHERE id = ? AND status = 'verified')";
    args.push(row.referralId);
  }
  return DB.prepare(sql).bind(...args);
}

// Money statements that follow a (conditional) insert: they only act if that row really exists.
function settleStatements(DB, { live, rowId, userId, holdsPending, ts }) {
  if (!live) return [];
  const column = holdsPending ? "reward_pending" : "reward_balance";
  return [
    DB.prepare(
      `UPDATE users SET ${column} = ${column} + (SELECT amount FROM reward_ledger WHERE id = ?), updated_at = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM reward_ledger WHERE id = ?)`
    ).bind(rowId, ts, userId, rowId),
  ];
}

export async function awardForApproval(DB, { resource, admin, review, ts }) {
  const cfg = await getIncentiveConfig(DB);
  if (cfg.status === "off") return null;
  if (cfg.status === "paused") return { status: "paused", amount: 0, message: "Rewards are paused, so no reward was paid." };

  const now = new Date(ts);
  const live = cfg.status === "live";
  const counted = paidStatuses(cfg.status);
  const since = windows(now);
  const ctx = await loadContext(DB, { resource, adminId: admin.id, cfg, now });
  const plan = planAward({ cfg, resource, adminId: admin.id, review, ctx });
  if (plan.stop) {
    return { status: plan.stop.silent ? "skipped" : "blocked", amount: 0, message: plan.stop.silent ? "" : `No reward paid: ${plan.stop.reason}` };
  }

  const holdMs = cfg.rules.holdDays * DAY;
  const holdsPending = live && cfg.rules.holdDays > 0;
  const status = !live ? "shadow" : holdsPending ? "pending" : "cleared";
  const clearsAt = new Date(now.getTime() + holdMs).toISOString();
  const note = String(review.rewardNote || "").slice(0, 300);
  const label = `${resource.course} ${resource.type} approved`;

  const statements = [];
  const ids = [];
  for (const r of plan.rows) {
    const id = generateId();
    ids.push(id);
    const row = {
      id, userId: resource.uploader_id, tier: r.tier, amount: r.amount, status, approver: admin.id, note, clearsAt,
      label: r.kind === "first" ? "First approved upload bonus" : label, resourceId: resource.id, bountyId: r.bountyId,
    };
    statements.push(rewardInsert(DB, { cfg, counted, since, ts, row }));
    statements.push(...settleStatements(DB, { live, rowId: id, userId: row.userId, holdsPending, ts }));
    if (live && r.tier === "bounty") {
      statements.push(
        DB.prepare(
          `UPDATE bounties SET paid = paid + 1, status = CASE WHEN paid + 1 >= max_payouts THEN 'fulfilled' ELSE status END, updated_at = ?
            WHERE id = ? AND EXISTS (SELECT 1 FROM reward_ledger WHERE id = ?)`
        ).bind(ts, r.bountyId, id)
      );
    }
  }

  // Referral: the invitee's first rewardable approval pays the inviter (once, ever).
  let referralNote = "";
  const ref = ctx.referral;
  if (ref) {
    const ringBlocked = ref.inviter_ip && ref.invitee_ip && ref.inviter_ip === ref.invitee_ip;
    const payable = ref.inviter_status === "active" && !ref.inviter_frozen && !ringBlocked && cfg.rules.rewards.referralFirstApproval > 0;
    if (payable) {
      const id = generateId();
      ids.push(id);
      const amount = Math.min(cfg.rules.rewards.referralFirstApproval, cfg.rules.maxSinglePayout);
      const row = {
        id, userId: ref.inviter_id, tier: "referral", amount, status, approver: admin.id, note: "", clearsAt,
        label: "Referral: a friend's first upload was approved", resourceId: resource.id, referralId: ref.id,
      };
      statements.push(rewardInsert(DB, { cfg, counted, since, ts, row }));
      statements.push(...settleStatements(DB, { live, rowId: id, userId: ref.inviter_id, holdsPending, ts }));
      if (live) {
        statements.push(
          DB.prepare(
            `UPDATE referrals SET status = 'contributed', earned = earned + COALESCE((SELECT amount FROM reward_ledger WHERE id = ?), 0), updated_at = ?
              WHERE id = ? AND status = 'verified'`
          ).bind(id, ts, ref.id)
        );
      }
    } else if (live) {
      // Not payable (frozen inviter, same connection, no amount set): close it so it can't be retried later.
      statements.push(DB.prepare("UPDATE referrals SET status = 'contributed', updated_at = ? WHERE id = ? AND status = 'verified'").bind(ts, ref.id));
      if (ringBlocked) referralNote = " The referral bonus was withheld (the friend signed up from the inviter's own connection).";
    }
  }

  try {
    await DB.batch(statements);
  } catch (err) {
    // The unique index (resource, student, tier) is the idempotency backstop: this upload was
    // already rewarded once (e.g. removed and re-approved). The whole batch rolled back; nothing moved.
    if (/UNIQUE constraint failed/i.test(String(err?.message))) {
      return { status: "blocked", amount: 0, message: "No reward paid: this upload was already rewarded once." };
    }
    throw err;
  }

  const marks = ids.map(() => "?").join(",");
  const { results: written } = await DB.prepare(`SELECT id, amount, user_id, tier FROM reward_ledger WHERE id IN (${marks})`).bind(...ids).all();
  const mine = written.filter((w) => w.user_id === resource.uploader_id);
  const amount = mine.reduce((s, w) => s + w.amount, 0);
  const inviterPaid = written.filter((w) => w.tier === "referral").reduce((s, w) => s + w.amount, 0);

  if (live) await pauseIfBudgetReached(DB, cfg, ts);

  if (amount <= 0) {
    // Everything was clamped away by a limit that changed between our check and the write.
    return { status: "blocked", amount: 0, message: "No reward paid: a limit was reached at the moment of approval." };
  }
  const when = !live ? "" : holdsPending ? ` It becomes spendable in ${cfg.rules.holdDays} day${cfg.rules.holdDays === 1 ? "" : "s"}.` : "";
  const bonusTxt = inviterPaid > 0 ? ` Referral bonus ${naira(inviterPaid)} to the inviter.` : "";
  const message = live
    ? `Reward of ${naira(amount)} recorded for the student.${when}${bonusTxt}${referralNote}`
    : `Shadow mode: a ${naira(amount)} reward was recorded for review but NOT paid.`;
  return { status: live ? "paid" : "shadow", amount, message };
}

// Auto-pause: once the month's real spend reaches the budget, switch to 'paused' (once) and say so
// in the audit log. The audit row is only written if THIS call performed the switch.
async function pauseIfBudgetReached(DB, cfg, ts) {
  if (!(cfg.rules.monthlyBudget > 0)) return;
  const paid = await sumRewards(DB, { since: startOfMonthInLagos().toISOString(), counted: ["pending", "cleared"] });
  if (paid < cfg.rules.monthlyBudget) return;
  await DB.batch([
    DB.prepare("UPDATE incentive_config SET status = 'paused', updated_by = NULL, updated_at = ? WHERE id = 1 AND status = 'live'").bind(ts),
    DB.prepare(
      `INSERT INTO incentive_audit (id, admin_id, admin_name, action, detail, created_at)
       SELECT ?, NULL, 'System', 'auto-pause', ?, ?
        WHERE EXISTS (SELECT 1 FROM incentive_config WHERE id = 1 AND status = 'paused' AND updated_at = ?)`
    ).bind(generateId(), `live → paused. Auto-paused: monthly budget reached (${naira(paid)} of ${naira(cfg.rules.monthlyBudget)}).`, ts, ts),
  ]);
}
