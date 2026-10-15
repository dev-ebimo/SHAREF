import { generateId } from "../utils/id.js";

export const STATUSES = ["off", "shadow", "live", "paused"];

// Rule defaults are deliberately INERT: every payout amount and the budget are
// zero, so a program that was switched on before anyone configured it pays nothing.
export const DEFAULT_RULES = {
  monthlyBudget: 0,
  weeklyCap: 0,
  maxSinglePayout: 250,
  adminDailyLimit: 3000,
  holdDays: 3,
  ratioAlert: 40,
  rewards: {
    pastQuestion: 0,
    lectureNote: 0,
    high: 0,
    rare: 0,
    firstApproval: 0,
    referralSignup: 0,
    referralFirstApproval: 0,
  },
};

export const RULE_KEYS = ["monthlyBudget", "weeklyCap", "maxSinglePayout", "adminDailyLimit", "holdDays", "ratioAlert"];
export const REWARD_KEYS = Object.keys(DEFAULT_RULES.rewards);

const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);

// Overlay stored (untrusted-shaped) JSON on the defaults, keeping only known keys with sane values.
export function mergeRules(stored) {
  const src = stored && typeof stored === "object" ? stored : {};
  const out = { ...DEFAULT_RULES, rewards: { ...DEFAULT_RULES.rewards } };
  for (const k of RULE_KEYS) out[k] = num(src[k], DEFAULT_RULES[k]);
  const rw = src.rewards && typeof src.rewards === "object" ? src.rewards : {};
  for (const k of REWARD_KEYS) out.rewards[k] = num(rw[k], DEFAULT_RULES.rewards[k]);
  return out;
}

// { status, rules, season, updatedAt }. A missing row (e.g. a DB where the
// migration was run without its seed) behaves exactly like status 'off'.
export async function getIncentiveConfig(DB) {
  const row = await DB.prepare("SELECT status, rules, season_name, season_ends_at, updated_at FROM incentive_config WHERE id = 1").first();
  if (!row) return { status: "off", rules: mergeRules(null), season: null, updatedAt: null };
  let rules = null;
  try {
    rules = JSON.parse(row.rules || "{}");
  } catch {
    rules = null; // corrupt JSON must never take the site down; fall back to inert defaults
  }
  return {
    status: STATUSES.includes(row.status) ? row.status : "off",
    rules: mergeRules(rules),
    season: row.season_ends_at ? { name: row.season_name || "", endsAt: row.season_ends_at } : null,
    updatedAt: row.updated_at,
  };
}

// Students only ever see the program when an admin has made it live or paused.
// 'shadow' is invisible to students by design: it only records what WOULD be paid.
export const isVisibleToStudents = (status) => status === "live" || status === "paused";

// Which ledger statuses count as "paid" in budget and revenue maths. Shadow rows
// count only while the program IS in shadow mode, so admins see the projected cost
// without shadow history ever eating a live budget.
export const paidStatuses = (status) => (status === "shadow" ? ["pending", "cleared", "shadow"] : ["pending", "cleared"]);

// A prepared INSERT for the append-only audit log, for use inside a batch.
export function auditStatement(DB, { adminId = null, adminName, action, detail = "", ts }) {
  return DB.prepare(
    "INSERT INTO incentive_audit (id, admin_id, admin_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(generateId(), adminId, adminName, action, String(detail).slice(0, 1000), ts);
}

export async function adminDisplayName(DB, adminId) {
  const row = await DB.prepare("SELECT full_name FROM users WHERE id = ?").bind(adminId).first();
  return row?.full_name || "Admin";
}

// Courses are matched ignoring case, spaces and punctuation: "csc 305" == "CSC-305" == "CSC305".
export const courseKey = (course) => String(course || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ---- "Wanted" requests (bounties) vs resources ----------------------------------------------------
// A bounty is stored in the admin's vocabulary ('Past Questions', '300 Level'); a resource is stored in
// the upload form's vocabulary ('Past Question', '300'). They were never reconciled, so only the course
// was ever compared and an upload of ANY type or level for that course could claim the reward.
// This is the one place that translates between the two; every bounty check goes through it.
const BOUNTY_TYPE_TO_RESOURCE_TYPE = {
  "Past Questions": "Past Question",
  "Lecture Notes": "Lecture Note",
  "Revision Sheet": "Revision Sheet",
};
export const bountyTypeToResourceType = (t) => BOUNTY_TYPE_TO_RESOURCE_TYPE[t] ?? null;
export const bountyLevelToResourceLevel = (l) => {
  const m = /^(\d{3})(?:\s*level)?$/i.exec(String(l ?? "").trim());
  return m ? m[1] : null;
};

// bounty: { course_key, type, level }   target: { course, type, level } (a resource row or upload metadata)
export function bountyMatches(bounty, target) {
  if (!bounty || !target) return false;
  const wantType = bountyTypeToResourceType(bounty.type);
  const wantLevel = bountyLevelToResourceLevel(bounty.level);
  if (!wantType || !wantLevel) return false; // an unrecognised bounty can never be claimed by accident
  return (
    bounty.course_key === courseKey(target.course) &&
    wantType === target.type &&
    wantLevel === String(target.level ?? "").trim()
  );
}
