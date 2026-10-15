import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { normalizeEmail } from "../utils/normalizeEmail.js";
import { collapse, canonicalName, normalizeMatric, normalizeLevel, normalizeGender } from "../utils/academic.js";

// express-validator's `.optional({ checkFalsy: true })` treats an empty
// string as "not provided" — this reproduces that for matricNumber,
// university, faculty, department, level, gender.
const optionalTrimmed = () =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().optional()
  );

// Tidy-up applied AFTER validation (zod transforms), so controllers receive canonical values and never have to
// remember to normalise: "csc/2019/ 001" -> "CSC/2019/001", "federal  university" -> "Federal University".
const tidy = (fn) => (v) => (v === undefined ? v : fn(v));
const maxLen = (n, label) => (v) => v === undefined || v.length <= n || false;
const optionalText = (max, label, fn = collapse) =>
  optionalTrimmed()
    .refine(maxLen(max), { message: `${label} is too long (${max} characters max)` })
    .transform(tidy(fn));

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
  fullName: z.string().trim().min(1, "Full name is required").max(120, "Full name is too long").transform(collapse),
  email: emailField,
  password: z.string().min(1, "Password is required").min(8, "Password must be at least 8 characters"),
  matricNumber: optionalText(40, "Matric number", normalizeMatric),
  university: optionalText(150, "University", canonicalName),
  faculty: optionalText(150, "Faculty", canonicalName),
  department: optionalText(150, "Department"), // canonical spelling is resolved in the controller (needs the DB)
  level: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : normalizeLevel(v)) : v),
    z.enum(["100", "200", "300", "400", "500", "600"], { message: "Please select a valid level" }).optional()
  ),
  gender: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : normalizeGender(v)) : v),
    z.enum(["Male", "Female", "Other"], { message: "Please select a valid gender" }).optional()
  ),
  communitySurvey: z.string().trim().optional(),
  // Optional invite code (from a "?ref=" signup link). A malformed code is quietly
  // treated as absent: a bad referral code must never stop someone from signing up.
  referralCode: z.preprocess(
    (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{4,24}$/.test(v.trim()) ? v.trim() : undefined),
    z.string().optional()
  ),
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
