// ============================================================================
// Canonical academic data.
//
// Problem this solves: department, course, matric number and session are typed by hand (students on the
// Settings page, students on the Upload form, admins in the resource editor). Matching them with `=` meant
// "computer science", "Computer  Science", "Computer Science Dept." and "Computer science" were four different
// departments, so a student whose spelling differed from the uploader's saw an empty dashboard.
//
// Two layers, used together:
//   1. WRITE-TIME CANONICAL FORM  - what we store and display ("Computer Science", "CSC 305", "CSC/2019/001").
//   2. KEYS                       - a lossy, comparison-only form ("computer science", "CSC305"). Every
//                                   search / filter / "for your department" match compares KEYS, so even
//                                   a legacy row that was stored in a different style still matches.
//
// Pure functions only (no DB, no env), so this file is also unit-tested directly (test/academic.test.js).
// ============================================================================

const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

// Trim, strip control characters, collapse any run of whitespace to one space.
export function collapse(value) {
  return String(value ?? "").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------- departments
// Extend this when you notice a common shorthand in your data. Keys are already-normalised department keys
// (see departmentKeyRaw below); values are the canonical display name they should become.
export const DEPARTMENT_ALIASES = {
  "cs": "Computer Science",
  "comp sci": "Computer Science",
  "comp science": "Computer Science",
  "computer sci": "Computer Science",
  "compsci": "Computer Science",
  "computer sciences": "Computer Science",
  "maths": "Mathematics",
  "math": "Mathematics",
  "mass comm": "Mass Communication",
  "mass communications": "Mass Communication",
};

// Words that stay lower-case inside a title ("Medicine and Surgery").
const SMALL_WORDS = new Set(["and", "of", "in", "for", "the", "to", "a", "an", "on", "at", "with"]);
// Short all-caps words that are real acronyms and must stay upper-case even if the whole entry was typed in CAPS.
const ACRONYMS = new Set(["ICT", "IT", "MIS", "HND", "ND", "GST", "BSC", "MSC", "PHD", "UI", "UX", "AI", "HR"]);

// "Department of", "Dept. of", "Dept of", "Faculty of"... prefixes and a trailing "Department"/"Dept" are noise.
function stripDepartmentNoise(text) {
  return text
    .replace(/^(?:the\s+)?(?:department|dept)\.?\s+of\s+/i, "")
    .replace(/\s+(?:department|dept)\.?$/i, "")
    .replace(/^(?:the\s+)/i, "")
    .trim();
}

// Comparison form BEFORE alias resolution: lower-case, "&" -> "and", punctuation -> space, collapsed.
function departmentKeyRaw(value) {
  return collapse(stripDepartmentNoise(collapse(value)))
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Title-case that respects small words and acronyms. Entries typed with deliberate inner capitals
// ("EEE", "iOS Development") are kept as typed unless the whole entry was typed in ALL CAPS.
export function smartTitleCase(value) {
  const text = collapse(value).replace(/\s*&\s*/g, " and ");
  if (!text) return "";
  const hasLower = /[a-z]/.test(text);
  const allCaps = !hasLower && /[A-Z]/.test(text);
  // A single short all-caps word is an abbreviation ("EEE", "LAW"): leave it exactly as typed.
  if (allCaps && !text.includes(" ") && text.length <= 4) return text;
  const words = text.split(" ");
  return words
    .map((word, index) => {
      // Handle "Electrical/Electronic" and "Tele-communication" part by part, keeping the separator.
      return word
        .split(/([\/\-])/)
        .map((part) => {
          if (part === "/" || part === "-" || part === "") return part;
          const upper = part.toUpperCase();
          if (ACRONYMS.has(upper)) return upper;
          // keep deliberate mixed capitalisation ("iOS", "McDonald") when the entry isn't all caps
          if (!allCaps && /[A-Z]/.test(part.slice(1)) && /[a-z]/.test(part)) return part;
          const lower = part.toLowerCase();
          if (index > 0 && SMALL_WORDS.has(lower)) return lower;
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join("");
    })
    .join(" ");
}

// The comparison key for a department. Idempotent, and the same for every spelling of the same department.
export function departmentKey(value) {
  const raw = departmentKeyRaw(value);
  if (!raw) return "";
  const alias = DEPARTMENT_ALIASES[raw];
  return alias ? departmentKeyRaw(alias) : raw;
}

// Canonical display name when we have no existing stored spelling to reuse.
export function canonicalDepartmentName(value) {
  const raw = departmentKeyRaw(value);
  if (!raw) return "";
  const alias = DEPARTMENT_ALIASES[raw];
  if (alias) return alias;
  // Re-case the noise-stripped text (not the key, which has lost "/" and "-").
  return smartTitleCase(stripDepartmentNoise(collapse(value))).replace(/^[.,;:\s]+|[.,;:\s]+$/g, "");
}

// University / faculty: no matching depends on them, so just tidy.
export function canonicalName(value) {
  return smartTitleCase(value);
}

// ---------------------------------------------------------------------------- courses
// "csc305", "CSC-305", "csc 305", "Csc  305" -> "CSC 305". Anything that isn't shaped like a course code is
// upper-cased and tidied but otherwise left alone (we never reject a legitimate unusual code).
const COURSE_CODE = /^([A-Z]{2,6})[\s\-_.]*(\d{2,4}[A-Z]?)$/;

export function normalizeCourse(value) {
  const text = collapse(value).toUpperCase();
  if (!text) return "";
  const m = COURSE_CODE.exec(text);
  return m ? `${m[1]} ${m[2]}` : text;
}

// Letters+digits only, upper-case. Same definition the reward program already used for requests.
export function courseKey(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ---------------------------------------------------------------------------- matric number
// Upper-case, no whitespace: "csc/2019/ 001" and "CSC/2019/001" are the same student.
export function normalizeMatric(value) {
  return collapse(value).replace(/\s+/g, "").toUpperCase();
}

// ---------------------------------------------------------------------------- academic session
// Accepts "2024/2025", "2024-2025", "2024 / 2025", "2024/25", "2024-25". Returns "2024/2025", or null when the
// text isn't a real session (the second year must be the year after the first).
export function normalizeSession(value) {
  const m = /^\s*(\d{4})\s*[\/\-\\]\s*(\d{4}|\d{2})\s*$/.exec(String(value ?? ""));
  if (!m) return null;
  const start = Number(m[1]);
  let end = Number(m[2]);
  if (m[2].length === 2) end = Math.floor(start / 100) * 100 + end;
  if (end !== start + 1) return null;
  return `${start}/${end}`;
}

// ---------------------------------------------------------------------------- level / semester / resource type
// These are fixed lists in the forms, but the API is also called by older pages, edits and scripts, so we accept
// the obvious variants and always STORE the canonical value ("300", "First", "Past Question").
export const LEVELS = ["100", "200", "300", "400", "500", "600"];
export const SEMESTERS = ["First", "Second"];
export const RESOURCE_TYPES = ["Lecture Note", "Past Question", "Assignment Material", "Textbook", "Revision Sheet", "Other"];

// "300", "300 Level", "300level", "300L", "300 lvl" -> "300".  Anything else is returned tidied (and then fails the enum).
export function normalizeLevel(value) {
  const text = collapse(value);
  const m = /^(\d{3})\s*(?:level|lvl|l)?$/i.exec(text);
  return m ? m[1] : text;
}

// "first", "1st", "First Semester", "1st sem" -> "First";  "second"/"2nd"/... -> "Second"
export function normalizeSemester(value) {
  const text = collapse(value).toLowerCase();
  if (/^(?:1st|first|1)(?:\s+sem(?:ester)?)?$/.test(text)) return "First";
  if (/^(?:2nd|second|2)(?:\s+sem(?:ester)?)?$/.test(text)) return "Second";
  return collapse(value);
}

// "male" / "FEMALE" / " other " -> "Male" / "Female" / "Other"
export function normalizeGender(value) {
  const text = collapse(value);
  const m = { male: "Male", female: "Female", other: "Other" }[text.toLowerCase()];
  return m ?? text;
}

const TYPE_ALIASES = {
  "lecture note": "Lecture Note", "lecture notes": "Lecture Note", "lecturenote": "Lecture Note", "notes": "Lecture Note",
  "past question": "Past Question", "past questions": "Past Question", "pastquestion": "Past Question", "past paper": "Past Question", "past papers": "Past Question",
  "assignment material": "Assignment Material", "assignment materials": "Assignment Material", "assignment": "Assignment Material", "assignments": "Assignment Material",
  "textbook": "Textbook", "textbooks": "Textbook", "text book": "Textbook",
  "revision sheet": "Revision Sheet", "revision sheets": "Revision Sheet", "revision": "Revision Sheet",
  "other": "Other",
};
export function normalizeResourceType(value) {
  const text = collapse(value);
  return TYPE_ALIASES[text.toLowerCase()] ?? text;
}

// ---------------------------------------------------------------------------- choosing ONE display spelling
// When several spellings share a key (before the normaliser has run), which one do we show? Not "alphabetically
// first" - in ASCII "COMPUTER SCIENCE" sorts before "Computer Science". Prefer, in order: a spelling that is already
// tidy (equal to its own canonical form), then the most common one, then alphabetical (deterministic).
// variants: [{ name, count }]   isTidy: (name) => boolean
export function pickDisplay(variants, isTidy) {
  let best = null;
  for (const v of variants) {
    if (!v.name) continue;
    const tidy = isTidy(v.name) ? 1 : 0;
    if (
      !best || tidy > best.tidy || (tidy === best.tidy && (v.count > best.count || (v.count === best.count && v.name < best.name)))
    ) best = { name: v.name, tidy, count: v.count };
  }
  return best ? best.name : "";
}

// ---------------------------------------------------------------------------- search helpers
// Make a user's search text safe and predictable: tidy, bounded, and with LIKE's own wildcards neutralised.
export function searchTerm(value, max = 100) {
  return collapse(value).slice(0, max);
}
export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, "\\$&");
}
// `%term%` for use with:  column LIKE ? ESCAPE '\'
export function likeContains(value) {
  return `%${escapeLike(searchTerm(value))}%`;
}

// ---------------------------------------------------------------------------- DB-aware: reuse the spelling already in use
// Departments are free text, so the FIRST person to type a new department decides its spelling; everyone after
// them matches it by key and reuses that spelling, which keeps dropdowns free of near-duplicates.
// Returns { name, key } ('' / '' when empty).
export async function resolveDepartment(DB, value) {
  const key = departmentKey(value);
  if (!key) return { name: "", key: "" };
  const existing =
    (await DB.prepare("SELECT department AS name FROM resources WHERE department_key = ? LIMIT 1").bind(key).first()) ||
    (await DB.prepare("SELECT department AS name FROM users WHERE department_key = ? AND department IS NOT NULL LIMIT 1").bind(key).first());
  // Only reuse a stored spelling that is itself tidy; never spread a legacy "computer  science" any further.
  const reuse = existing?.name && canonicalDepartmentName(existing.name) === existing.name ? existing.name : null;
  return { name: reuse || canonicalDepartmentName(value), key };
}
