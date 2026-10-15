// Shared WHERE-clause builders for every list/search that filters resources, so the student pages and the three
// admin lists can never drift apart again.
//
//  * department and course are matched on their stored KEYS (department_key / course_key), never on the display
//    text, so "Computer Science" / "computer science" / "Computer Science Dept." and "CSC 305" / "csc305" all match.
//  * free-text search escapes LIKE's own wildcards (a search for "100%" used to match everything).
import { departmentKey, courseKey, likeContains, searchTerm, collapse, normalizeLevel, normalizeSemester, normalizeResourceType, normalizeSession, pickDisplay, canonicalDepartmentName, normalizeCourse } from "./academic.js";

// `alias` is the table alias used in the query ("r" for resources).
const col = (alias, name) => (alias ? `${alias}.${name}` : name);

export function addDepartmentFilter(conditions, params, value, alias = "r") {
  const key = departmentKey(value);
  if (!key) return false;
  conditions.push(`${col(alias, "department_key")} = ?`);
  params.push(key);
  return true;
}

export function addCourseFilter(conditions, params, value, alias = "r") {
  const key = courseKey(value);
  if (!key) return false;
  conditions.push(`${col(alias, "course_key")} = ?`);
  params.push(key);
  return true;
}

// Title or course. Searching "csc305", "CSC 305" or "csc-305" all find course CSC 305, because the course half
// of the search is matched against course_key.
export function addSearchFilter(conditions, params, value, alias = "r") {
  const term = searchTerm(value);
  if (!term) return false;
  const like = likeContains(term);
  const key = courseKey(term);
  if (key) {
    conditions.push(`(${col(alias, "title")} LIKE ? ESCAPE '\\' OR ${col(alias, "course")} LIKE ? ESCAPE '\\' OR ${col(alias, "course_key")} LIKE ? ESCAPE '\\')`);
    params.push(like, like, `%${key}%`);
  } else {
    conditions.push(`(${col(alias, "title")} LIKE ? ESCAPE '\\' OR ${col(alias, "course")} LIKE ? ESCAPE '\\')`);
    params.push(like, like);
  }
  return true;
}

// ---- dropdown / autocomplete option lists, de-duplicated by KEY ------------------------------------
// One entry per department (or course) no matter how many spellings exist in the data. Which spelling is shown is
// chosen by pickDisplay (tidy first, then most common, then alphabetical) - see academic.js.
// `statuses` e.g. ["approved"] or ["approved", "rejected"]; they are fixed strings from our own code, never user input.
const isTidyDepartment = (name) => canonicalDepartmentName(name) === name;
const isTidyCourse = (name) => normalizeCourse(name) === name;

// rows: [{ k, name, n }] -> ["Display name", ...] one per key, sorted case-insensitively
export function displayNamesByKey(rows, isTidy) {
  const byKey = new Map();
  for (const r of rows) {
    if (!r.k || !r.name) continue;
    if (!byKey.has(r.k)) byKey.set(r.k, []);
    byKey.get(r.k).push({ name: r.name, count: r.n });
  }
  return [...byKey.values()].map((v) => pickDisplay(v, isTidy)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export async function distinctDepartments(DB, statuses = ["approved"]) {
  const marks = statuses.map(() => "?").join(", ");
  const { results } = await DB.prepare(
    `SELECT department_key AS k, department AS name, COUNT(*) AS n FROM resources
      WHERE status IN (${marks}) AND department_key IS NOT NULL AND department_key != ''
      GROUP BY department_key, department`
  ).bind(...statuses).all();
  return displayNamesByKey(results, isTidyDepartment);
}

export async function distinctCourses(DB, statuses = ["approved"]) {
  const marks = statuses.map(() => "?").join(", ");
  const { results } = await DB.prepare(
    `SELECT course_key AS k, course AS name, COUNT(*) AS n FROM resources
      WHERE status IN (${marks}) AND course_key IS NOT NULL AND course_key != ''
      GROUP BY course_key, course`
  ).bind(...statuses).all();
  return displayNamesByKey(results, isTidyCourse);
}

// Every department anyone has used (approved resources AND student profiles), one entry per key. Used for the
// type-ahead suggestions on the Settings and Upload forms: a student typing "comp" is offered the spelling that is
// already in use instead of inventing a variant. New departments can still be typed; they just join the list.
export async function distinctKnownDepartments(DB, limit = 500) {
  const { results } = await DB.prepare(
    `SELECT department_key AS k, department AS name, COUNT(*) AS n FROM (
       SELECT department_key, department FROM resources WHERE status = 'approved' AND department_key IS NOT NULL AND department_key != ''
       UNION ALL
       SELECT department_key, department FROM users WHERE role = 'student' AND department_key IS NOT NULL AND department_key != ''
     ) GROUP BY department_key, department`
  ).all();
  return displayNamesByKey(results, isTidyDepartment).slice(0, limit);
}

// Departments students have on their profiles, one entry per key (admin Users filter, announcement audience).
export async function distinctStudentDepartments(DB) {
  const { results } = await DB.prepare(
    `SELECT department_key AS k, department AS name, COUNT(*) AS n FROM users
      WHERE role = 'student' AND department IS NOT NULL AND department_key IS NOT NULL AND department_key != ''
      GROUP BY department_key, department`
  ).all();
  return displayNamesByKey(results, isTidyDepartment);
}

// Courses of approved resources, optionally limited to one department (by key), one entry per course key.
export async function distinctApprovedCourses(DB, department = "", limit = 1000) {
  const conditions = ["status = 'approved'", "course_key IS NOT NULL", "course_key != ''"];
  const params = [];
  addDepartmentFilter(conditions, params, department, "");
  const { results } = await DB.prepare(
    `SELECT course_key AS k, course AS name, COUNT(*) AS n FROM resources WHERE ${conditions.join(" AND ")} GROUP BY course_key, course`
  ).bind(...params).all();
  return displayNamesByKey(results, isTidyCourse).slice(0, limit);
}

// Query-string values arrive as typed/remembered by the browser. Normalise them to the stored canonical form
// ("300 Level" -> "300", "1st" -> "First", "2024-25" -> "2024/2025", "past questions" -> "Past Question") so a
// filter never silently matches nothing because of formatting. Unrecognised values are passed through unchanged
// (and simply match nothing, which is the honest answer).
export const canonicalFilter = {
  level: (v) => normalizeLevel(v),
  semester: (v) => normalizeSemester(v),
  type: (v) => normalizeResourceType(v),
  session: (v) => normalizeSession(v) ?? collapse(v),
};
