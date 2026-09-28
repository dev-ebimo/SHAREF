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

// Same error shape used everywhere else in the app —
// { success: false, errors: [{ field, message }] } — even though this
// endpoint validates manually (mixed file+form body) instead of going
// through the zValidator middleware the way the pure-JSON routes do.
export function formatZodErrors(zodError) {
  return zodError.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }));
}
