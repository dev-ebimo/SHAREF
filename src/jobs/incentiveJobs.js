import { generateId } from "../utils/id.js";
import { getIncentiveConfig } from "../services/incentiveConfig.js";

// Scheduled work for the reward program. Both jobs are idempotent (safe to run twice, or to overlap)
// and bounded (a fixed amount of work per run) so a backlog can never time a run out; the next run
// simply continues.

const DAY = 86400000;
// Batch sizes are deliberately modest: each cleared reward is 2 statements, and Cloudflare caps how much
// database work one invocation may do (the cap depends on your Workers plan). 20 rewards = a 40-statement
// batch; 6 rounds => up to 120 rewards per hourly run (2,880 a day), and a bigger backlog simply
// continues next hour. Raise these only if your plan's limits allow it.
export const CLEAR_LIMITS = { batch: 20, rounds: 6 };
const CLEAR_BATCH = CLEAR_LIMITS.batch;
const CLEAR_MAX_ROUNDS = CLEAR_LIMITS.rounds;

// ---------------------------------------------------------------------------- clearing (hourly)
// A reward becomes spendable once its hold period is over: move it from `pending` to `cleared`
// and from the student's reward_pending to their reward_balance. The balance statements run BEFORE
// the status flip and only if the row is still 'pending', so a run racing a reversal (or another
// run) can't move the money twice or move money for a reward that was just taken back.
export async function clearMaturedRewards(env, { now = new Date() } = {}) {
  const DB = env.DB;
  const ts = now.toISOString();
  let cleared = 0;
  let failed = 0;

  for (let round = 0; round < CLEAR_MAX_ROUNDS; round++) {
    const { results: due } = await DB.prepare(
      `SELECT id, user_id, amount FROM reward_ledger
        WHERE type = 'reward' AND status = 'pending' AND clears_at <= ? AND user_id IS NOT NULL
        ORDER BY clears_at LIMIT ?`
    ).bind(ts, CLEAR_BATCH).all();
    if (due.length === 0) break;

    const statementsFor = (rows) =>
      rows.flatMap((r) => [
        DB.prepare(
          `UPDATE users SET reward_pending = reward_pending - ?, reward_balance = reward_balance + ?, updated_at = ?
            WHERE id = ? AND EXISTS (SELECT 1 FROM reward_ledger WHERE id = ? AND status = 'pending')`
        ).bind(r.amount, r.amount, ts, r.user_id, r.id),
        DB.prepare("UPDATE reward_ledger SET status = 'cleared' WHERE id = ? AND status = 'pending'").bind(r.id),
      ]);

    try {
      await DB.batch(statementsFor(due));
      cleared += due.length;
    } catch (err) {
      // One bad row (e.g. a balance that no longer matches) must not block every other student's
      // reward forever: fall back to one-by-one so only the broken row is skipped, and log it.
      console.error("clearMaturedRewards batch failed, retrying row by row:", err?.message);
      for (const r of due) {
        try { await DB.batch(statementsFor([r])); cleared++; }
        catch (e) { failed++; console.error(`clearMaturedRewards: could not clear ${r.id}:`, e?.message); }
      }
      if (failed > 0 && cleared === 0) break; // nothing is moving; don't spin
    }
    if (due.length < CLEAR_BATCH) break;
  }
  return { cleared, failed };
}

// ---------------------------------------------------------------------------- flag detection (daily)
// Thresholds are deliberately conservative: a flag costs a moderator's time, and nothing here
// freezes or reverses anything. A human always decides.
export const FLAG_RULES = {
  spamRejections: 3,        // duplicate/spam rejections in 14 days
  sharedConnectionReferrals: 2, // referred friends who signed up from the inviter's own connection
  capStreakWeeks: 4,        // consecutive 7-day windows at the weekly cap
  neverSpentMin: 500,       // earned at least this much...
  neverSpentAgeDays: 14,    // ...over at least this long, with no download ever bought
  sameModerator: 5,         // approvals of one student by one moderator in 14 days
  quietPeriodDays: 14,      // don't re-flag someone whose flag was resolved this recently
};

