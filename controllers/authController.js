const User = require("../models/User");
const generateOTP = require("../utils/generateOTP");
const generateToken = require("../utils/generateToken");
const sanitizeError = require("../utils/sanitizeError");
const { sendVerificationEmail, sendPasswordResetEmail } = require("../services/emailService");

const OTP_EXPIRY_MINUTES = 10;

// @route POST /api/auth/register
async function register(req, res) {
  try {
    const {
      fullName, email, password, matricNumber,
      university, faculty, department, level, gender, communitySurvey,
    } = req.body;

    const existingUser = await User.findOne({ $or: [{ email }, { matricNumber }] });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: existingUser.email === email
          ? "An account with this email already exists"
          : "An account with this matric number already exists",
      });
    }

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    const user = await User.create({
      fullName, email, password, matricNumber,
      university, faculty, department, level, gender, communitySurvey,
      verificationOTP: otp,
      verificationOTPExpires: otpExpires,
    });

    // Don't let a slow/unreachable email provider block the response or
    // fail an already-successful registration — resend-otp covers the
    // recovery path if this particular email doesn't land.
    sendVerificationEmail(user.email, user.fullName, otp).catch((err) => {
      console.error(`Failed to send verification email to ${user.email}:`, err.message);
    });

    return res.status(201).json({
      success: true,
      message: "Account created. Check your email for a verification code.",
      email: user.email,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Registration failed", error: sanitizeError(err) });
  }
}

// @route POST /api/auth/verify-otp
async function verifyOTP(req, res) {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email }).select("+verificationOTP +verificationOTPExpires");
    if (!user) {
      return res.status(404).json({ success: false, message: "No account found with this email" });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: "Account is already verified" });
    }

    if (!user.verificationOTP || user.verificationOTP !== otp) {
      return res.status(400).json({ success: false, message: "Incorrect verification code" });
    }

    if (user.verificationOTPExpires < new Date()) {
      return res.status(400).json({ success: false, message: "Verification code has expired. Request a new one." });
    }

    user.isVerified = true;
    user.verificationOTP = undefined;
    user.verificationOTPExpires = undefined;
    await user.save();

    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      message: "Account verified successfully",
      token,
      user: {
        id: user._id, fullName: user.fullName, email: user.email, role: user.role,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Verification failed", error: sanitizeError(err) });
  }
}

// @route POST /api/auth/resend-otp
async function resendOTP(req, res) {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "No account found with this email" });
    }
    if (user.isVerified) {
      return res.status(400).json({ success: false, message: "Account is already verified" });
    }

    const otp = generateOTP();
    user.verificationOTP = otp;
    user.verificationOTPExpires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await user.save();

    sendVerificationEmail(user.email, user.fullName, otp).catch((err) => {
      console.error(`Failed to send verification email to ${user.email}:`, err.message);
    });

    return res.status(200).json({ success: true, message: "A new verification code has been sent to your email" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not resend code", error: sanitizeError(err) });
  }
}

// @route POST /api/auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: "Incorrect email or password" });
    }

    if (user.accountStatus === "suspended") {
      return res.status(403).json({
        success: false,
        suspended: true,
        message: "Your account has been suspended. Contact support if you believe this is a mistake.",
        reason: user.suspensionReason || undefined,
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email before logging in",
        unverified: true,
        email: user.email,
      });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id, fullName: user.fullName, email: user.email, role: user.role,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Login failed", error: sanitizeError(err) });
  }
}

const RESET_OTP_EXPIRY_MINUTES = 10;

// @route POST /api/auth/forgot-password
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      // Same response either way — don't reveal whether an email is registered
      return res.status(200).json({
        success: true,
        message: "If an account exists for this email, a reset code has been sent.",
      });
    }

    const otp = generateOTP();
    user.resetPasswordOTP = otp;
    user.resetPasswordOTPExpires = new Date(Date.now() + RESET_OTP_EXPIRY_MINUTES * 60 * 1000);
    await user.save();

    sendPasswordResetEmail(user.email, user.fullName, otp).catch((err) => {
      console.error(`Failed to send password reset email to ${user.email}:`, err.message);
    });

    return res.status(200).json({
      success: true,
      message: "If an account exists for this email, a reset code has been sent.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not process request", error: sanitizeError(err) });
  }
}

// @route POST /api/auth/reset-password
async function resetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;

    const user = await User.findOne({ email }).select("+resetPasswordOTP +resetPasswordOTPExpires");
    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
    }

    if (!user.resetPasswordOTP || user.resetPasswordOTP !== otp) {
      return res.status(400).json({ success: false, message: "Incorrect reset code" });
    }

    if (user.resetPasswordOTPExpires < new Date()) {
      return res.status(400).json({ success: false, message: "Reset code has expired. Request a new one." });
    }

    user.password = newPassword; // pre("save") hook in the model re-hashes this
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpires = undefined;
    await user.save();

    return res.status(200).json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not reset password", error: sanitizeError(err) });
  }
}

module.exports = { register, verifyOTP, resendOTP, login, forgotPassword, resetPassword };