import { generateOTP, hashOtp, otpMatches } from "../utils/otp.js";
import { generateToken } from "../utils/token.js";
import { generateId } from "../utils/id.js";
import { sanitizeError } from "../utils/sanitizeError.js";
import { hashPassword, verifyPassword, dummyVerify } from "../utils/password.js";
import { invalidateAuthCache } from "../middleware/protect.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/emailService.js";
import { hashIp } from "../utils/ipHash.js";
import { captureReferral, markReferralVerified } from "../services/referralService.js";

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5; // wrong guesses allowed per issued code
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const MAX_FAILED_LOGINS = 10; // per account, then locked for LOCKOUT_MINUTES
const LOCKOUT_MINUTES = 15;

const DEFAULT_PREFERENCES = {
  landingPage: "dashboard",
  moderation: {
    landingPage: "pending",
    itemsPerPage: 25,
    autoOpenNext: true,
    confirmBeforeApproval: false,
    confirmBeforeRejection: true,
  },
  review: { defaultSort: "oldest" },
  notifications: {
    uploadStatus: { email: true, inApp: true },
    announcements: { email: true, inApp: true },
  },
};

const BAD_CODE = { success: false, message: "Incorrect or expired code. Please check it or request a new one." };
const TOO_MANY_CODE_TRIES = { success: false, message: "Too many incorrect attempts. Please request a new code." };

function nowIso() {
  return new Date().toISOString();
}

function isoPlusMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function changed(result) {
  return result?.meta?.changes ?? result?.meta?.rows_written ?? 0;
}

// An OTP's issue time is recoverable from its expiry (expiry = issued + 10 min),
// so the resend cooldown needs no extra column.
function issuedRecently(expiresIso) {
  if (!expiresIso) return false;
  const issuedAtMs = Date.parse(expiresIso) - OTP_EXPIRY_MINUTES * 60 * 1000;
  return Date.now() - issuedAtMs < OTP_RESEND_COOLDOWN_SECONDS * 1000;
}

