import { z } from "zod";
import { collapse, normalizeCourse, normalizeSession, normalizeLevel, normalizeSemester, normalizeResourceType, LEVELS, SEMESTERS, RESOURCE_TYPES } from "../utils/academic.js";

// Everything typed by hand is normalised here, once, so every writer (student upload, admin edit) stores the same
// canonical text and every filter/search can rely on it. Department is canonicalised in the controller because it
// reuses the spelling already in the database.
const sessionField = z
  .string()
  .trim()
  .min(1, "Session is required")
  .transform(normalizeSession)
  .refine((v) => v !== null, { message: "Session must look like 2024/2025" });

export const uploadResourceSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300, "Title is too long (300 characters max)").transform(collapse),
  type: z
    .string()
    .trim()
    .min(1, "Resource type is required")
    .transform(normalizeResourceType)
    .pipe(z.enum(RESOURCE_TYPES, { message: "Please select a valid resource type" })),
  department: z.string().trim().min(1, "Department is required").max(150, "Department is too long").transform(collapse),
  course: z.string().trim().min(1, "Course is required").max(60, "Course is too long").transform(normalizeCourse),
  level: z
    .string()
    .min(1, "Level is required")
    .transform(normalizeLevel)
    .pipe(z.enum(LEVELS, { message: "Please select a valid level" })),
  semester: z
    .string()
    .min(1, "Semester is required")
    .transform(normalizeSemester)
    .pipe(z.enum(SEMESTERS, { message: "Please select a valid semester" })),
  session: sessionField,
  description: z.string().trim().max(5000, "Description is too long (5000 characters max)").optional(),
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
