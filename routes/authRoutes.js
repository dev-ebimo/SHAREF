const express = require("express");
const router = express.Router();

const { register, verifyOTP, resendOTP, login, forgotPassword, resetPassword } = require("../controllers/authController");
const { registerValidator, loginValidator, otpValidator, forgotPasswordValidator, resetPasswordValidator } = require("../validators/authValidator");
const validateRequest = require("../middleware/validateRequest");
const { loginLimiter, otpLimiter } = require("../middleware/rateLimiter");

router.post("/register", registerValidator, validateRequest, register);
router.post("/verify-otp", otpLimiter, otpValidator, validateRequest, verifyOTP);
router.post("/resend-otp", otpLimiter, forgotPasswordValidator, validateRequest, resendOTP);
router.post("/forgot-password", otpLimiter, forgotPasswordValidator, validateRequest, forgotPassword);
router.post("/reset-password", otpLimiter, resetPasswordValidator, validateRequest, resetPassword);
router.post("/login", loginLimiter, loginValidator, validateRequest, login);

module.exports = router;