const rateLimit = require("express-rate-limit");

// Login: brute-force protection against password guessing
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Please try again in 15 minutes." },
});

// OTP endpoints: window matches your OTP_EXPIRY_MINUTES (10 min),
// so the limiter resets roughly in sync with the code itself expiring
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again in 10 minutes." },
});

module.exports = { loginLimiter, otpLimiter };