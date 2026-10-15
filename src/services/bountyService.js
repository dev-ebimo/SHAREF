import { bountyMatches, courseKey } from "./incentiveConfig.js";

// A student who arrives from a "Wanted" request sends its id with the upload permit.
// Returns the bounty id only if it is genuinely usable: open, unexpired, not fully
// paid out, and for the SAME course, resource type and level as the upload (course compared
// ignoring case/spacing; type/level via bountyMatches, which maps the admin's wording to the upload's).
// `target` is { course, type, level }; a bare course string is still accepted (course-only, legacy).
// Anything else returns null and the upload simply proceeds as a normal upload; a stale
// or tampered id must never block someone from contributing. Nothing is paid here:
// payment happens at approval, which re-checks all of this.
export async function resolveBountyForUpload(DB, rawId, target) {
  const t = target && typeof target === "object" ? target : { course: target };
  if (typeof rawId !== "string") return null;
  const id = rawId.trim().slice(0, 64);
  if (!id) return null;
  const row = await DB.prepare(
    "SELECT id, course_key, type, level FROM bounties WHERE id = ? AND status = 'open' AND expires_at > ? AND paid < max_payouts AND course_key = ?"
  )
    .bind(id, new Date().toISOString(), courseKey(t.course))
    .first();
  if (!row) return null;
  if (target && typeof target === "object" && !bountyMatches(row, t)) return null;
  return row.id;
}
