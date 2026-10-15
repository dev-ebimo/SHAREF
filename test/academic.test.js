// Canonical academic data (src/utils/academic.js): the rules that keep "Computer Science" findable no matter how it was typed.
// Pure functions, no dependencies.  Run: node test/academic.test.js
import {
  collapse, departmentKey, canonicalDepartmentName, smartTitleCase, normalizeCourse, courseKey, normalizeMatric,
  normalizeSession, escapeLike, likeContains, searchTerm, normalizeLevel, normalizeSemester, normalizeResourceType, pickDisplay,
} from "../src/utils/academic.js";

let passed = 0, failed = 0;
function check(label, cond, extra = "") { if (cond) { console.log("OK  -", label); passed++; } else { console.log("FAIL-", label, extra); failed++; } }
const eq = (a, b) => a === b;

// ---- departments: every spelling of the same department has the SAME key
const csVariants = [
  "Computer Science", "computer science", "COMPUTER SCIENCE", "  Computer   Science  ", "Computer Science.",
  "Computer Science Department", "Department of Computer Science", "Dept. of Computer Science", "dept of computer science",
  "Computer-Science", "computer sci", "Comp Sci", "CS", "Computer Sciences",
];
const csKeys = new Set(csVariants.map(departmentKey));
check("department: 14 spellings of Computer Science collapse to ONE key", csKeys.size === 1 && csKeys.has("computer science"), [...csKeys].join(" | "));
check("department: '&' and 'and' are the same", eq(departmentKey("Electrical & Electronic Engineering"), departmentKey("electrical and electronic engineering")));
check("department: '/' and spaces are the same", eq(departmentKey("Electrical/Electronic Engineering"), departmentKey("electrical electronic engineering")));
check("department: different departments keep different keys", departmentKey("Computer Science") !== departmentKey("Computer Engineering") && departmentKey("Physics") !== departmentKey("Biophysics"));
check("department: 'Maths' / 'Math' → Mathematics", eq(departmentKey("Maths"), departmentKey("Mathematics")) && eq(departmentKey("math"), departmentKey("Mathematics")));
check("department: key is idempotent", csVariants.every((v) => departmentKey(departmentKey(v)) === departmentKey(v)));
check("department: empty / whitespace / null → empty key", departmentKey("") === "" && departmentKey("   ") === "" && departmentKey(null) === "" && departmentKey(undefined) === "");
check("department: canonical display of every Computer Science spelling is identical", new Set(csVariants.filter((v) => v !== "Computer-Science").map(canonicalDepartmentName)).size === 1 && canonicalDepartmentName("cs") === "Computer Science");
check("department: lower-case input is title-cased", canonicalDepartmentName("medicine and surgery") === "Medicine and Surgery");
check("department: ALL CAPS input is title-cased, small words lowered", canonicalDepartmentName("MEDICINE AND SURGERY") === "Medicine and Surgery");
check("department: '&' becomes 'and' in the display", canonicalDepartmentName("electrical & electronic engineering") === "Electrical and Electronic Engineering");
check("department: slash kept, both sides capitalised", canonicalDepartmentName("electrical/electronic engineering") === "Electrical/Electronic Engineering");
check("department: acronym kept upper-case even when typed in caps", canonicalDepartmentName("ICT") === "ICT" && canonicalDepartmentName("information and communication technology") === "Information and Communication Technology");
check("department: 'Department of' noise removed from display", canonicalDepartmentName("Department of Physics") === "Physics");
check("department: control characters / zero-width tabs tidied", canonicalDepartmentName("Computer\tScience\n") === "Computer Science");
check("title case: a lone short all-caps abbreviation is left alone", smartTitleCase("EEE") === "EEE" && smartTitleCase("LAW") === "LAW" && smartTitleCase("ELECTRICAL ENGINEERING") === "Electrical Engineering");
check("title case: deliberate inner capitals kept when entry is mixed case", smartTitleCase("iOS Development") === "iOS Development");

