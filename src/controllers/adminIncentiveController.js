import { sanitizeError } from "../utils/sanitizeError.js";
import { generateId } from "../utils/id.js";
import { startOfMonthInLagos, endOfLagosDayIso, todayInLagosYmd } from "../utils/lagosDay.js";
import {
  STATUSES, RULE_KEYS, REWARD_KEYS,
  getIncentiveConfig, paidStatuses, auditStatement, adminDisplayName, courseKey,
} from "../services/incentiveConfig.js";
import { reversalStatements } from "../services/rewardReversal.js";

// Every route here is admin-only (see adminIncentiveRoutes.js). Every consequential
// change is written to the append-only audit log IN THE SAME BATCH as the change itself,
// so there is no window where something changed but wasn't recorded.

const fail = (c, status, message) => c.json({ success: false, message }, status);
const placeholders = (arr) => arr.map(() => "?").join(",");
const naira = (n) => "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");
const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");
const PAGE_SIZE = 20;
const MAX_REASON = 500;

async function readBody(c) {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

// Returns the trimmed reason, or null when it's missing/too short/too long.
function cleanReason(raw) {
  const reason = typeof raw === "string" ? raw.trim() : "";
  return reason.length >= 5 && reason.length <= MAX_REASON ? reason : null;
}
const REASON_MSG = "Please give a reason (at least 5 characters).";

const FIELD_LABELS = {
  monthlyBudget: "Monthly reward budget",
  weeklyCap: "Weekly earning cap",
  maxSinglePayout: "Largest single payout",
  adminDailyLimit: "Daily award limit per moderator",
  holdDays: "Hold period",
  ratioAlert: "Revenue alert threshold",
  pastQuestion: "Standard: past question",
  lectureNote: "Standard: lecture note",
  high: "High-value tier",
  rare: "Rare tier",
  firstApproval: "First approved upload bonus",
  referralSignup: "Referral: friend signs up",
  referralFirstApproval: "Referral: friend's first upload approved",
};
const FIELD_MAX = { holdDays: 30 };

function flatConfig(cfg) {
  return {
    success: true,
    status: cfg.status,
    ...cfg.rules,
    rewards: { ...cfg.rules.rewards },
    ...(cfg.season ? { seasonName: cfg.season.name, seasonEndsAt: cfg.season.endsAt } : {}),
    updatedAt: cfg.updatedAt,
  };
}

// @route GET /api/admin/incentives/flag-count   (cheap: it feeds the sidebar badge on every admin page)
export async function getFlagCount(c) {
  try {
    const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM incentive_flags WHERE status = 'open'").first();
    return c.json({ success: true, flagsOpen: row?.n || 0 });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load flags", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/incentives/summary
export async function getSummary(c) {
  try {
    const DB = c.env.DB;
    const cfg = await getIncentiveConfig(DB);
    const monthStart = startOfMonthInLagos().toISOString();
    const counted = paidStatuses(cfg.status);
    const inCounted = placeholders(counted);

    const [paid, owed, redeemed, revenue, approved, flags, approvals, payouts, repeats] = await Promise.all([
      DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM reward_ledger WHERE type = 'reward' AND created_at >= ? AND status IN (${inCounted})`)
        .bind(monthStart, ...counted).first(),
      // The real liability: positive reward balances plus rewards still in their hold period.
      // A negative balance (reversal after spending) is a receivable, not a reason to owe less.
      DB.prepare("SELECT COALESCE(SUM(CASE WHEN reward_balance > 0 THEN reward_balance ELSE 0 END), 0) + COALESCE(SUM(reward_pending), 0) AS n FROM users").first(),
      DB.prepare("SELECT COALESCE(SUM(from_rewards), 0) AS n FROM transactions WHERE type = 'purchase' AND status = 'successful' AND created_at >= ?")
        .bind(monthStart).first(),
      DB.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE type = 'deposit' AND status = 'successful' AND created_at >= ?")
        .bind(monthStart).first(),
      DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'approved' AND reviewed_at >= ?").bind(monthStart).first(),
      DB.prepare("SELECT COUNT(*) AS n FROM incentive_flags WHERE status = 'open'").first(),
      DB.prepare(
        `SELECT u.id, u.full_name AS name, COUNT(*) AS approvals
           FROM resources r JOIN users u ON u.id = r.reviewed_by
          WHERE r.status = 'approved' AND r.reviewed_at >= ? GROUP BY u.id`
      ).bind(monthStart).all(),
      DB.prepare(
        `SELECT approved_by AS id, COALESCE(SUM(amount), 0) AS paid,
                COALESCE(SUM(CASE WHEN tier IN ('high','rare') THEN 1 ELSE 0 END), 0) AS high_rare
           FROM reward_ledger
          WHERE type = 'reward' AND approved_by IS NOT NULL AND created_at >= ? AND status IN (${inCounted})
          GROUP BY approved_by`
      ).bind(monthStart, ...counted).all(),
      DB.prepare(
        `SELECT approved_by AS id, COUNT(*) AS n FROM reward_ledger
          WHERE type = 'reward' AND approved_by IS NOT NULL AND created_at >= ?
            AND tier IN ('standard','high','rare','bounty') AND status IN (${inCounted})
          GROUP BY approved_by, user_id HAVING COUNT(*) >= 5`
      ).bind(monthStart, ...counted).all(),
    ]);

    // ---- per-moderator table + "needs attention" heuristics ----
    const payoutById = new Map(payouts.results.map((p) => [p.id, p]));
    const repeatPayeeIds = new Set(repeats.results.map((r) => r.id));
    const totalApprovals = approvals.results.reduce((s, a) => s + a.approvals, 0);
    const avgPerApproval = totalApprovals > 0 ? paid.n / totalApprovals : 0;

    const admins = approvals.results
      .map((a) => {
        const p = payoutById.get(a.id) || { paid: 0, high_rare: 0 };
        let flagged = null;
        if (avgPerApproval > 0 && a.approvals >= 3 && p.paid / a.approvals > 3 * avgPerApproval) flagged = "Pays far above average";
        else if (repeatPayeeIds.has(a.id)) flagged = "Pays the same student repeatedly";
        return { name: a.name, approvals: a.approvals, paid: p.paid, highRare: p.high_rare, flagged };
      })
      .sort((x, y) => y.paid - x.paid);

    const alerts = [];
    if ((cfg.status === "shadow" || cfg.status === "live") && cfg.rules.monthlyBudget <= 0) {
      alerts.push({ level: "bad", text: "No monthly budget is set, so no rewards can be paid. Set one in Rules." });
    }
    if (cfg.status === "live" && cfg.rules.weeklyCap <= 0) {
      alerts.push({ level: "warn", text: "No weekly earning cap is set. Set one in Rules to limit what one student can earn." });
    }

    if (cfg.status === "paused") {
      const auto = await DB.prepare("SELECT created_at FROM incentive_audit WHERE action = 'auto-pause' AND created_at >= ? ORDER BY created_at DESC LIMIT 1").bind(monthStart).first();
      if (auto) alerts.push({ level: "warn", text: "Rewards were paused automatically because this month's budget was reached. Raise the budget in Rules (or wait for next month), then switch back to Live." });
    }

    return c.json({
      success: true,
      status: cfg.status,
      config: { ratioAlert: cfg.rules.ratioAlert, maxSinglePayout: cfg.rules.maxSinglePayout },
      budget: { monthlyCap: cfg.rules.monthlyBudget, paidThisMonth: paid.n, shadow: cfg.status === "shadow" },
      outstanding: owed.n,
      redeemed: redeemed.n,
      fundedRevenue: revenue.n,
      approvedCount: approved.n,
      flagsOpen: flags.n,
      alerts,
      admins,
    });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load the summary", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/admin/incentives/status   { status, reason }
export async function setStatus(c) {
  try {
    const DB = c.env.DB;
    const admin = c.get("user");
    const body = await readBody(c);
    const status = body?.status;
    if (!STATUSES.includes(status)) return fail(c, 400, "Status must be one of: off, shadow, live, paused.");
    const reason = cleanReason(body?.reason);
    if (!reason) return fail(c, 400, REASON_MSG);

    const cfg = await getIncentiveConfig(DB);
    if (cfg.status === status) return fail(c, 400, `Rewards are already ${status}.`);
    if (status === "live" && !(cfg.rules.monthlyBudget > 0)) {
      return fail(c, 400, "Set a monthly reward budget in Rules before going live.");
    }

    const ts = new Date().toISOString();
    const name = await adminDisplayName(DB, admin.id);
    await DB.batch([
      DB.prepare(
        `INSERT INTO incentive_config (id, status, rules, updated_by, updated_at) VALUES (1, ?, '{}', ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).bind(status, admin.id, ts),
      auditStatement(DB, { adminId: admin.id, adminName: name, action: "status", detail: `${cfg.status} → ${status}. Reason: ${reason}`, ts }),
    ]);
    return c.json({ success: true, status });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not change the status", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/incentives/config
export async function getConfig(c) {
  try {
    return c.json(flatConfig(await getIncentiveConfig(c.env.DB)));
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load the rules", error: sanitizeError(c.env, err) }, 500);
  }
}

function checkWholeNumber(key, value) {
  const max = FIELD_MAX[key] ?? 10_000_000;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    return `${FIELD_LABELS[key]} must be a whole number from 0 to ${max.toLocaleString("en-NG")}.`;
  }
  return null;
}

// @route PUT /api/admin/incentives/config   { rules, reason }
export async function updateConfig(c) {
  try {
    const DB = c.env.DB;
    const admin = c.get("user");
    const body = await readBody(c);
    const reason = cleanReason(body?.reason);
    if (!reason) return fail(c, 400, REASON_MSG);
    const r = body?.rules;
    if (!r || typeof r !== "object" || !r.rewards || typeof r.rewards !== "object") {
      return fail(c, 400, "Send the full set of rules, including the reward amounts.");
    }

    const next = { rewards: {} };
    for (const k of RULE_KEYS) {
      const msg = checkWholeNumber(k, r[k]);
      if (msg) return fail(c, 400, msg);
      next[k] = r[k];
    }
    for (const k of REWARD_KEYS) {
      const msg = checkWholeNumber(k, r.rewards[k]);
      if (msg) return fail(c, 400, msg);
      next.rewards[k] = r.rewards[k];
    }

    // No single approval may ever pay more than the configured ceiling, whatever tier is picked.
    const clamped = [];
    for (const k of REWARD_KEYS) {
      if (next.rewards[k] > next.maxSinglePayout) {
        clamped.push(`${FIELD_LABELS[k]} ${naira(next.rewards[k])} → ${naira(next.maxSinglePayout)}`);
        next.rewards[k] = next.maxSinglePayout;
      }
    }

    const cfg = await getIncentiveConfig(DB);
    const changes = [];
    for (const k of RULE_KEYS) if (cfg.rules[k] !== next[k]) changes.push(`${k} ${cfg.rules[k]}→${next[k]}`);
    for (const k of REWARD_KEYS) if (cfg.rules.rewards[k] !== next.rewards[k]) changes.push(`rewards.${k} ${cfg.rules.rewards[k]}→${next.rewards[k]}`);
    if (changes.length === 0) return c.json({ ...flatConfig(cfg), unchanged: true });

    const ts = new Date().toISOString();
    const name = await adminDisplayName(DB, admin.id);
    const detail =
      `${changes.join(", ")}.` + (clamped.length ? ` Capped at the largest single payout: ${clamped.join("; ")}.` : "") + ` Reason: ${reason}`;
    await DB.batch([
      DB.prepare(
        `INSERT INTO incentive_config (id, status, rules, updated_by, updated_at) VALUES (1, 'off', ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET rules = excluded.rules, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).bind(JSON.stringify(next), admin.id, ts),
      auditStatement(DB, { adminId: admin.id, adminName: name, action: "rules", detail, ts }),
    ]);

    return c.json({ ...flatConfig(await getIncentiveConfig(DB)), ...(clamped.length ? { clamped } : {}) });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not save the rules", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/incentives/payouts?page=1&status=&q=
export async function getPayouts(c) {
  try {
    const DB = c.env.DB;
    const page = Math.max(parseInt(c.req.query("page"), 10) || 1, 1);
    const status = c.req.query("status") || "";
    const q = (c.req.query("q") || "").trim().slice(0, 60);

    const where = ["l.type = 'reward'"];
    const args = [];
    if (["pending", "cleared", "reversed", "shadow"].includes(status)) {
      where.push("l.status = ?");
      args.push(status);
    }
    if (q) {
      where.push("(u.full_name LIKE ? ESCAPE '\\' OR l.label LIKE ? ESCAPE '\\')");
      args.push(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`);
    }
    const from = `FROM reward_ledger l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.approved_by WHERE ${where.join(" AND ")}`;

    const [total, rows] = await Promise.all([
      DB.prepare(`SELECT COUNT(*) AS n ${from.replace("LEFT JOIN users a ON a.id = l.approved_by ", "")}`).bind(...args).first(),
      DB.prepare(
        `SELECT l.id, l.created_at, l.label, l.tier, l.amount, l.status, u.full_name AS student, a.full_name AS approver
         ${from} ORDER BY l.created_at DESC, l.id LIMIT ? OFFSET ?`
      ).bind(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE).all(),
    ]);

    return c.json({
      success: true,
      payouts: rows.results.map((p) => ({
        id: p.id, date: p.created_at, student: p.student || "Deleted account", label: p.label,
        tier: p.tier, amount: p.amount, status: p.status, approvedBy: p.approver || null,
      })),
      pagination: { page, pages: Math.max(Math.ceil(total.n / PAGE_SIZE), 1), total: total.n },
    });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load payouts", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/admin/incentives/payouts/:id/reverse   { reason }
export async function reversePayout(c) {
  try {
    const DB = c.env.DB;
    const admin = c.get("user");
    const body = await readBody(c);
    const reason = cleanReason(body?.reason);
    if (!reason) return fail(c, 400, REASON_MSG);

    const row = await DB.prepare("SELECT * FROM reward_ledger WHERE id = ? AND type = 'reward'").bind(c.req.param("id")).first();
    if (!row) return fail(c, 404, "Payout not found.");
    if (row.status === "reversed") return fail(c, 409, "This reward was already reversed.");
    if (row.status === "shadow") return fail(c, 400, "This was only recorded in shadow mode. No money moved, so there is nothing to reverse.");
    if (!row.user_id) return fail(c, 409, "This student's account no longer exists.");

    const student = await DB.prepare("SELECT full_name FROM users WHERE id = ?").bind(row.user_id).first();
    const ts = new Date().toISOString();
    const name = await adminDisplayName(DB, admin.id);

    await DB.batch(
      reversalStatements(DB, row, {
        adminId: admin.id, adminName: name, reason, ts,
        audit: { action: "reverse", detail: `${student?.full_name || "Student"}: took back ${naira(row.amount)} (${row.label || row.tier || "reward"}). Reason: ${reason}` },
      })
    );

    // Confirm THIS request did it (a second moderator clicking at the same moment loses cleanly).
    const after = await DB.prepare("SELECT reversed_at, reversed_by FROM reward_ledger WHERE id = ?").bind(row.id).first();
    if (after?.reversed_at !== ts || after?.reversed_by !== admin.id) {
      return fail(c, 409, "This reward was already reversed.");
    }
    return c.json({ success: true, message: "Reward reversed." });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not reverse the reward", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/incentives/flags?status=open
export async function getFlags(c) {
  try {
    const status = c.req.query("status") || "open";
    const filter = ["open", "dismissed", "frozen", "reversed"].includes(status) ? status : "open";
    const { results } = await c.env.DB.prepare(
      `SELECT f.id, f.exposure, f.signals, f.status, f.created_at, u.full_name AS student
         FROM incentive_flags f JOIN users u ON u.id = f.user_id
        WHERE f.status = ? ORDER BY f.created_at DESC LIMIT 100`
    ).bind(filter).all();

    return c.json({
      success: true,
      flags: results.map((f) => {
        let signals = [];
        try { signals = JSON.parse(f.signals || "[]"); } catch { /* corrupt signals just show as none */ }
        return { id: f.id, student: f.student, exposure: f.exposure, signals: Array.isArray(signals) ? signals : [], status: f.status, createdAt: f.created_at };
      }),
    });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load flags", error: sanitizeError(c.env, err) }, 500);
  }
}

const REVERSE_CHUNK = 8; // rewards reversed per atomic batch (5 statements each = 40; kept modest, see CLEAR_LIMITS in jobs/incentiveJobs.js)

// @route POST /api/admin/incentives/flags/:id/resolve   { action: freeze|reverse_all|dismiss, note }
// (the frontend sends the moderator's written reason as `note`)
export async function resolveFlag(c) {
  try {
    const DB = c.env.DB;
    const admin = c.get("user");
    const body = await readBody(c);
    const action = body?.action;
    if (!["freeze", "reverse_all", "dismiss"].includes(action)) return fail(c, 400, "Action must be freeze, reverse_all or dismiss.");
    const note = cleanReason(body?.note ?? body?.reason);
    if (!note) return fail(c, 400, REASON_MSG);

    const flag = await DB.prepare(
      "SELECT f.id, f.user_id, u.full_name FROM incentive_flags f JOIN users u ON u.id = f.user_id WHERE f.id = ? AND f.status = 'open'"
    ).bind(c.req.param("id")).first();
    if (!flag) return fail(c, 404, "This flag was not found or is already resolved.");

    const ts = new Date().toISOString();
    const name = await adminDisplayName(DB, admin.id);
    const resolve = (newStatus) =>
      DB.prepare("UPDATE incentive_flags SET status = ?, resolved_by = ?, resolved_at = ?, note = ?, updated_at = ? WHERE id = ? AND status = 'open'")
        .bind(newStatus, admin.id, ts, note, ts, flag.id);

    if (action === "dismiss") {
      await DB.batch([resolve("dismissed"), auditStatement(DB, { adminId: admin.id, adminName: name, action: "flag.dismiss", detail: `${flag.full_name}: flag dismissed. Reason: ${note}`, ts })]);
      return c.json({ success: true, message: "Flag dismissed." });
    }

    if (action === "freeze") {
      await DB.batch([
        DB.prepare("UPDATE users SET rewards_frozen = 1, updated_at = ? WHERE id = ?").bind(ts, flag.user_id),
        resolve("frozen"),
        auditStatement(DB, { adminId: admin.id, adminName: name, action: "flag.freeze", detail: `${flag.full_name}: rewards frozen. Reason: ${note}`, ts }),
      ]);
      return c.json({ success: true, message: "Rewards frozen for this student." });
    }

    // reverse_all: take back every reward that is still pending or cleared.
    const { results: rows } = await DB.prepare(
      `SELECT id, user_id, amount, tier, label, resource_id, bounty_id, referral_id FROM reward_ledger
        WHERE user_id = ? AND type = 'reward' AND status IN ('pending','cleared') ORDER BY created_at`
    ).bind(flag.user_id).all();

    for (let i = 0; i < rows.length; i += REVERSE_CHUNK) {
      const statements = rows.slice(i, i + REVERSE_CHUNK).flatMap((row) =>
        reversalStatements(DB, row, { adminId: admin.id, adminName: name, reason: note, ts })
      );
      await DB.batch(statements);
    }

    const done = await DB.prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM reward_ledger WHERE user_id = ? AND type = 'reward' AND reversed_at = ? AND reversed_by = ?"
    ).bind(flag.user_id, ts, admin.id).first();

    await DB.batch([
      resolve("reversed"),
      auditStatement(DB, { adminId: admin.id, adminName: name, action: "flag.reverse_all", detail: `${flag.full_name}: reversed ${done.n} reward(s) totalling ${naira(done.total)}. Reason: ${note}`, ts }),
    ]);
    return c.json({ success: true, message: `Reversed ${done.n} reward(s) totalling ${naira(done.total)}.` });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not resolve the flag", error: sanitizeError(c.env, err) }, 500);
  }
}

// ---- Requests ("Wanted" bounties) ------------------------------------------
const REQUEST_TYPES = ["Past Questions", "Lecture Notes", "Revision Sheet"];
const REQUEST_LEVELS = ["100 Level", "200 Level", "300 Level", "400 Level", "500 Level", "600 Level"];

// @route GET /api/admin/incentives/requests
export async function listRequests(c) {
  try {
    const now = new Date().toISOString();
    const { results } = await c.env.DB.prepare(
      "SELECT id, course, type, level, reward, paid, max_payouts, expires_at, status FROM bounties ORDER BY created_at DESC LIMIT 100"
    ).all();
    return c.json({
      success: true,
      requests: results.map((b) => ({
        id: b.id, course: b.course, type: b.type, level: b.level, reward: b.reward, paid: b.paid, maxPayouts: b.max_payouts,
        expiresAt: b.expires_at, status: b.status === "open" && b.expires_at <= now ? "expired" : b.status,
      })),
    });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load requests", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/admin/incentives/requests
// { course, type, level, reward, maxPayouts, expiresAt:"YYYY-MM-DD" }
// `reason` is OPTIONAL here: the publish form has no reason field (every other write requires one).
export async function createRequest(c) {
  try {
    const DB = c.env.DB;
    const admin = c.get("user");
    const body = await readBody(c);
    if (!body) return fail(c, 400, "Invalid request.");

    const course = String(body.course ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9 -]{1,19}$/.test(course)) return fail(c, 400, "Enter a valid course code, e.g. CSC 305.");
    if (!REQUEST_TYPES.includes(body.type)) return fail(c, 400, "Choose what is wanted: past questions, lecture notes or a revision sheet.");
    if (!REQUEST_LEVELS.includes(body.level)) return fail(c, 400, "Choose a level.");

    const cfg = await getIncentiveConfig(DB);
    const max = cfg.rules.maxSinglePayout;
    if (!Number.isInteger(body.reward) || body.reward < 1 || body.reward > max) {
      return fail(c, 400, `Reward must be a whole number between ₦1 and ${naira(max)} (your largest single payout).`);
    }
    if (!Number.isInteger(body.maxPayouts) || body.maxPayouts < 1 || body.maxPayouts > 3) return fail(c, 400, "Pay between 1 and 3 students.");

    const today = todayInLagosYmd();
    const limit = new Date(Date.parse(today) + 365 * 86400000).toISOString().slice(0, 10);
    const expiresAt = endOfLagosDayIso(body.expiresAt);
    if (!expiresAt) return fail(c, 400, "Pick a valid closing date.");
    if (body.expiresAt < today) return fail(c, 400, "The closing date can't be in the past.");
    if (body.expiresAt > limit) return fail(c, 400, "The closing date can be at most a year away.");

    const note = String(body.note ?? "").trim().slice(0, 200);
    const key = courseKey(course);
    const now = new Date().toISOString();

    const dup = await DB.prepare(
      "SELECT id FROM bounties WHERE course_key = ? AND type = ? AND level = ? AND status = 'open' AND expires_at > ? AND paid < max_payouts"
    ).bind(key, body.type, body.level, now).first();
    if (dup) return fail(c, 409, "There is already an open request for this.");

    const id = generateId();
    const name = await adminDisplayName(DB, admin.id);
    await DB.batch([
      DB.prepare(
        `INSERT INTO bounties (id, course, course_key, type, level, reward, max_payouts, paid, note, expires_at, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'open', ?, ?, ?)`
      ).bind(id, course, key, body.type, body.level, body.reward, body.maxPayouts, note, expiresAt, admin.id, now, now),
      auditStatement(DB, {
        adminId: admin.id, adminName: name, action: "request.create", ts: now,
        detail: `${course} ${body.type} (${body.level}), ${naira(body.reward)} × ${body.maxPayouts}, closes ${body.expiresAt}` + (typeof body.reason === "string" && body.reason.trim() ? `. Reason: ${body.reason.trim().slice(0, MAX_REASON)}` : ""),
      }),
    ]);
    return c.json({ success: true, id });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not publish the request", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/admin/incentives/requests/:id/close   { reason }
export async function closeRequest(c) {
  try {
    const DB = c.env.DB;
    const admin = c.get("user");
    const body = await readBody(c);
    const reason = cleanReason(body?.reason);
    if (!reason) return fail(c, 400, REASON_MSG);

    const b = await DB.prepare("SELECT id, course, type, status FROM bounties WHERE id = ?").bind(c.req.param("id")).first();
    if (!b) return fail(c, 404, "Request not found.");
    if (b.status !== "open") return fail(c, 409, "This request is already closed.");

    const ts = new Date().toISOString();
    const name = await adminDisplayName(DB, admin.id);
    await DB.batch([
      DB.prepare("UPDATE bounties SET status = 'closed', updated_at = ? WHERE id = ? AND status = 'open'").bind(ts, b.id),
      auditStatement(DB, { adminId: admin.id, adminName: name, action: "request.close", detail: `${b.course} ${b.type}: closed. Reason: ${reason}`, ts }),
    ]);
    return c.json({ success: true });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not close the request", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/incentives/audit
export async function getAudit(c) {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT created_at, admin_name, action, detail FROM incentive_audit ORDER BY created_at DESC, rowid DESC LIMIT 100"
    ).all();
    return c.json({ success: true, entries: results.map((e) => ({ date: e.created_at, admin: e.admin_name, action: e.action, detail: e.detail })) });
  } catch (err) {
    console.error("adminIncentiveController error:", err?.message);
    return c.json({ success: false, message: "Could not load the audit log", error: sanitizeError(c.env, err) }, 500);
  }
}
