import { z } from "zod";

export const uploadResourceSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  type: z
    .string()
    .trim()
    .min(1, "Resource type is required")
    .pipe(
      z.enum(["Lecture Note", "Past Question", "Assignment Material", "Textbook", "Revision Sheet", "Other"], {
        message: "Please select a valid resource type",
      })
    ),
  department: z.string().trim().min(1, "Department is required"),
  course: z.string().trim().min(1, "Course is required"),
  level: z
    .string()
    .min(1, "Level is required")
    .pipe(z.enum(["100", "200", "300", "400", "500", "600"], { message: "Please select a valid level" })),
  semester: z
    .string()
    .min(1, "Semester is required")
    .pipe(z.enum(["First", "Second"], { message: "Please select a valid semester" })),
  session: z.string().trim().min(1, "Session is required"),
  description: z.string().trim().optional(),
});

// Admin edit of an uploaded resource's metadata (pending, approved or rejected).
// Reuses the upload schema's rules so an edit can never store something an upload
// would have refused, but every field is optional: send only what changed.
// `pages` is the reviewer-confirmed page count, so it is only accepted for approved
// resources (the controller enforces that). Unknown keys (status, uploader_id,
// file_url ...) are stripped by zod and can never be written through this schema.
export const MAX_EDIT_PAGES = 1000;
export const updateResourceMetadataSchema = uploadResourceSchema
  .extend({
    title: z.string().trim().min(1, "Title is required").max(300, "Title is too long (300 characters max)"),
    department: z.string().trim().min(1, "Department is required").max(150, "Department is too long"),
    course: z.string().trim().min(1, "Course is required").max(60, "Course is too long"),
    session: z.string().trim().min(1, "Session is required").max(30, "Session is too long"),
    description: z.string().trim().max(5000, "Description is too long (5000 characters max)"),
    pages: z
      .number({ message: "Page count must be a number" })
      .int("Page count must be a whole number")
      .min(1, "Page count must be at least 1")
      .max(MAX_EDIT_PAGES, `Page count can't be more than ${MAX_EDIT_PAGES}`),
  })
  .partial();

// Same error shape used everywhere else in the app —
// { success: false, errors: [{ field, message }] } — even though this
// endpoint validates manually (mixed file+form body) instead of going
// through the zValidator middleware the way the pure-JSON routes do.
export function formatZodErrors(zodError) {
  return zodError.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }));
}
