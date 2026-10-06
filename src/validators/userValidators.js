import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { normalizeEmail } from "../utils/normalizeEmail.js";

// Every field optional (this is a partial-update endpoint), but if a field
// IS sent, it has to actually be non-empty/valid — matches the original's
// `.optional().trim().notEmpty()` combination exactly.
export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1, "Full name cannot be empty").optional(),
  email: z.string().trim().email("Please enter a valid email address").transform(normalizeEmail).optional(),
  department: z.string().trim().min(1, "Department cannot be empty").optional(),
  level: z.enum(["100", "200", "300", "400", "500", "600"], { message: "Please select a valid level" }).optional(),
  university: z.string().trim().min(1, "University cannot be empty").optional(),
  faculty: z.string().trim().min(1, "Faculty cannot be empty").optional(),
  matricNumber: z.string().trim().min(1, "Matric number cannot be empty").optional(),
  gender: z.enum(["Male", "Female", "Other"], { message: "Please select a valid gender" }).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

// A deliberate extra confirmation step for an irreversible action — typing
// the word "DELETE" is a real (if small) safeguard against a stray click
// or a request replayed by mistake. Enforced server-side, not just in the
// frontend's confirm dialog, so it can't be skipped by calling the API directly.
export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE", { message: 'Type "DELETE" exactly to confirm' }),
});

function validationErrorHook(result, c) {
  if (!result.success) {
    return c.json(
      { success: false, errors: result.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) },
      400
    );
  }
}

export const validateUpdateProfile = zValidator("json", updateProfileSchema, validationErrorHook);
export const validateChangePassword = zValidator("json", changePasswordSchema, validationErrorHook);
export const validateDeleteAccount = zValidator("json", deleteAccountSchema, validationErrorHook);
