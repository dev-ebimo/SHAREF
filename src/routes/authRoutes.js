import { Hono } from "hono";
import { register, verifyOTP, resendOTP, login, forgotPassword, resetPassword } from "../controllers/authController.js";
import {
  validateRegister,
  validateOtp,
  validateForgotPassword,
  validateResetPassword,
  validateLogin,
} from "../validators/authValidators.js";
import { loginLimiter, otpLimiter } from "../middleware/rateLimiter.js";

const authRoutes = new Hono();

authRoutes.post("/register", validateRegister, register);
authRoutes.post("/verify-otp", otpLimiter, validateOtp, verifyOTP);
authRoutes.post("/resend-otp", otpLimiter, validateForgotPassword, resendOTP);
authRoutes.post("/forgot-password", otpLimiter, validateForgotPassword, forgotPassword);
authRoutes.post("/reset-password", otpLimiter, validateResetPassword, resetPassword);
authRoutes.post("/login", loginLimiter, validateLogin, login);

export default authRoutes;
