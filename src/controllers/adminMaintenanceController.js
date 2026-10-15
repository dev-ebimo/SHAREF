import { sanitizeError } from "../utils/sanitizeError.js";
import {
  collapse, resolveDepartment, courseKey, normalizeCourse, normalizeLevel, normalizeSemester, normalizeResourceType,
  normalizeSession, normalizeMatric, normalizeGender, canonicalName, LEVELS, SEMESTERS, RESOURCE_TYPES,
} from "../utils/academic.js";

// One-off (and safe to re-run) clean-up of data that was entered BEFORE the consistency rules existed.
//
//   POST /api/admin/maintenance/normalize-academic-data
//   body (all optional): { "table": "resources" | "users", "after": "<last id from the previous response>", "limit": 100 }
//
// It works through the data in small pages (a Worker has a strict per-request budget), so you call it repeatedly,
// feeding each response's `next` back in, until it answers { done: true }. Start with table "resources", then "users".
// Every row is recomputed with the application's own rules (src/utils/academic.js): the comparison keys
// (department_key, course_key) are set exactly, and the stored spelling of department, course, session, level,
// semester, type, matric number, university and faculty is tidied. A value that can't be understood is LEFT AS IT
// IS (never blanked or guessed), and a row that is already tidy is not touched, so re-running is harmless.
//
// It never changes ids, uploaders, statuses, money or timestamps.

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export async function normalizeAcademicData(c) {
  try {
    const body = await c.req.json().catch(() => ({})) || {};
    const table = body.table === "users" ? "users" : "resources";
    const after = typeof body.after === "string" ? body.after : "";
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const result = table === "resources" ? await normalizeResources(c.env.DB, after, limit) : await normalizeUsers(c.env.DB, after, limit);
    const done = result.scanned < limit;
    return c.json({
      success: true,
      table,
      ...result,
      done,
      // Feed this straight back in. When `done` is true on "resources", continue with { "table": "users" }.
      next: done ? (table === "resources" ? { table: "users", after: "" } : null) : { table, after: result.lastId },
      message: done
        ? table === "resources"
          ? "Resources finished. Now run it once more with { \"table\": \"users\" }."
          : "All done."
        : "More rows remain: call again with `next`.",
    });
  } catch (err) {
    console.error("adminMaintenanceController error:", err?.message);
    return c.json({ success: false, message: "Could not normalise the data", error: sanitizeError(c.env, err) }, 500);
  }
}

// Departments are resolved at most once per call per distinct spelling.
function makeDepartmentResolver(DB) {
  const memo = new Map();
  return async (text) => {
    if (!memo.has(text)) memo.set(text, await resolveDepartment(DB, text));
    return memo.get(text);
  };
}

async function normalizeResources(DB, after, limit) {
  const { results } = await DB.prepare("SELECT * FROM resources WHERE id > ? ORDER BY id LIMIT ?").bind(after, limit).all();
  const resolve = makeDepartmentResolver(DB);
  const statements = [];
  let changed = 0;

  for (const r of results) {
    const next = {};
    const set = (col, value, current = r[col]) => { if (value !== undefined && value !== null && value !== current) next[col] = value; };

    const title = collapse(r.title);
    if (title) set("title", title);

    if (r.department && collapse(r.department)) {
      const dept = await resolve(collapse(r.department));
      set("department", dept.name);
      set("department_key", dept.key);
    }
    if (r.course && collapse(r.course)) {
      set("course", normalizeCourse(r.course));
      set("course_key", courseKey(r.course));
    }
    const level = normalizeLevel(r.level);
    if (LEVELS.includes(level)) set("level", level);
    const semester = normalizeSemester(r.semester);
    if (SEMESTERS.includes(semester)) set("semester", semester);
    const type = normalizeResourceType(r.type);
    if (RESOURCE_TYPES.includes(type)) set("type", type);
    const session = normalizeSession(r.session);
    if (session) set("session", session);

    const cols = Object.keys(next);
    if (cols.length) {
      changed++;
      statements.push(DB.prepare(`UPDATE resources SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map((k) => next[k]), r.id));
    }
  }
  if (statements.length) await DB.batch(statements);
  return { scanned: results.length, changed, skipped: 0, conflicts: [], lastId: results.length ? results[results.length - 1].id : after };
}

async function normalizeUsers(DB, after, limit) {
  const { results } = await DB.prepare("SELECT * FROM users WHERE id > ? ORDER BY id LIMIT ?").bind(after, limit).all();
  const resolve = makeDepartmentResolver(DB);
  const statements = [];
  const conflicts = [];
  const claimedMatrics = new Set(); // two rows in the same page normalising to the same value would also collide
  let changed = 0;

  for (const u of results) {
    const next = {};
    const set = (col, value, current = u[col]) => { if (value !== undefined && value !== null && value !== current) next[col] = value; };

    const fullName = collapse(u.full_name);
    if (fullName) set("full_name", fullName);

    if (u.department && collapse(u.department)) {
      const dept = await resolve(collapse(u.department));
      set("department", dept.name);
      set("department_key", dept.key);
    }
    const level = u.level ? normalizeLevel(u.level) : null;
    if (level && LEVELS.includes(level)) set("level", level);
    const gender = u.gender ? normalizeGender(u.gender) : null;
    if (gender && ["Male", "Female", "Other"].includes(gender)) set("gender", gender);
    if (u.university && collapse(u.university)) set("university", canonicalName(u.university));
    if (u.faculty && collapse(u.faculty)) set("faculty", canonicalName(u.faculty));

    // Matric numbers are unique: if normalising would collide with another account, leave it and report it so a
    // human can decide (two accounts may genuinely claim the same matric number).
    if (u.matric_number) {
      const matric = normalizeMatric(u.matric_number);
      if (matric && matric !== u.matric_number) {
        const clash = await DB.prepare("SELECT id FROM users WHERE matric_number = ? AND id != ?").bind(matric, u.id).first();
        if (clash || claimedMatrics.has(matric)) conflicts.push({ userId: u.id, matricNumber: u.matric_number, wouldBecome: matric, clashesWith: clash?.id ?? "another account in this page" });
        else { claimedMatrics.add(matric); set("matric_number", matric); }
      }
    }

    const cols = Object.keys(next);
    if (cols.length) {
      changed++;
      statements.push(DB.prepare(`UPDATE users SET ${cols.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map((k) => next[k]), u.id));
    }
  }
  if (statements.length) await DB.batch(statements);
  return { scanned: results.length, changed, skipped: conflicts.length, conflicts, lastId: results.length ? results[results.length - 1].id : after };
}
