import { generateOTP, hashOtp } from "../utils/otp.js";
import { incentiveCascadeForUser } from "../services/referralService.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { generateToken } from "../utils/token.js";
import { sanitizeError } from "../utils/sanitizeError.js";
import { generateId } from "../utils/id.js";
import { sendVerificationEmail } from "../services/emailService.js";
import { deleteFromCloudinary } from "../utils/cloudinaryUpload.js";
import { invalidateAuthCache } from "../middleware/protect.js";

const OTP_EXPIRY_MINUTES = 10;

function nowIso() {
  return new Date().toISOString();
}

function filterPreferencesForRole(preferences, role) {
  const filtered = { ...preferences };
  if (role !== "admin") {
    delete filtered.moderation;
    delete filtered.review;
  }
  return filtered;
}

// @route GET /api/users/me
export async function getMyProfile(c) {
  try {
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(c.get("user").id).first();
    if (!user) return c.json({ success: false, message: "User not found" }, 404);

    const preferences = filterPreferencesForRole(JSON.parse(user.preferences || "{}"), user.role);

    return c.json({
      success: true,
      user: {
        id: user.id, fullName: user.full_name, email: user.email, isVerified: !!user.is_verified,
        matricNumber: user.matric_number, university: user.university, faculty: user.faculty,
        department: user.department, level: user.level, gender: user.gender, role: user.role,
        preferences,
      },
    });
  } catch (err) {
    console.error("userSettingsController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch profile", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route PATCH /api/users/me
export async function updateMyProfile(c) {
  try {
    const body = await c.req.json();
    const { fullName, email, department, level, university, faculty, matricNumber, gender } = body;
    const userId = c.get("user").id;

    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
    if (!user) return c.json({ success: false, message: "User not found" }, 404);

    if (matricNumber && matricNumber !== user.matric_number) {
      const existing = await c.env.DB.prepare("SELECT id FROM users WHERE matric_number = ? AND id != ?").bind(matricNumber, userId).first();
      if (existing) return c.json({ success: false, message: "That matric number is already registered to another account" }, 409);
    }

    let emailChanged = false;
    let otp = null;
    let otpHash = null;
    if (email && email !== user.email) {
      const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ? AND id != ?").bind(email, userId).first();
      if (existing) return c.json({ success: false, message: "That email is already in use" }, 409);
      emailChanged = true;
      otp = generateOTP();
      otpHash = await hashOtp(c.env, userId, "verify", otp);
    }

    const timestamp = nowIso();
    await c.env.DB.prepare(
      `UPDATE users SET
        full_name = ?, department = ?, level = ?, university = ?, faculty = ?, gender = ?, matric_number = ?,
        email = ?, is_verified = ?, verification_otp = ?, verification_otp_expires = ?, verification_otp_attempts = 0, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        fullName || user.full_name,
        department || user.department,
        level || user.level,
        university || user.university,
        faculty || user.faculty,
        gender || user.gender,
        matricNumber || user.matric_number,
        emailChanged ? email : user.email,
        emailChanged ? 0 : user.is_verified,
        emailChanged ? otpHash : user.verification_otp,
        emailChanged ? new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString() : user.verification_otp_expires,
        timestamp,
        userId
      )
      .run();

    if (emailChanged) {
      c.executionCtx.waitUntil(
        sendVerificationEmail(c.env, email, fullName || user.full_name, otp).catch((err) => {
          console.error(`Failed to send verification email to ${email}:`, err.message);
        })
      );
    }

    return c.json({
      success: true,
      message: emailChanged
        ? "Profile updated. Your new email needs verification — check your inbox for a code."
        : "Profile updated successfully",
      emailChanged,
    });
  } catch (err) {
    console.error("userSettingsController error:", err?.message);
    return c.json({ success: false, message: "Could not update profile", error: sanitizeError(c.env, err) }, 500);
  }
}

// Keys that must never be merged: JSON.parse() turns "__proto__" in a
// request body into a real own enumerable property, so a for...in loop
// will hand it to the assignment below, where `target["__proto__"] = x`
// triggers the prototype setter and pollutes Object.prototype for the
// whole process — not just this request. "constructor"/"prototype" are
// blocked for the same class of reason. (Ported verbatim from the
// original — this guard is unrelated to Node vs. Workers and applies
// exactly the same way in both.)
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function deepMerge(target, source) {
  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (BLOCKED_KEYS.has(key)) continue;
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      target[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// @route PATCH /api/users/me/preferences
// Accepts a partial preferences object and deep-merges it, so the frontend
// only needs to send whichever section changed (e.g. just `notifications`).
export async function updateMyPreferences(c) {
  try {
    const user = c.get("user");
    const body = await c.req.json();
    const incoming = body.preferences || {};
    // Bound what a user can park in their own row (and make us re-parse on every login/announcement).
    if (typeof incoming !== "object" || Array.isArray(incoming) || JSON.stringify(incoming).length > 4096) {
      return c.json({ success: false, message: "Preferences payload is invalid or too large" }, 400);
    }

    if (user.role !== "admin") {
      delete incoming.moderation;
      delete incoming.review;
    }

    const row = await c.env.DB.prepare("SELECT preferences FROM users WHERE id = ?").bind(user.id).first();
    if (!row) return c.json({ success: false, message: "User not found" }, 404);

    const current = JSON.parse(row.preferences || "{}");
    const merged = deepMerge(current, incoming);

    await c.env.DB.prepare("UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(merged), nowIso(), user.id)
      .run();

    return c.json({ success: true, message: "Preferences saved", preferences: filterPreferencesForRole(merged, user.role) });
  } catch (err) {
    console.error("userSettingsController error:", err?.message);
    return c.json({ success: false, message: "Could not save preferences", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route PATCH /api/users/me/password
export async function changeMyPassword(c) {
  try {
    const { currentPassword, newPassword } = c.req.valid("json");
    const userId = c.get("user").id;

    const user = await c.env.DB.prepare("SELECT password, role FROM users WHERE id = ?").bind(userId).first();
    if (!user) return c.json({ success: false, message: "User not found" }, 404);

    const { ok } = await verifyPassword(c.env, currentPassword, user.password);
    if (!ok) return c.json({ success: false, message: "Current password is incorrect" }, 401);

    const hashedPassword = await hashPassword(c.env, newPassword);
    const ts = nowIso();
    // password_changed_at logs out every OTHER session (including a thief's).
    await c.env.DB.prepare("UPDATE users SET password = ?, password_changed_at = ?, updated_at = ? WHERE id = ?")
      .bind(hashedPassword, ts, ts, userId)
      .run();
    invalidateAuthCache(userId);

    // Hand THIS session a fresh token so the user who just changed their
    // password isn't kicked out by the very invalidation that protects them.
    // (The iat is >= password_changed_at's second, so it is accepted.)
    const token = await generateToken(c.env, userId, user.role);
    return c.json({ success: true, message: "Password updated successfully", token });
  } catch (err) {
    console.error("changeMyPassword failed:", err?.message);
    return c.json({ success: false, message: "Could not change password", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route DELETE /api/users/me
export async function deleteMyAccount(c) {
  const userId = c.get("user").id;
  try {
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
    if (!user) return c.json({ success: false, message: "User not found" }, 404);

    const { results: userResources } = await c.env.DB.prepare("SELECT * FROM resources WHERE uploader_id = ?").bind(userId).all();

    // Only successful transactions count toward these totals — matches
    // the same logic used for the admin-facing per-user totals in
    // adminUserController.js's getUserProfile.
    const [depositRow, purchaseRow] = await Promise.all([
      c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'successful'").bind(userId).first(),
      c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ? AND type = 'purchase' AND status = 'successful'").bind(userId).first(),
    ]);

    // The User row is about to be permanently deleted — capture
    // everything an admin might need to see later before it's gone.
    // Log + admin-feed notification are written together, atomically:
    // either both exist or neither does.
    const logId = generateId();
    const notifId = generateId();
    const timestamp = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO deleted_account_logs
          (id, full_name, email, matric_number, university, department, level, account_status, joined_at,
           wallet_balance_at_deletion, uploads_count, total_deposited, total_spent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        logId, user.full_name, user.email, user.matric_number || "", user.university || "", user.department || "",
        user.level || "", user.account_status, user.created_at, user.wallet_balance, userResources.length,
        depositRow.total, purchaseRow.total, timestamp
      ),
      c.env.DB.prepare(
        "INSERT INTO notifications (id, deleted_account_log_id, recipient_id, type, unread, created_at, updated_at) VALUES (?, ?, NULL, 'account_deleted', 1, ?, ?)"
      ).bind(notifId, logId, timestamp, timestamp),
    ]);

    // Cloudinary deletions run in parallel batches rather than strictly
    // one-at-a-time, so a user with many uploads doesn't turn into that
    // many sequential network round-trips before their deletion request
    // returns. Each failure is caught individually — one rejected call
    // must not abort the whole handler and leave the account
    // half-deleted (snapshot and notification already written, but the
    // user and their resources still present).
    const destroyJobs = [];
    for (const r of userResources) {
      destroyJobs.push({ id: r.cloudinary_public_id, type: r.cloudinary_resource_type || "raw" });
      if (r.preview_image_public_id) {
        destroyJobs.push({ id: r.preview_image_public_id, type: "image" });
      }
    }
    const CLOUDINARY_BATCH_SIZE = 10;
    for (let i = 0; i < destroyJobs.length; i += CLOUDINARY_BATCH_SIZE) {
      const batch = destroyJobs.slice(i, i + CLOUDINARY_BATCH_SIZE);
      await Promise.all(
        batch.map((job) =>
          deleteFromCloudinary(c.env, job.id, job.type).catch((destroyErr) =>
            console.error(`Could not delete Cloudinary asset ${job.id}:`, destroyErr.message)
          )
        )
      );
    }

    // The full D1-side cascade, as one atomic batch. Order matters within
    // it: the resource-children cleanup and reviewed_by/created_by
    // detachment all run BEFORE the rows they reference are deleted, so
    // their subqueries still see the not-yet-deleted data.
    //
    // - bookmarks/download_logs (both this user's own AND any belonging
    //   to resources they uploaded): deleted outright — NOT NULL foreign
    //   keys, and this is usage data, not a financial or audit record.
    // - transactions.user_id and resources.reviewed_by/announcements.
    //   created_by: nulled, not deleted — these are real financial/audit
    //   history that outlives the account (see the schema.sql comments
    //   added alongside this phase for why those two columns are
    //   nullable at all).
    // - notifications: TWO different meanings of resource_id/recipient_id
    //   being involved makes these NOT symmetric. A notification about a
    //   resource this user uploaded gets its resource_id nulled (same as
    //   permanentlyDeleteResource — preserve the notification, detach the
    //   resource). A notification this user RECEIVED gets DELETED outright
    //   rather than having recipient_id nulled — recipient_id IS NULL is
    //   this schema's actual sentinel for "shared admin feed" (see
    //   schema.sql), so nulling it would make a deleted user's old
    //   notifications incorrectly reappear there.
    // Reward-program rows reference users/resources: detach or remove them first so
    // this deletion can never fail on a foreign key (see referralService.js).
    const incentive = incentiveCascadeForUser(c.env.DB, userId);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM bookmarks WHERE resource_id IN (SELECT id FROM resources WHERE uploader_id = ?)").bind(userId),
      c.env.DB.prepare("DELETE FROM download_logs WHERE resource_id IN (SELECT id FROM resources WHERE uploader_id = ?)").bind(userId),
      c.env.DB.prepare("UPDATE transactions SET resource_id = NULL WHERE resource_id IN (SELECT id FROM resources WHERE uploader_id = ?)").bind(userId),
      c.env.DB.prepare("UPDATE notifications SET resource_id = NULL, updated_at = ? WHERE resource_id IN (SELECT id FROM resources WHERE uploader_id = ?)").bind(timestamp, userId),
      ...incentive.beforeResources,
      c.env.DB.prepare("DELETE FROM resources WHERE uploader_id = ?").bind(userId),

      c.env.DB.prepare("DELETE FROM bookmarks WHERE user_id = ?").bind(userId),
      c.env.DB.prepare("DELETE FROM download_logs WHERE user_id = ?").bind(userId),
      c.env.DB.prepare("DELETE FROM notifications WHERE recipient_id = ?").bind(userId),
      c.env.DB.prepare("UPDATE transactions SET user_id = NULL WHERE user_id = ?").bind(userId),
      c.env.DB.prepare("UPDATE resources SET reviewed_by = NULL WHERE reviewed_by = ?").bind(userId),
      c.env.DB.prepare("UPDATE announcements SET created_by = NULL WHERE created_by = ?").bind(userId),

      ...incentive.beforeUser,
      c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    ]);

    invalidateAuthCache(userId);

    return c.json({ success: true, message: "Account and all associated data deleted" });
  } catch (err) {
    console.error("userSettingsController error:", err?.message);
    return c.json({ success: false, message: "Could not delete account", error: sanitizeError(c.env, err) }, 500);
  }
}
