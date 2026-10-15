// Frontend/academic.js (the helper the Resources / Lecture Notes / Upload / Settings pages share).
// It is a browser script, so it is loaded here against a stub `window`.  Run: node test/frontend-academic.test.js
import fs from "node:fs";
import vm from "node:vm";

const win = {};
vm.runInNewContext(fs.readFileSync(new URL("../Frontend/academic.js", import.meta.url), "utf8"), { window: win, document: {} });
const A = win.SharefAcademic;

let passed = 0, failed = 0;
const check = (label, cond, extra = "") => { console.log(cond ? "OK  -" : "FAIL-", label, cond ? "" : extra); cond ? passed++ : failed++; };

// ---- search tolerance
check("search: 'csc305' finds 'CSC 305'", A.matchesSearch(["Intro", "CSC 305"], "csc305"));
check("search: 'csc-305' and 'CSC 305' find 'CSC305'", A.matchesSearch(["CSC305"], "csc-305") && A.matchesSearch(["CSC305"], "CSC 305"));
check("search: ordinary substring still works", A.matchesSearch(["Operating Systems notes"], "systems"));
check("search: empty query matches everything", A.matchesSearch(["x"], "") && A.matchesSearch(["x"], "   "));
check("search: unrelated text does not match", !A.matchesSearch(["CSC 305", "Algorithms"], "mth101"));
check("search: punctuation-only query does not match everything", !A.matchesSearch(["CSC 305"], "---"));

// ---- canonicalisation by key: ONE spelling per department / course
const rows = [
  { department: "computer science", departmentKey: "computer science", course: "csc305", courseKey: "CSC305" },
  { department: "Computer Science", departmentKey: "computer science", course: "CSC 305", courseKey: "CSC305" },
  { department: "COMPUTER SCIENCE", departmentKey: "computer science", course: "Csc-305", courseKey: "CSC305" },
  { department: "Physics", departmentKey: "physics", course: "PHY 101", courseKey: "PHY101" },
  { department: "No Key", course: "ZZZ 1" },
];
const byKey = A.canonicalizeByKey(rows, "department", "departmentKey");
A.canonicalizeByKey(rows, "course", "courseKey");
check("canonicalise: every spelling of a department becomes ONE, and it is the TIDY one (not ALL CAPS, not lower-case)", rows.slice(0, 3).every((r) => r.department === "Computer Science"), JSON.stringify(rows.map((r) => r.department)));
check("canonicalise: courses collapse the same way", new Set(rows.slice(0, 3).map((r) => r.course)).size === 1, JSON.stringify(rows.map((r) => r.course)));
// most common wins among equally-tidy spellings
const tie = [{ d: "Computer Sci", k: "x" }, { d: "Computer Sci", k: "x" }, { d: "Computer Science", k: "x" }];
A.canonicalizeByKey(tie, "d", "k");
check("canonicalise: among tidy spellings the most common wins", tie.every((r) => r.d === "Computer Sci"));
check("canonicalise: other departments untouched; rows without a key left alone", rows[3].department === "Physics" && rows[4].department === "No Key");
check("canonicalise: returns key -> display map", byKey["computer science"] === rows[0].department && byKey.physics === "Physics");

// ---- the profile resolves through the key (THE bug: profile 'computer science' vs resources 'Computer Science')
const profile = { department: "computer science", departmentKey: "computer science" };
check("profile prefill: resolves to the spelling the resources use, so the filter is not empty", A.displayForProfile(profile, { "computer science": "Computer Science" }) === "Computer Science");
check("profile prefill: a department with no resources yet falls back to the profile's own text", A.displayForProfile({ department: "Zoology", departmentKey: "zoology" }, { physics: "Physics" }) === "Zoology");
check("profile prefill: no department -> null", A.displayForProfile({ department: null }, {}) === null && A.displayForProfile(null, {}) === null);

// ---- bounty wording (mirrors src/services/incentiveConfig.js)
check("bounty wording: 'Past Questions' -> 'Past Question', 'Lecture Notes' -> 'Lecture Note', 'Revision Sheet' unchanged", A.bountyTypeToResourceType("Past Questions") === "Past Question" && A.bountyTypeToResourceType("Lecture Notes") === "Lecture Note" && A.bountyTypeToResourceType("Revision Sheet") === "Revision Sheet");
check("bounty wording: unknown type -> '' (never guessed)", A.bountyTypeToResourceType("Banana") === "");
check("bounty wording: '300 Level' / '300' -> '300'", A.bountyLevelToResourceLevel("300 Level") === "300" && A.bountyLevelToResourceLevel("300") === "300" && A.bountyLevelToResourceLevel("x") === "");

// ---- datalist filling
const kids = []; const list = { innerHTML: "x", appendChild: (o) => kids.push(o) };
win.document = { createElement: () => ({}) };
vm.runInNewContext("1", {});
check("datalist: null list is a no-op, not a crash", (() => { try { A.fillDatalist(null, ["a"]); return true; } catch { return false; } })());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
