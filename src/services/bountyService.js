import { courseKey } from "./incentiveConfig.js";

// A student who arrives from a "Wanted" request sends its id with the upload permit.
// Returns the bounty id only if it is genuinely usable: open, unexpired, not fully
// paid out, and for the same course as the upload (compared ignoring case/spacing).
// Anything else returns null and the upload simply proceeds as a normal upload; a stale
// or tampered id must never block someone from contributing. Nothing is paid here:
// payment happens at approval, which re-checks all of this.
export async function resolveBountyForUpload(DB, rawId, course) {
  if (typeof rawId !== "string") return null;
  const id = rawId.trim().slice(0, 64);
  if (!id) return null;
  const row = await DB.prepare(
    "SELECT id FROM bounties WHERE id = ? AND status = 'open' AND expires_at > ? AND paid < max_payouts AND course_key = ?"
  )
    .bind(id, new Date().toISOString(), courseKey(course))
    .first();
  return row ? row.id : null;
}
