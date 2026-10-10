import { generateId } from "../utils/id.js";

// Unambiguous characters only (no 0/O, 1/I): 32 symbols, so a random byte maps with no bias.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-Za-z0-9_-]{4,24}$/;

export function normalizeReferralCode(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return CODE_RE.test(trimmed) ? trimmed.toUpperCase() : null;
}

function randomCode(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

// Returns the student's referral code, creating it on first use. The UPDATE is
// conditional (referral_code IS NULL), so two concurrent first calls can't give
// one student two codes; a rare UNIQUE collision just retries with a new code.
export async function ensureReferralCode(DB, userId) {
  const existing = await DB.prepare("SELECT referral_code FROM users WHERE id = ?").bind(userId).first();
  if (!existing) return null;
  if (existing.referral_code) return existing.referral_code;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await DB.prepare("UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL").bind(randomCode(), userId).run();
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(String(err?.message))) continue;
      throw err;
    }
    const row = await DB.prepare("SELECT referral_code FROM users WHERE id = ?").bind(userId).first();
    if (row?.referral_code) return row.referral_code;
  }
  return null;
}

// Called right after a successful signup. BEST EFFORT: an unknown, malformed or
// ineligible code must never block or fail registration, so this swallows everything.
// Only an active, verified inviter counts, and nobody can invite themselves.
export async function captureReferral(DB, { inviteeId, rawCode, ts }) {
  try {
    const code = normalizeReferralCode(rawCode);
    if (!code) return null;
    const inviter = await DB.prepare(
      "SELECT id FROM users WHERE referral_code = ? AND is_verified = 1 AND account_status = 'active' AND id != ?"
    )
      .bind(code, inviteeId)
      .first();
    if (!inviter) return null;

    const id = generateId();
    await DB.batch([
      DB.prepare("UPDATE users SET referred_by = ? WHERE id = ?").bind(inviter.id, inviteeId),
      DB.prepare(
        "INSERT INTO referrals (id, inviter_id, invitee_id, status, earned, created_at, updated_at) VALUES (?, ?, ?, 'signed_up', 0, ?, ?)"
      ).bind(id, inviter.id, inviteeId, ts, ts),
    ]);
    return id;
  } catch (err) {
    console.error("captureReferral failed (ignored):", err?.message);
    return null;
  }
}

// signed_up -> verified, when the invitee confirms their email. Data only; pays nothing.
export async function markReferralVerified(DB, inviteeId, ts) {
  try {
    await DB.prepare("UPDATE referrals SET status = 'verified', updated_at = ? WHERE invitee_id = ? AND status = 'signed_up'")
      .bind(ts, inviteeId)
      .run();
  } catch (err) {
    console.error("markReferralVerified failed (ignored):", err?.message);
  }
}

// Statements for the account/resource deletion cascades (see userSettingsController
// and adminResourceController). The new tables reference users/resources, so without
// these a deletion would start failing with a foreign-key error once rows exist.
export function incentiveCascadeForUser(DB, userId) {
  return {
    // Run BEFORE the user's resources are deleted: keep the ledger row, detach the resource.
    beforeResources: [
      DB.prepare("UPDATE reward_ledger SET resource_id = NULL WHERE resource_id IN (SELECT id FROM resources WHERE uploader_id = ?)").bind(userId),
    ],
    // Run BEFORE the user row is deleted.
    beforeUser: [
      DB.prepare("UPDATE reward_ledger SET user_id = NULL WHERE user_id = ?").bind(userId), // financial history outlives the account
      DB.prepare("DELETE FROM referrals WHERE inviter_id = ? OR invitee_id = ?").bind(userId, userId),
      DB.prepare("DELETE FROM incentive_flags WHERE user_id = ?").bind(userId),
      DB.prepare("UPDATE users SET referred_by = NULL WHERE referred_by = ?").bind(userId),
    ],
  };
}

export function incentiveCascadeForResource(DB, resourceId) {
  return [DB.prepare("UPDATE reward_ledger SET resource_id = NULL WHERE resource_id = ?").bind(resourceId)];
}
