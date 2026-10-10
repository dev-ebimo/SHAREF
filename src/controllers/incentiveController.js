import { sanitizeError } from "../utils/sanitizeError.js";
import { startOfWeekInLagos } from "../utils/lagosDay.js";
import { getIncentiveConfig, isVisibleToStudents } from "../services/incentiveConfig.js";
import { ensureReferralCode } from "../services/referralService.js";

// The student side of the incentive program. Design rule: while the program is
// 'off' (the default) or 'shadow' (records what WOULD be paid, invisible to students),
// every endpoint here behaves as if the feature doesn't exist.

const NOT_OPEN = { success: false, message: "Rewards are not open yet." };

// "Chidinma Okafor" -> "Chidinma O." : other students' full names are never exposed.
function publicName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Student";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
const firstName = (fullName) => String(fullName || "").trim().split(/\s+/)[0] || "Student";

// @route GET /api/incentives/config
// Always answers (the dashboard and Earn page call it first to decide whether to show anything).
export async function getIncentiveStatus(c) {
  try {
    const cfg = await getIncentiveConfig(c.env.DB);
    if (!isVisibleToStudents(cfg.status)) {
      return c.json({ success: true, enabled: false, status: "off" });
    }
    const r = cfg.rules;
    return c.json({
      success: true,
      enabled: true,
      status: cfg.status, // 'live' | 'paused'
      holdDays: r.holdDays,
      weeklyCap: r.weeklyCap,
      ...(cfg.season ? { season: cfg.season } : {}),
      rewards: {
        pastQuestion: r.rewards.pastQuestion,
        lectureNote: r.rewards.lectureNote,
        firstApproval: r.rewards.firstApproval,
        referralFirstApproval: r.rewards.referralFirstApproval,
      },
    });
  } catch (err) {
    console.error("incentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load rewards settings", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/incentives/me
export async function getMyIncentives(c) {
  try {
    const DB = c.env.DB;
    const user = c.get("user");
    const cfg = await getIncentiveConfig(DB);
    if (!isVisibleToStudents(cfg.status)) return c.json(NOT_OPEN, 403);

    const referralCode = await ensureReferralCode(DB, user.id);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [me, week, ledger, referrals] = await Promise.all([
      DB.prepare("SELECT wallet_balance, reward_balance, reward_pending, rewards_frozen FROM users WHERE id = ?").bind(user.id).first(),
      // The weekly cap is a rolling 7 days, the same window the payout engine enforces.
      DB.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS earned FROM reward_ledger
          WHERE user_id = ? AND type = 'reward' AND status IN ('pending','cleared') AND created_at >= ?`
      ).bind(user.id, sevenDaysAgo).first(),
      // Shadow rows are the admin's what-if data and are NEVER shown to students.
      DB.prepare(
        `SELECT id, created_at, label, amount, status FROM reward_ledger
          WHERE user_id = ? AND status != 'shadow' ORDER BY created_at DESC LIMIT 30`
      ).bind(user.id).all(),
      DB.prepare(
        `SELECT r.status, r.earned, u.full_name FROM referrals r
           JOIN users u ON u.id = r.invitee_id
          WHERE r.inviter_id = ? ORDER BY r.created_at DESC LIMIT 50`
      ).bind(user.id).all(),
    ]);
    if (!me) return c.json({ success: false, message: "User not found" }, 404);

    return c.json({
      success: true,
      frozen: !!me.rewards_frozen,
      balance: {
        funded: me.wallet_balance,
        reward: me.reward_balance,
        pending: me.reward_pending,
      },
      weekEarned: week.earned,
      weekCap: cfg.rules.weeklyCap,
      referralCode,
      referrals: referrals.results.map((r) => ({ name: firstName(r.full_name), status: r.status, earned: r.earned })),
      ledger: ledger.results.map((r) => ({ id: r.id, date: r.created_at, label: r.label, amount: r.amount, status: r.status })),
    });
  } catch (err) {
    console.error("incentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load your rewards", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/incentives/requests
// Open "Wanted" requests: not expired, not fully paid out.
export async function getOpenRequests(c) {
  try {
    const DB = c.env.DB;
    const cfg = await getIncentiveConfig(DB);
    if (!isVisibleToStudents(cfg.status)) return c.json(NOT_OPEN, 403);

    const { results } = await DB.prepare(
      `SELECT id, course, type, level, reward, note FROM bounties
        WHERE status = 'open' AND expires_at > ? AND paid < max_payouts
        ORDER BY reward DESC, created_at DESC LIMIT 20`
    ).bind(new Date().toISOString()).all();

    return c.json({ success: true, requests: results });
  } catch (err) {
    console.error("incentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load requests", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/incentives/leaderboard
// This week's (Monday 00:00, Africa/Lagos) most-approved uploaders. Counts approved
// uploads only, so it works whether or not any reward was paid.
export async function getLeaderboard(c) {
  try {
    const DB = c.env.DB;
    const user = c.get("user");
    const cfg = await getIncentiveConfig(DB);
    if (!isVisibleToStudents(cfg.status)) return c.json(NOT_OPEN, 403);

    const { results } = await DB.prepare(
      `SELECT r.uploader_id AS id, u.full_name, COUNT(*) AS approved, MIN(r.reviewed_at) AS first_at
         FROM resources r JOIN users u ON u.id = r.uploader_id
        WHERE r.status = 'approved' AND r.reviewed_at >= ? AND u.account_status = 'active'
        GROUP BY r.uploader_id
        ORDER BY approved DESC, first_at ASC
        LIMIT 10`
    ).bind(startOfWeekInLagos().toISOString()).all();

    return c.json({
      success: true,
      leaders: results.map((row, i) => ({
        rank: i + 1,
        name: publicName(row.full_name),
        approved: row.approved,
        isMe: row.id === user.id,
      })),
    });
  } catch (err) {
    console.error("incentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load the leaderboard", error: sanitizeError(c.env, err) }, 500);
  }
}
