import { sanitizeError } from "../utils/sanitizeError.js";
import { LEVELS, SEMESTERS, RESOURCE_TYPES } from "../utils/academic.js";
import { distinctKnownDepartments, distinctApprovedCourses } from "../utils/resourceFilters.js";

// @route GET /api/meta/options?department=Computer%20Science
// Suggestions for the free-text department and course boxes (Settings, Upload) plus the fixed lists, so the forms
// and the server can never disagree about what a valid level / semester / type is. Suggestions only: anything can
// still be typed (new departments must be possible), and whatever is typed is normalised by the server.
export async function getOptions(c) {
  try {
    const department = c.req.query("department") || "";
    const [departments, courses] = await Promise.all([
      distinctKnownDepartments(c.env.DB),
      distinctApprovedCourses(c.env.DB, department),
    ]);
    c.header?.("Cache-Control", "private, max-age=60");
    return c.json({ success: true, departments, courses, levels: LEVELS, semesters: SEMESTERS, types: RESOURCE_TYPES });
  } catch (err) {
    console.error("metaController error:", err?.message);
    return c.json({ success: false, message: "Could not load options", error: sanitizeError(c.env, err) }, 500);
  }
}