export async function detectFlags(env, { now = new Date() } = {}) {
  const DB = env.DB;
  const cfg = await getIncentiveConfig(DB);
  if (cfg.status === "off") return { skipped: true, opened: 0, updated: 0 };

  const ts = now.toISOString();
  const ago = (days) => new Date(now.getTime() - days * DAY).toISOString();
  const signals = new Map(); // userId -> string[]
  const add = (userId, text) => {
    if (!userId) return;
    if (!signals.has(userId)) signals.set(userId, []);
    signals.get(userId).push(text);
  };
  const naira = (n) => "₦" + Math.round(n).toLocaleString("en-NG");

  // 1. repeated duplicate/spam rejections
  const spam = await DB.prepare(
    `SELECT uploader_id AS user_id, COUNT(*) AS n FROM resources
      WHERE status = 'rejected' AND reviewed_at >= ?
        AND (LOWER(rejection_reason) LIKE '%duplicate%' OR LOWER(rejection_reason) LIKE '%spam%')
      GROUP BY uploader_id HAVING COUNT(*) >= ?`
  ).bind(ago(14), FLAG_RULES.spamRejections).all();
  for (const r of spam.results) add(r.user_id, `${r.n} duplicate or spam uploads rejected in the last 14 days`);

  // 2. referral rings: invited friends who signed up from the inviter's own connection
  const ring = await DB.prepare(
    `SELECT r.inviter_id AS user_id, COUNT(*) AS n FROM referrals r
       JOIN users i ON i.id = r.inviter_id JOIN users v ON v.id = r.invitee_id
      WHERE i.signup_ip_hash IS NOT NULL AND i.signup_ip_hash = v.signup_ip_hash
      GROUP BY r.inviter_id HAVING COUNT(*) >= ?`
  ).bind(FLAG_RULES.sharedConnectionReferrals).all();
  for (const r of ring.results) add(r.user_id, `${r.n} referred friends signed up from the same connection as this student`);

  // 3. at the weekly cap four 7-day windows in a row
  if (cfg.rules.weeklyCap > 0) {
    const cap = cfg.rules.weeklyCap;
    const windowSql = "SUM(CASE WHEN created_at >= ? AND created_at < ? THEN amount ELSE 0 END) >= ?";
    const windowArgs = [];
    for (let w = 0; w < FLAG_RULES.capStreakWeeks; w++) {
      const from = ago((w + 1) * 7);                 // window start: 7, 14, 21, 28 days ago
      const to = w === 0 ? ago(-1) : ago(w * 7);     // window end: now (a day of slack for clock skew), 7, 14, 21 days ago
      windowArgs.push(from, to, cap);
    }
    const streak = await DB.prepare(
      `SELECT user_id FROM reward_ledger
        WHERE type = 'reward' AND status IN ('pending','cleared') AND user_id IS NOT NULL AND created_at >= ?
        GROUP BY user_id
       HAVING ${Array(FLAG_RULES.capStreakWeeks).fill(windowSql).join(" AND ")}`
    ).bind(ago(FLAG_RULES.capStreakWeeks * 7), ...windowArgs).all();
    for (const r of streak.results) add(r.user_id, `Earned the full weekly cap (${naira(cap)}) ${FLAG_RULES.capStreakWeeks} weeks in a row`);
  }

  // 4. earns but has never bought a download
  const hoarders = await DB.prepare(
    `SELECT l.user_id AS user_id, SUM(l.amount) AS total FROM reward_ledger l
      WHERE l.type = 'reward' AND l.status IN ('pending','cleared') AND l.user_id IS NOT NULL
      GROUP BY l.user_id
     HAVING SUM(l.amount) >= ? AND MIN(l.created_at) <= ?
        AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = l.user_id AND t.type = 'purchase' AND t.status = 'successful')`
  ).bind(FLAG_RULES.neverSpentMin, ago(FLAG_RULES.neverSpentAgeDays)).all();
  for (const r of hoarders.results) add(r.user_id, `Has earned ${naira(r.total)} in rewards but has never downloaded anything`);

  // 5. one moderator approving the same student over and over
  const repeat = await DB.prepare(
    `SELECT user_id, COUNT(*) AS n FROM reward_ledger
      WHERE type = 'reward' AND status IN ('pending','cleared') AND user_id IS NOT NULL AND approved_by IS NOT NULL
        AND tier IN ('standard','high','rare','bounty') AND created_at >= ?
      GROUP BY user_id, approved_by HAVING COUNT(*) >= ?`
  ).bind(ago(14), FLAG_RULES.sameModerator).all();
  for (const r of repeat.results) add(r.user_id, `${r.n} of this student's uploads were approved by the same moderator in 14 days`);

  if (signals.size === 0) return { skipped: false, opened: 0, updated: 0 };

  // Don't nag: skip anyone whose flag was resolved recently; keep ONE open flag per student.
  const ids = [...signals.keys()];
  const marks = ids.map(() => "?").join(",");
  const [recent, open, exposure] = await Promise.all([
    DB.prepare(`SELECT DISTINCT user_id FROM incentive_flags WHERE status != 'open' AND resolved_at >= ? AND user_id IN (${marks})`).bind(ago(FLAG_RULES.quietPeriodDays), ...ids).all(),
    DB.prepare(`SELECT id, user_id FROM incentive_flags WHERE status = 'open' AND user_id IN (${marks})`).bind(...ids).all(),
    DB.prepare(`SELECT id, reward_balance, reward_pending FROM users WHERE id IN (${marks})`).bind(...ids).all(),
  ]);
  const quiet = new Set(recent.results.map((r) => r.user_id));
  const openByUser = new Map(open.results.map((r) => [r.user_id, r.id]));
  const atRisk = new Map(exposure.results.map((u) => [u.id, Math.max(u.reward_balance, 0) + u.reward_pending]));

  const statements = [];
  let opened = 0, updated = 0;
  for (const [userId, lines] of signals) {
    if (quiet.has(userId)) continue;
    const json = JSON.stringify(lines);
    const money = atRisk.get(userId) || 0;
    if (openByUser.has(userId)) {
      statements.push(DB.prepare("UPDATE incentive_flags SET signals = ?, exposure = ?, updated_at = ? WHERE id = ? AND status = 'open'").bind(json, money, ts, openByUser.get(userId)));
      updated++;
    } else {
      statements.push(
        DB.prepare("INSERT INTO incentive_flags (id, user_id, signals, exposure, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?)")
          .bind(generateId(), userId, json, money, ts, ts)
      );
      opened++;
    }
  }
  if (opened > 0) {
    statements.push(
      DB.prepare("INSERT INTO incentive_audit (id, admin_id, admin_name, action, detail, created_at) VALUES (?, NULL, 'System', 'flags', ?, ?)")
        .bind(generateId(), `Daily check opened ${opened} new flag(s) for review.`, ts)
    );
  }
  if (statements.length) await DB.batch(statements);
  return { skipped: false, opened, updated };
}

