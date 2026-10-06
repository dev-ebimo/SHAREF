import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { normalizeEmail } from "../utils/normalizeEmail.js";

// express-validator's `.optional({ checkFalsy: true })` treats an empty
// string as "not provided" — this reproduces that for matricNumber,
// university, faculty, department, level, gender.
const optionalTrimmed = () =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().optional()
  );

const emailField = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Please enter a valid email address")
  .transform(normalizeEmail);

const otpField = z
  .string()
  .trim()
  .min(1, "OTP is required")
  .length(6, "OTP must be 6 digits");

export const registerSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  email: emailField,
  password: z.string().min(1, "Password is required").min(8, "Password must be at least 8 characters"),
  matricNumber: optionalTrimmed(),
  university: optionalTrimmed(),
  faculty: optionalTrimmed(),
  department: optionalTrimmed(),
  level: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(["100", "200", "300", "400", "500", "600"], { message: "Please select a valid level" }).optional()
  ),
  gender: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(["Male", "Female", "Other"], { message: "Please select a valid gender" }).optional()
  ),
  communitySurvey: z.string().trim().optional(),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required"),
});

export const otpSchema = z.object({
  email: emailField,
  otp: otpField,
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  email: emailField,
  otp: otpField,
  newPassword: z.string().min(1, "New password is required").min(8, "Password must be at least 8 characters"),
});

// Shared error hook — reproduces the original validateRequest.js response
// shape exactly: { success: false, errors: [{ field, message }] }.
// (The original's other job — deleting orphaned multer uploads on a failed
// validation — doesn't apply here: Workers has no disk, uploads are handled
// via request.formData() in memory, nothing to clean up.)
function validationErrorHook(result, c) {
  if (!result.success) {
    return c.json(
      {
        success: false,
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      400
    );
  }
}

export const validateRegister = zValidator("json", registerSchema, validationErrorHook);
export const validateLogin = zValidator("json", loginSchema, validationErrorHook);
export const validateOtp = zValidator("json", otpSchema, validationErrorHook);
export const validateForgotPassword = zValidator("json", forgotPasswordSchema, validationErrorHook);
export const validateResetPassword = zValidator("json", resetPasswordSchema, validationErrorHook);
