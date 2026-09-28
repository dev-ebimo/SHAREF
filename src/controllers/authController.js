import bcrypt from "bcryptjs";
import { generateOTP } from "../utils/otp.js";
import { generateToken } from "../utils/token.js";
import { generateId } from "../utils/id.js";
import { sanitizeError } from "../utils/sanitizeError.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/emailService.js";

const OTP_EXPIRY_MINUTES = 10;
const RESET_OTP_EXPIRY_MINUTES = 10;

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

function nowIso() {
  return new Date().toISOString();
}

function isoPlusMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// @route POST /api/auth/register
export async function register(c) {
  try {
    const { fullName, email, password, matricNumber, university, faculty, department, level, gender, communitySurvey } =
      c.req.valid("json");

    const existingUser = matricNumber
      ? await c.env.DB.prepare("SELECT id, email FROM users WHERE email = ? OR matric_number = ?")
          .bind(email, matricNumber)
          .first()
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

    const otp = generateOTP();
    const otpExpires = isoPlusMinutes(OTP_EXPIRY_MINUTES);
    const id = generateId();
    const hashedPassword = await bcrypt.hash(password, 10);
    const timestamp = nowIso();

    await c.env.DB.prepare(
      `INSERT INTO users
        (id, full_name, email, password, matric_number, university, faculty, department, level, gender,
         community_survey, verification_otp, verification_otp_expires, preferences, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        fullName,
        email,
        hashedPassword,
        matricNumber || null,
        university || null,
        faculty || null,
        department || null,
        level || null,
        gender || null,
        communitySurvey || "",
        otp,
        otpExpires,
        JSON.stringify(DEFAULT_PREFERENCES),
        timestamp,
        timestamp
      )
      .run();

    // Don't let a slow/unreachable email provider block the response or
    // fail an already-successful registration — resend-otp covers the
    // recovery path if this particular email doesn't land. c.executionCtx
    // lets this keep running after the response is sent, same intent as
    // the original's un-awaited .catch()-guarded call.
    c.executionCtx.waitUntil(
      sendVerificationEmail(c.env, email, fullName, otp).catch((err) => {
        console.error(`Failed to send verification email to ${email}:`, err.message);
      })
    );

    return c.json(
      { success: true, message: "Account created. Check your email for a verification code.", email },
      201
    );
  } catch (err) {
    return c.json({ success: false, message: "Registration failed", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/auth/verify-otp
export async function verifyOTP(c) {
  try {
    const { email, otp } = c.req.valid("json");

    const user = await c.env.DB.prepare(
      "SELECT id, role, is_verified, verification_otp, verification_otp_expires, full_name FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (!user) {
      return c.json({ success: false, message: "No account found with this email" }, 404);
    }
    if (user.is_verified) {
      return c.json({ success: false, message: "Account is already verified" }, 400);
    }
    if (!user.verification_otp || user.verification_otp !== otp) {
      return c.json({ success: false, message: "Incorrect verification code" }, 400);
    }
    if (new Date(user.verification_otp_expires) < new Date()) {
      return c.json({ success: false, message: "Verification code has expired. Request a new one." }, 400);
    }

    const timestamp = nowIso();
    await c.env.DB.prepare(
      `UPDATE users
       SET is_verified = 1, verification_otp = NULL, verification_otp_expires = NULL,
           last_login_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(timestamp, timestamp, user.id)
      .run();

    const token = await generateToken(c.env, user.id, user.role);

    return c.json({
      success: true,
      message: "Account verified successfully",
      token,
      user: { id: user.id, fullName: user.full_name, email, role: user.role },
    });
  } catch (err) {
    return c.json({ success: false, message: "Verification failed", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/auth/resend-otp
export async function resendOTP(c) {
  try {
    const { email } = c.req.valid("json");

    const user = await c.env.DB.prepare("SELECT id, full_name, is_verified FROM users WHERE email = ?")
      .bind(email)
      .first();

    if (!user) {
      return c.json({ success: false, message: "No account found with this email" }, 404);
    }
    if (user.is_verified) {
      return c.json({ success: false, message: "Account is already verified" }, 400);
    }

    const otp = generateOTP();
    const otpExpires = isoPlusMinutes(OTP_EXPIRY_MINUTES);

    await c.env.DB.prepare(
      "UPDATE users SET verification_otp = ?, verification_otp_expires = ?, updated_at = ? WHERE id = ?"
    )
      .bind(otp, otpExpires, nowIso(), user.id)
      .run();

    c.executionCtx.waitUntil(
      sendVerificationEmail(c.env, email, user.full_name, otp).catch((err) => {
        console.error(`Failed to send verification email to ${email}:`, err.message);
      })
    );

    return c.json({ success: true, message: "A new verification code has been sent to your email" });
  } catch (err) {
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

    if (!user || !(await bcrypt.compare(password, user.password))) {
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
      return c.json(
        { success: false, message: "Please verify your email before logging in", unverified: true, email },
        403
      );
    }

    await c.env.DB.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .bind(nowIso(), nowIso(), user.id)
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
        // Defensive against a partial/legacy preferences blob (e.g. a
        // pre-migration row missing the nested `moderation` object) —
        // falls back to the same defaults a brand-new user gets, rather
        // than throwing and turning a cosmetic gap into a failed login.
        landingPage: preferences.landingPage ?? DEFAULT_PREFERENCES.landingPage,
        moderationLandingPage: preferences.moderation?.landingPage ?? DEFAULT_PREFERENCES.moderation.landingPage,
      },
    });
  } catch (err) {
    return c.json({ success: false, message: "Login failed", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/auth/forgot-password
export async function forgotPassword(c) {
  try {
    const { email } = c.req.valid("json");
    const genericResponse = { success: true, message: "If an account exists for this email, a reset code has been sent." };

    const user = await c.env.DB.prepare("SELECT id, full_name FROM users WHERE email = ?").bind(email).first();
    if (!user) {
      // Same response either way — don't reveal whether an email is registered
      return c.json(genericResponse);
    }

    const otp = generateOTP();
    const otpExpires = isoPlusMinutes(RESET_OTP_EXPIRY_MINUTES);

    await c.env.DB.prepare(
      "UPDATE users SET reset_password_otp = ?, reset_password_otp_expires = ?, updated_at = ? WHERE id = ?"
    )
      .bind(otp, otpExpires, nowIso(), user.id)
      .run();

    c.executionCtx.waitUntil(
      sendPasswordResetEmail(c.env, email, user.full_name, otp).catch((err) => {
        console.error(`Failed to send password reset email to ${email}:`, err.message);
      })
    );

    return c.json(genericResponse);
  } catch (err) {
    return c.json({ success: false, message: "Could not process request", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/auth/reset-password
export async function resetPassword(c) {
  try {
    const { email, otp, newPassword } = c.req.valid("json");

    const user = await c.env.DB.prepare(
      "SELECT id, reset_password_otp, reset_password_otp_expires FROM users WHERE email = ?"
    )
      .bind(email)
      .first();

    if (!user) {
      return c.json({ success: false, message: "Invalid or expired reset code" }, 400);
    }
    if (!user.reset_password_otp || user.reset_password_otp !== otp) {
      return c.json({ success: false, message: "Incorrect reset code" }, 400);
    }
    if (new Date(user.reset_password_otp_expires) < new Date()) {
      return c.json({ success: false, message: "Reset code has expired. Request a new one." }, 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await c.env.DB.prepare(
      `UPDATE users
       SET password = ?, reset_password_otp = NULL, reset_password_otp_expires = NULL, updated_at = ?
       WHERE id = ?`
    )
      .bind(hashedPassword, nowIso(), user.id)
      .run();

    return c.json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (err) {
    return c.json({ success: false, message: "Could not reset password", error: sanitizeError(c.env, err) }, 500);
  }
}