// ---- courses
const cscVariants = ["CSC 305", "csc305", "CSC-305", "csc 305", "Csc  305", "CSC_305", " CSC305 ", "csc.305"];
check("course: every spelling of CSC 305 normalises to 'CSC 305'", cscVariants.every((v) => normalizeCourse(v) === "CSC 305"), cscVariants.map(normalizeCourse).join(" | "));
check("course: every spelling has the same key", new Set(cscVariants.map(courseKey)).size === 1 && courseKey("csc 305") === "CSC305");
check("course: suffix letter kept (MTH 101A)", normalizeCourse("mth101a") === "MTH 101A");
check("course: 4-digit codes (GST 1101)", normalizeCourse("gst1101") === "GST 1101");
check("course: odd-shaped codes are tidied, never rejected or mangled", normalizeCourse("  eng  2xx/ 3xx ") === "ENG 2XX/ 3XX");
check("course: empty stays empty", normalizeCourse("   ") === "" && normalizeCourse(null) === "");

// ---- matric number
check("matric: case and spaces ignored", normalizeMatric(" csc/2019/ 001 ") === "CSC/2019/001" && normalizeMatric("CSC/2019/001") === "CSC/2019/001");
check("matric: empty stays empty", normalizeMatric("  ") === "");

// ---- session
check("session: separators accepted", ["2024/2025", "2024-2025", "2024 / 2025", "2024\\2025", " 2024/2025 "].every((v) => normalizeSession(v) === "2024/2025"));
check("session: short second year accepted", normalizeSession("2024/25") === "2024/2025" && normalizeSession("2024-25") === "2024/2025");
check("session: century rollover (2099/00 is NOT 2099/2100 style — rejected, 2099/2100 ok)", normalizeSession("2099/2100") === "2099/2100" && normalizeSession("2099/00") === null);
check("session: non-consecutive or junk rejected", normalizeSession("2024/2026") === null && normalizeSession("2025/2024") === null && normalizeSession("abcd") === null && normalizeSession("") === null && normalizeSession(null) === null && normalizeSession("2024") === null);

// ---- search helpers
check("search: LIKE wildcards neutralised", escapeLike("100%_a\\b") === "100\\%\\_a\\\\b" && likeContains("50%") === "%50\\%%");
check("search: tidied and bounded", searchTerm("  hello   world ") === "hello world" && searchTerm("x".repeat(500)).length === 100);
check("collapse: tabs/newlines/runs of spaces", collapse("a \t\n  b") === "a b");

// ---- level / semester / type
check("level: 300 / '300 Level' / '300level' / '300L' / '300 lvl' all → 300", ["300", "300 Level", "300level", "300L", " 300 lvl "].every((v) => normalizeLevel(v) === "300"));
check("level: junk is left for the enum to reject", normalizeLevel("abc") === "abc" && normalizeLevel("3000") === "3000");
check("semester: first/1st/'First Semester'/'1st sem' → First", ["first", "1st", "First Semester", "1st sem", " FIRST "].every((v) => normalizeSemester(v) === "First"));
check("semester: second/2nd → Second", ["second", "2nd", "Second Semester"].every((v) => normalizeSemester(v) === "Second"));
check("semester: junk left for the enum to reject", normalizeSemester("third") === "third");
check("type: case / plural variants → canonical", normalizeResourceType("past questions") === "Past Question" && normalizeResourceType("LECTURE NOTES") === "Lecture Note" && normalizeResourceType("Revision") === "Revision Sheet" && normalizeResourceType("Past Question") === "Past Question");
check("type: unknown value left for the enum to reject", normalizeResourceType("Banana") === "Banana");

// ---- picking ONE display spelling per key
const tidyDept = (n) => canonicalDepartmentName(n) === n;
check("display: a tidy spelling beats ALL CAPS even though ALL CAPS sorts first", pickDisplay([{ name: "COMPUTER SCIENCE", count: 9 }, { name: "Computer Science", count: 1 }, { name: "computer science", count: 5 }], tidyDept) === "Computer Science");
check("display: among tidy spellings the most common wins", pickDisplay([{ name: "Computer Science", count: 2 }, { name: "Computer Sciences", count: 7 }], () => true) === "Computer Sciences");
check("display: ties break alphabetically (deterministic)", pickDisplay([{ name: "B", count: 1 }, { name: "A", count: 1 }], () => true) === "A");
check("display: nothing tidy -> still returns the most common", pickDisplay([{ name: "COMPUTER SCIENCE", count: 3 }, { name: "computer science", count: 1 }], tidyDept) === "COMPUTER SCIENCE");
check("display: empty -> ''", pickDisplay([], tidyDept) === "");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
