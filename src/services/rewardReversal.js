import { generateId } from "../utils/id.js";

// Statements that take ONE reward back, built for use inside a single D1 batch
// (which SQLite runs as one atomic transaction).
//
// Order matters and is what makes this safe against races and double-clicks:
//   1-2. adjust the student's balance, but ONLY if the ledger row is currently in
//        the matching state (pending -> reward_pending, cleared -> reward_balance).
//        These run BEFORE the status flips, so they can read the old state.
//   3.   flip the row to 'reversed' (conditional on it still being pending/cleared).
//   4.   write the negative reversal row, but ONLY if step 3 really happened in this
//        very batch (matched by this request's timestamp + admin).
//   5.   optional audit row, under the same guard.
// If the row was already reversed, steps 1-5 are all no-ops (and the unique index on
// reverses_id is the hard backstop against a second reversal row).
//
// reward_balance has no >= 0 check on purpose: if the student already spent the
// reward, the reversal may drive it negative, which blocks further downloads until
// they top up (that rule lives in the charge flow).
export function reversalStatements(DB, row, { adminId, adminName, reason, ts, audit = null }) {
  const amount = Math.abs(Number(row.amount));
  const reversedGuard =
    "EXISTS (SELECT 1 FROM reward_ledger WHERE id = ? AND status = 'reversed' AND reversed_at = ? AND reversed_by = ?)";
  const guardArgs = [row.id, ts, adminId];

  const statements = [
    DB.prepare(
      `UPDATE users SET reward_pending = reward_pending - ?, updated_at = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM reward_ledger WHERE id = ? AND status = 'pending')`
    ).bind(amount, ts, row.user_id, row.id),
    DB.prepare(
      `UPDATE users SET reward_balance = reward_balance - ?, updated_at = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM reward_ledger WHERE id = ? AND status = 'cleared')`
    ).bind(amount, ts, row.user_id, row.id),
    DB.prepare(
      `UPDATE reward_ledger SET status = 'reversed', reversed_at = ?, reversed_by = ?, reversal_reason = ?
        WHERE id = ? AND status IN ('pending','cleared')`
    ).bind(ts, adminId, reason, row.id),
    DB.prepare(
      `INSERT INTO reward_ledger
         (id, user_id, type, amount, status, tier, label, resource_id, bounty_id, referral_id, approved_by, note,
          reversed_at, reversed_by, reversal_reason, reverses_id, created_at)
       SELECT ?, ?, 'reversal', ?, 'reversed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ${reversedGuard}`
    ).bind(
      generateId(), row.user_id, -amount, row.tier, `Reversed: ${row.label || "reward"}`.slice(0, 200), row.resource_id,
      row.bounty_id ?? null, row.referral_id ?? null, adminId, reason, ts, adminId, reason, row.id, ts,
      ...guardArgs
    ),
  ];

  // Taking back a request's reward frees that slot again (the need is still unmet), and taking back a
  // referral reward reduces what the inviter shows as earned from that friend. Both only fire if the
  // reversal above really happened in this batch.
  if (row.tier === "bounty" && row.bounty_id) {
    statements.push(
      DB.prepare(
        `UPDATE bounties SET paid = MAX(paid - 1, 0), status = CASE WHEN status = 'fulfilled' THEN 'open' ELSE status END, updated_at = ?
          WHERE id = ? AND ${reversedGuard}`
      ).bind(ts, row.bounty_id, ...guardArgs)
    );
  }
  if (row.tier === "referral" && row.referral_id) {
    statements.push(
      DB.prepare(`UPDATE referrals SET earned = MAX(earned - ?, 0), updated_at = ? WHERE id = ? AND ${reversedGuard}`)
        .bind(amount, ts, row.referral_id, ...guardArgs)
    );
  }

  if (audit) {
    statements.push(
      DB.prepare(
        `INSERT INTO incentive_audit (id, admin_id, admin_name, action, detail, created_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE ${reversedGuard}`
      ).bind(generateId(), adminId, adminName, audit.action, String(audit.detail).slice(0, 1000), ts, ...guardArgs)
    );
  }
  return statements;
}

const CHUNK = 8; // rewards per atomic batch (5 statements each = 40; kept modest, see CLEAR_LIMITS in jobs/incentiveJobs.js)

// Reverses every reward still pending/cleared that was paid for one resource. Used when an approved
// resource is later removed (duplicate / wrong / bad): the reward was paid for an approval that was
// a mistake, so it is taken back automatically, with the moderator's removal reason on the record.
// Returns { count, total }. Safe to call twice (already-reversed rows are skipped).
export async function reverseRewardsForResource(DB, { resourceId, adminId, adminName, reason, ts }) {
  const { results: rows } = await DB.prepare(
    `SELECT id, user_id, amount, tier, label, resource_id, bounty_id, referral_id FROM reward_ledger
      WHERE resource_id = ? AND type = 'reward' AND status IN ('pending','cleared') AND user_id IS NOT NULL ORDER BY created_at`
  ).bind(resourceId).all();
  if (rows.length === 0) return { count: 0, total: 0 };

  for (let i = 0; i < rows.length; i += CHUNK) {
    await DB.batch(rows.slice(i, i + CHUNK).flatMap((row) => reversalStatements(DB, row, { adminId, adminName, reason, ts })));
  }
  const done = await DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM reward_ledger WHERE resource_id = ? AND type = 'reward' AND reversed_at = ? AND reversed_by = ?"
  ).bind(resourceId, ts, adminId).first();
  if (done.n > 0) {
    await DB.prepare("INSERT INTO incentive_audit (id, admin_id, admin_name, action, detail, created_at) VALUES (?, ?, ?, 'auto-reverse', ?, ?)")
      .bind(generateId(), adminId, adminName, `Resource removed: reversed ${done.n} reward(s) totalling ₦${Math.round(done.total).toLocaleString("en-NG")}. Reason: ${reason}`.slice(0, 1000), ts)
      .run();
  }
  return { count: done.n, total: done.total };
}