// @route POST /api/auth/register
export async function register(c) {
  try {
    const { fullName, email, password, matricNumber, university, faculty, department, level, gender, communitySurvey, referralCode } =
      c.req.valid("json");

    const existingUser = matricNumber
      ? await c.env.DB.prepare("SELECT id, email FROM users WHERE email = ? OR matric_number = ?").bind(email, matricNumber).first()
      : await c.env.DB.prepare("SELECT id, email FROM users WHERE email = ?").bind(email).first();

    if (existingUser) {
      return c.json(
        {
          success: false,
          message:
            existingUser.email === email
              ? "An account with this email already exists"
              : "An account with this matric number already exists",
        },
        409
      );
    }

    const id = generateId();
    const otp = generateOTP();
    const otpHash = await hashOtp(c.env, id, "verify", otp);
    const otpExpires = isoPlusMinutes(OTP_EXPIRY_MINUTES);
    const hashedPassword = await hashPassword(c.env, password);
    const timestamp = nowIso();
    // Salted hash only (never the raw IP); lets the reward program spot referral rings later.
    const signupIpHash = await hashIp(c.env, c.req.header("CF-Connecting-IP"));

    await c.env.DB.prepare(
      `INSERT INTO users
        (id, full_name, email, password, matric_number, university, faculty, department, level, gender,
         community_survey, verification_otp, verification_otp_expires, preferences, created_at, updated_at, signup_ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id, fullName, email, hashedPassword, matricNumber || null, university || null, faculty || null,
        department || null, level || null, gender || null, communitySurvey || "", otpHash, otpExpires,
        JSON.stringify(DEFAULT_PREFERENCES), timestamp, timestamp, signupIpHash
      )
      .run();

    // Best effort: a bad or unknown invite code never affects signup (swallows its own errors).
    await captureReferral(c.env.DB, { inviteeId: id, rawCode: referralCode, ts: timestamp });

    c.executionCtx.waitUntil(
      sendVerificationEmail(c.env, email, fullName, otp).catch((err) => {
        console.error(`Failed to send verification email to ${email}:`, err.message);
      })
    );

    return c.json({ success: true, message: "Account created. Check your email for a verification code.", email }, 201);
  } catch (err) {
    console.error("register failed:", err?.message);
    return c.json({ success: false, message: "Registration failed", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/auth/verify-otp
export async function verifyOTP(c) {
  try {
    const { email, otp } = c.req.valid("json");

    const user = await c.env.DB.prepare(
      `SELECT id, role, is_verified, verification_otp, verification_otp_expires, verification_otp_attempts, full_name, account_status
       FROM users WHERE email = ?`
    )
      .bind(email)
      .first();

    // One identical answer for: no such account, already verified, no live
    // code, expired — so this endpoint can't be used to probe which emails exist.
    if (!user || user.is_verified || !user.verification_otp || new Date(user.verification_otp_expires) < new Date()) {
      return c.json(BAD_CODE, 400);
    }

    // Reserve a guess BEFORE comparing. The cap is enforced by the WHERE clause
    // inside the database, so parallel requests (even across isolates) can't
    // exceed MAX_OTP_ATTEMPTS guesses in total.
    const reserved = await c.env.DB.prepare(
      `UPDATE users SET verification_otp_attempts = verification_otp_attempts + 1
        WHERE id = ? AND verification_otp IS NOT NULL AND verification_otp_attempts < ?`
    )
      .bind(user.id, MAX_OTP_ATTEMPTS)
      .run();
    if (changed(reserved) === 0) return c.json(TOO_MANY_CODE_TRIES, 429);

    if (!(await otpMatches(c.env, user.id, "verify", otp, user.verification_otp))) {
      if (user.verification_otp_attempts + 1 >= MAX_OTP_ATTEMPTS) {
        await c.env.DB.prepare("UPDATE users SET verification_otp = NULL, verification_otp_expires = NULL WHERE id = ?").bind(user.id).run();
      }
      return c.json(BAD_CODE, 400);
    }

    const timestamp = nowIso();
    await c.env.DB.prepare(
      `UPDATE users
       SET is_verified = 1, verification_otp = NULL, verification_otp_expires = NULL, verification_otp_attempts = 0,
           last_login_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(timestamp, timestamp, user.id)
      .run();

    // Referral bookkeeping only (signed_up -> verified); pays nothing and never throws.
    await markReferralVerified(c.env.DB, user.id, timestamp);

    if (user.account_status === "suspended") {
      return c.json({ success: false, suspended: true, message: "Your account has been suspended. Contact support if you believe this is a mistake." }, 403);
    }

    const token = await generateToken(c.env, user.id, user.role);
    return c.json({
      success: true,
      message: "Account verified successfully",
      token,
      user: { id: user.id, fullName: user.full_name, email, role: user.role },
    });
  } catch (err) {
    console.error("verifyOTP failed:", err?.message);
    return c.json({ success: false, message: "Verification failed", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/auth/resend-otp
export async function resendOTP(c) {
  // Same answer whether or not the account exists / is already verified /
  // is inside the cooldown — nothing here reveals account state.
  const generic = { success: true, message: "If this account is awaiting verification, a new code has been sent to its email." };
  try {
    const { email } = c.req.valid("json");

    const user = await c.env.DB.prepare(
      "SELECT id, full_name, is_verified, verification_otp, verification_otp_expires FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (!user || user.is_verified) return c.json(generic);
    if (user.verification_otp && issuedRecently(user.verification_otp_expires)) return c.json(generic);

    const otp = generateOTP();
    const otpHash = await hashOtp(c.env, user.id, "verify", otp);

    await c.env.DB.prepare(
      `UPDATE users SET verification_otp = ?, verification_otp_expires = ?, verification_otp_attempts = 0, updated_at = ? WHERE id = ?`
    )
      .bind(otpHash, isoPlusMinutes(OTP_EXPIRY_MINUTES), nowIso(), user.id)
      .run();

    c.executionCtx.waitUntil(
      sendVerificationEmail(c.env, email, user.full_name, otp).catch((err) => {
        console.error(`Failed to send verification email to ${email}:`, err.message);
      })
    );

    return c.json(generic);
  } catch (err) {
    console.error("resendOTP failed:", err?.message);
    return c.json({ success: false, message: "Could not resend code", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/auth/login
export async function login(c) {
  try {
    const { email, password } = c.req.valid("json");

    const user = await c.env.DB.prepare(
      `SELECT id, role, password, account_status, suspension_reason, is_verified, full_name, preferences
       FROM users WHERE email = ?`
    )
      .bind(email)
      .first();

    if (!user) {
      await dummyVerify(c.env, password); // equalise timing with the "wrong password" path
      return c.json({ success: false, message: "Incorrect email or password" }, 401);
    }

    // Reserve a login attempt atomically BEFORE doing any expensive hashing.
    // If the account is currently locked this changes 0 rows and we return
    // without spending CPU. The counter lives in D1, so parallel requests and
    // multiple isolates all share it (the in-memory IP limiter can't do that).
    const now = nowIso();
    const lockedUntil = isoPlusMinutes(LOCKOUT_MINUTES);
    const reserved = await c.env.DB.prepare(
      `UPDATE users SET
         failed_logins = CASE WHEN lockout_until IS NOT NULL AND lockout_until <= ? THEN 1 ELSE failed_logins + 1 END,
         lockout_until = CASE
           WHEN (CASE WHEN lockout_until IS NOT NULL AND lockout_until <= ? THEN 1 ELSE failed_logins + 1 END) >= ? THEN ?
           ELSE NULL END
       WHERE id = ? AND (lockout_until IS NULL OR lockout_until <= ?)`
    )
      .bind(now, now, MAX_FAILED_LOGINS, lockedUntil, user.id, now)
      .run();

    if (changed(reserved) === 0) {
      return c.json(
        { success: false, locked: true, message: `Too many failed attempts. Please try again in ${LOCKOUT_MINUTES} minutes or reset your password.` },
        429
      );
    }

    const { ok, needsRehash } = await verifyPassword(c.env, password, user.password);
    if (!ok) {
      return c.json({ success: false, message: "Incorrect email or password" }, 401);
    }

    if (user.account_status === "suspended") {
      return c.json(
        {
          success: false,
          suspended: true,
          message: "Your account has been suspended. Contact support if you believe this is a mistake.",
          reason: user.suspension_reason || undefined,
        },
        403
      );
    }

    if (!user.is_verified) {
      return c.json({ success: false, message: "Please verify your email before logging in", unverified: true, email }, 403);
    }

    // Success: clear the throttle, stamp last login, and (once per legacy
    // account) upgrade the stored hash from bcrypt to PBKDF2.
    const newHash = needsRehash ? await hashPassword(c.env, password) : null;
    const ts = nowIso();
    await c.env.DB.prepare(
      `UPDATE users SET last_login_at = ?, updated_at = ?, failed_logins = 0, lockout_until = NULL,
              password = COALESCE(?, password)
       WHERE id = ?`
    )
      .bind(ts, ts, newHash, user.id)
      .run();

    const token = await generateToken(c.env, user.id, user.role);
    const preferences = JSON.parse(user.preferences || "{}");

    return c.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email,
        role: user.role,
        landingPage: preferences.landingPage ?? DEFAULT_PREFERENCES.landingPage,
        moderationLandingPage: preferences.moderation?.landingPage ?? DEFAULT_PREFERENCES.moderation.landingPage,
      },
    });
  } catch (err) {
    console.error("login failed:", err?.message);
    return c.json({ success: false, message: "Login failed", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/auth/forgot-password
export async function forgotPassword(c) {
  const genericResponse = { success: true, message: "If an account exists for this email, a reset code has been sent." };
  try {
    const { email } = c.req.valid("json");

    const user = await c.env.DB.prepare(
      "SELECT id, full_name, reset_password_otp, reset_password_otp_expires FROM users WHERE email = ?"
    )
      .bind(email)
      .first();
    if (!user) return c.json(genericResponse);
    // Cooldown: silently skip (same response) so an attacker can't use this
    // endpoint to spam a victim's inbox or to tell accounts apart.
    if (user.reset_password_otp && issuedRecently(user.reset_password_otp_expires)) return c.json(genericResponse);

    const otp = generateOTP();
    const otpHash = await hashOtp(c.env, user.id, "reset", otp);

    await c.env.DB.prepare(
      `UPDATE users SET reset_password_otp = ?, reset_password_otp_expires = ?, reset_password_otp_attempts = 0, updated_at = ? WHERE id = ?`
    )
      .bind(otpHash, isoPlusMinutes(OTP_EXPIRY_MINUTES), nowIso(), user.id)
      .run();

    c.executionCtx.waitUntil(
      sendPasswordResetEmail(c.env, email, user.full_name, otp).catch((err) => {
        console.error(`Failed to send password reset email to ${email}:`, err.message);
      })
    );

    return c.json(genericResponse);
  } catch (err) {
    console.error("forgotPassword failed:", err?.message);
    return c.json({ success: false, message: "Could not process request", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/auth/reset-password
export async function resetPassword(c) {
  try {
    const { email, otp, newPassword } = c.req.valid("json");

    const user = await c.env.DB.prepare(
      "SELECT id, reset_password_otp, reset_password_otp_expires, reset_password_otp_attempts FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (!user || !user.reset_password_otp || new Date(user.reset_password_otp_expires) < new Date()) {
      return c.json(BAD_CODE, 400);
    }

    const reserved = await c.env.DB.prepare(
      `UPDATE users SET reset_password_otp_attempts = reset_password_otp_attempts + 1
        WHERE id = ? AND reset_password_otp IS NOT NULL AND reset_password_otp_attempts < ?`
    )
      .bind(user.id, MAX_OTP_ATTEMPTS)
      .run();
    if (changed(reserved) === 0) return c.json(TOO_MANY_CODE_TRIES, 429);

    if (!(await otpMatches(c.env, user.id, "reset", otp, user.reset_password_otp))) {
      if (user.reset_password_otp_attempts + 1 >= MAX_OTP_ATTEMPTS) {
        await c.env.DB.prepare("UPDATE users SET reset_password_otp = NULL, reset_password_otp_expires = NULL WHERE id = ?").bind(user.id).run();
      }
      return c.json(BAD_CODE, 400);
    }

    const hashedPassword = await hashPassword(c.env, newPassword);
    const ts = nowIso();

    // password_changed_at invalidates every session issued before now (a
    // stolen token dies with the old password). The login throttle is also
    // cleared: owning the email proves identity, so a locked-out owner can recover.
    await c.env.DB.prepare(
      `UPDATE users
       SET password = ?, reset_password_otp = NULL, reset_password_otp_expires = NULL, reset_password_otp_attempts = 0,
           password_changed_at = ?, failed_logins = 0, lockout_until = NULL, updated_at = ?
       WHERE id = ?`
    )
      .bind(hashedPassword, ts, ts, user.id)
      .run();
    invalidateAuthCache(user.id);

    return c.json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (err) {
    console.error("resetPassword failed:", err?.message);
    return c.json({ success: false, message: "Could not reset password", error: sanitizeError(c.env, err) }, 500);
  }
}
