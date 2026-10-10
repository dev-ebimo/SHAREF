import { getIncentiveConfig, isVisibleToStudents } from "./incentiveConfig.js";

// The reward chip on a student's "My uploads" cards: { amount, status }.
//   pending upload  -> { amount: <most it could earn, standard tier or its request's reward> }  ("Up to ...")
//   approved upload -> what was actually paid, with status pending | cleared | reversed
//   rejected upload -> no chip
// Returns an empty Map unless the program is live or paused, so while it is off/shadow
// "My uploads" is exactly what it always was.
export async function rewardChipsForUploads(DB, userId, uploads) {
  const chips = new Map();
  if (!uploads.length) return chips;
  const cfg = await getIncentiveConfig(DB);
  if (!isVisibleToStudents(cfg.status)) return chips;

  const ids = uploads.map((u) => u.id);
  const marks = ids.map(() => "?").join(",");
  const { results: paid } = await DB.prepare(
    `SELECT resource_id, amount, status FROM reward_ledger
      WHERE user_id = ? AND type = 'reward' AND status != 'shadow' AND resource_id IN (${marks})`
  ).bind(userId, ...ids).all();

  const byResource = new Map();
  for (const row of paid) {
    if (!byResource.has(row.resource_id)) byResource.set(row.resource_id, []);
    byResource.get(row.resource_id).push(row);
  }

  const bountyIds = [...new Set(uploads.filter((u) => u.status === "pending" && u.bounty_id).map((u) => u.bounty_id))];
  const bountyReward = new Map();
  if (bountyIds.length) {
    const { results } = await DB.prepare(
      `SELECT id, reward FROM bounties
        WHERE id IN (${bountyIds.map(() => "?").join(",")}) AND status = 'open' AND expires_at > ? AND paid < max_payouts`
    ).bind(...bountyIds, new Date().toISOString()).all();
    for (const b of results) bountyReward.set(b.id, b.reward);
  }

  for (const u of uploads) {
    if (u.status === "rejected") continue;
    const rows = byResource.get(u.id);
    if (rows?.length) {
      const live = rows.filter((r) => r.status !== "reversed");
      if (live.length) {
        chips.set(u.id, { amount: live.reduce((s, r) => s + r.amount, 0), status: live.some((r) => r.status === "pending") ? "pending" : "cleared" });
      } else {
        chips.set(u.id, { amount: rows.reduce((s, r) => s + r.amount, 0), status: "reversed" });
      }
    } else if (u.status === "pending") {
      const standard = u.type === "Past Question" ? cfg.rules.rewards.pastQuestion : u.type === "Lecture Note" ? cfg.rules.rewards.lectureNote : 0;
      const potential = Math.max(standard, bountyReward.get(u.bounty_id) || 0);
      if (potential > 0) chips.set(u.id, { amount: potential });
    }
  }
  return chips;
}
