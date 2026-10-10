// One definition of "how risky is this uploader", shared by the moderation queue (badges)
// and the payout engine (what to do when a quick-approve carries no reward choice), so the
// two can never disagree.
const RANK = { low: 0, medium: 1, high: 2 };

// x: { open_flag, rejected_14d, acct_created, shared_ip }  (plain DB values)
export function uploaderRiskFrom(x, nowMs = Date.now()) {
  const notes = [];
  let level = "low";
  const raise = (to) => { if (RANK[to] > RANK[level]) level = to; };

  if (x.open_flag) { raise("high"); notes.push("Has an open reward flag"); }
  if (x.rejected_14d >= 3) { raise("high"); notes.push(`${x.rejected_14d} uploads rejected in the last 14 days`); }
  else if (x.rejected_14d >= 1) { raise("medium"); notes.push(`${x.rejected_14d} upload${x.rejected_14d > 1 ? "s" : ""} rejected in the last 14 days`); }
  const ageDays = (nowMs - new Date(x.acct_created).getTime()) / 86400000;
  if (Number.isFinite(ageDays) && ageDays < 7) { raise("medium"); notes.push(`Account is ${Math.max(0, Math.floor(ageDays))} day(s) old`); }
  if (x.shared_ip) { raise("medium"); notes.push("Signed up from the same connection as another account"); }
  return { level, notes };
}

export async function loadUploaderRisk(DB, uploaderId, nowMs = Date.now()) {
  const fourteenDaysAgo = new Date(nowMs - 14 * 86400000).toISOString();
  const x = await DB.prepare(
    `SELECT u.created_at AS acct_created,
            (SELECT COUNT(*) FROM resources x WHERE x.uploader_id = u.id AND x.status = 'rejected' AND x.reviewed_at >= ?) AS rejected_14d,
            EXISTS (SELECT 1 FROM incentive_flags f WHERE f.user_id = u.id AND f.status = 'open') AS open_flag,
            EXISTS (SELECT 1 FROM users o WHERE u.signup_ip_hash IS NOT NULL AND o.signup_ip_hash = u.signup_ip_hash AND o.id != u.id) AS shared_ip
       FROM users u WHERE u.id = ?`
  ).bind(fourteenDaysAgo, uploaderId).first();
  return x ? uploaderRiskFrom(x, nowMs) : { level: "low", notes: [] };
}