// ---------------------------------------------------------------------------- cron dispatch
// Two schedules are declared in wrangler.toml:
//   hourly  "0 * * * *"  -> rewards whose hold period is over become spendable
//   daily   "0 2 * * *"  -> 03:00 Lagos: clean up unfinished uploads + scan for suspicious reward activity
// An unknown/absent cron string (e.g. `wrangler dev --test-scheduled`) runs everything.
export const CRON_HOURLY = "0 * * * *";
export const CRON_DAILY = "0 2 * * *";

export function runScheduledJobs(event, env, ctx, { purgeStaleUploads }) {
  const cron = event?.cron;
  const everything = cron !== CRON_HOURLY && cron !== CRON_DAILY;
  const guard = (name, promise) => ctx.waitUntil(Promise.resolve(promise).catch((err) => console.error(`scheduled ${name} failed:`, err?.message)));
  const ran = [];
  if (everything || cron === CRON_HOURLY) { ran.push("clearMaturedRewards"); guard("clearMaturedRewards", clearMaturedRewards(env)); }
  if (everything || cron === CRON_DAILY) {
    ran.push("purgeStaleUploads", "detectFlags");
    guard("purgeStaleUploads", purgeStaleUploads(env, { limit: 20 }));
    guard("detectFlags", detectFlags(env));
  }
  return ran;
}
