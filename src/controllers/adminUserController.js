import { sanitizeError } from "../utils/sanitizeError.js";
import { invalidateAuthCache } from "../middleware/protect.js";
const ACTIVE_WINDOW_DAYS = 7;

function activeSinceIso() {
  return new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Same rule everywhere it appears (here and in adminTransactionController.js):
// suspension (an explicit admin action) always wins; otherwise a student
// who hasn't logged in within the active window is "inactive". Computed
// on read rather than stored, so it's never stale — accountStatus itself
// never actually holds "inactive", nothing else in the app writes that value.
const EFFECTIVE_STATUS_CASE = `
  CASE
    WHEN u.account_status = 'suspended' THEN 'suspended'
    WHEN u.last_login_at IS NULL OR u.last_login_at < ? THEN 'inactive'
    ELSE 'active'
  END
`;

function formatJoinDate(date) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function formatShortDate(date) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// @route GET /api/admin/users/filter-options
export async function getUserFilterOptions(c) {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT DISTINCT department FROM users WHERE role = 'student' AND department IS NOT NULL ORDER BY department"
    ).all();
    return c.json({ success: true, departments: results.map((r) => r.department) });
  } catch (err) {
    console.error("adminUserController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch filter options", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/users
export async function getUsers(c) {
  try {
    const search = c.req.query("search") || "";
    const department = c.req.query("department") || "";
    const level = c.req.query("level") || "";
    const status = c.req.query("status") || "";
    const contribution = c.req.query("contribution") || "";
    const page = Number(c.req.query("page")) || 1;
    const limit = Number(c.req.query("limit")) || 20;
    const skip = (page - 1) * limit;

    const baseConditions = ["u.role = 'student'"];
    const baseParams = [];
    if (search) {
      baseConditions.push("(u.full_name LIKE ? OR u.email LIKE ? OR u.matric_number LIKE ?)");
      baseParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (department) { baseConditions.push("u.department = ?"); baseParams.push(department); }
    if (level) { baseConditions.push("u.level = ?"); baseParams.push(level); }

    // A CTE, rather than filtering on the computed effective_status/
    // uploads_count directly in WHERE — SQLite doesn't reliably support
    // referencing SELECT-list aliases in WHERE the way it does in
    // ORDER BY, so those filters apply in an outer query against the
    // CTE's already-computed columns instead.
    const cte = `
      WITH student_data AS (
        SELECT u.*,
          (SELECT COUNT(*) FROM resources r WHERE r.uploader_id = u.id) AS uploads_count,
          (SELECT COUNT(*) FROM resources r WHERE r.uploader_id = u.id AND r.status = 'approved') AS approved_count,
          (SELECT COUNT(*) FROM resources r WHERE r.uploader_id = u.id AND r.status = 'rejected') AS rejected_count,
          ${EFFECTIVE_STATUS_CASE} AS effective_status
        FROM users u
        WHERE ${baseConditions.join(" AND ")}
      )
    `;
    const activeSince = activeSinceIso();

    const outerConditions = ["1 = 1"];
    if (status) outerConditions.push("effective_status = ?");
    if (contribution === "has_uploads") outerConditions.push("uploads_count > 0");
    if (contribution === "no_uploads") outerConditions.push("uploads_count = 0");
    const outerWhere = outerConditions.join(" AND ");
    const outerParams = status ? [status] : [];

    const dataSql = `${cte} SELECT * FROM student_data WHERE ${outerWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const countSql = `${cte} SELECT COUNT(*) AS n FROM student_data WHERE ${outerWhere}`;

    const [{ results }, countRow, totalUsersRow, activeThisWeekRow, contributorsRow] = await Promise.all([
      c.env.DB.prepare(dataSql).bind(activeSince, ...baseParams, ...outerParams, limit, skip).all(),
      c.env.DB.prepare(countSql).bind(activeSince, ...baseParams, ...outerParams).first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student'").first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND last_login_at >= ?").bind(activeSince).first(),
      c.env.DB.prepare("SELECT COUNT(DISTINCT uploader_id) AS n FROM resources").first(),
    ]);

    const total = countRow.n;
    return c.json({
      success: true,
      users: results.map((u) => ({
        id: u.id, fullName: u.full_name, email: u.email, department: u.department, level: u.level,
        accountStatus: u.account_status, effectiveStatus: u.effective_status, lastLoginAt: u.last_login_at,
        uploadsCount: u.uploads_count, approvedCount: u.approved_count, rejectedCount: u.rejected_count,
      })),
      stats: { totalUsers: totalUsersRow.n, activeThisWeek: activeThisWeekRow.n, contributors: contributorsRow.n },
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("adminUserController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch users", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/users/:id
export async function getUserProfile(c) {
  try {
    const id = c.req.param("id");
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
    if (!user) return c.json({ success: false, message: "User not found" }, 404);

    const { results: uploads } = await c.env.DB.prepare("SELECT * FROM resources WHERE uploader_id = ? ORDER BY created_at DESC").bind(id).all();

    const uploadsCount = uploads.length;
    const approvedCount = uploads.filter((u) => u.status === "approved").length;
    const rejectedCount = uploads.filter((u) => u.status === "rejected").length;
    const approvalRate = uploadsCount > 0 ? Math.round((approvedCount / uploadsCount) * 100) : 0;
    const totalDownloads = uploads.reduce((sum, u) => sum + (u.downloads || 0), 0);

    const activeSince = activeSinceIso();
    const effectiveStatus =
      user.account_status === "suspended" ? "suspended" : (!user.last_login_at || user.last_login_at < activeSince) ? "inactive" : "active";

    // Only successful transactions count toward these totals — a pending
    // or failed deposit was never actually money in the wallet, and a
    // purchase can't reach "successful" without the charge having gone
    // through (see chargeForDownload in walletController.js).
    const [depositRow, purchaseRow] = await Promise.all([
      c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ? AND type = 'deposit' AND status = 'successful'").bind(id).first(),
      c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE user_id = ? AND type = 'purchase' AND status = 'successful'").bind(id).first(),
    ]);

    const recentUploads = uploads.slice(0, 5).map((u) => ({ title: u.title, date: formatShortDate(u.created_at), status: u.status }));

    return c.json({
      success: true,
      user: {
        id: user.id, fullName: user.full_name, email: user.email, department: user.department, level: user.level,
        accountStatus: user.account_status, effectiveStatus, lastLoginAt: user.last_login_at,
        joinedDate: formatJoinDate(user.created_at),
        uploadsCount, approvedCount, rejectedCount, approvalRate, totalDownloads,
        totalDeposited: depositRow.total, totalSpent: purchaseRow.total,
        recentUploads,
      },
    });
  } catch (err) {
    console.error("adminUserController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch user profile", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/admin/users/:id/suspend
export async function suspendUser(c) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) return c.json({ success: false, message: "A suspension reason is required" }, 400);

    const id = c.req.param("id");
    // Students only: an admin can never suspend an admin (or themselves) —
    // that would let one compromised/rogue admin lock everyone else out.
    const result = await c.env.DB.prepare(
      "UPDATE users SET account_status = 'suspended', suspension_reason = ?, suspended_at = ?, updated_at = ? WHERE id = ? AND role = 'student'"
    )
      .bind(reason.slice(0, 500), new Date().toISOString(), new Date().toISOString(), id)
      .run();

    if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
      const target = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(id).first();
      if (target) return c.json({ success: false, message: "Admin accounts cannot be suspended" }, 403);
      return c.json({ success: false, message: "User not found" }, 404);
    }
    invalidateAuthCache(id); // takes effect immediately on this isolate; <=15s elsewhere
    return c.json({ success: true, message: "Account suspended successfully" });
  } catch (err) {
    console.error("suspendUser failed:", err?.message);
    return c.json({ success: false, message: "Could not suspend user", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/admin/users/:id/reactivate
export async function reactivateUser(c) {
  try {
    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      "UPDATE users SET account_status = 'active', suspension_reason = '', suspended_at = NULL, failed_logins = 0, lockout_until = NULL, updated_at = ? WHERE id = ?"
    )
      .bind(new Date().toISOString(), id)
      .run();

    if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
      return c.json({ success: false, message: "User not found" }, 404);
    }
    invalidateAuthCache(id);
    return c.json({ success: true, message: "Account reactivated successfully" });
  } catch (err) {
    console.error("reactivateUser failed:", err?.message);
    return c.json({ success: false, message: "Could not reactivate user", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/users/deleted-log
// Powers the "Deleted Accounts" tab — a read-only history of accounts
// that were removed via deleteMyAccount (see userSettingsController.js),
// each one a snapshot taken right before the actual user row was deleted,
// since nothing here can be looked up live anymore.
export async function getDeletedAccountLogs(c) {
  try {
    const page = Number(c.req.query("page")) || 1;
    const limit = Number(c.req.query("limit")) || 20;
    const skip = (page - 1) * limit;

    const [{ results }, countRow] = await Promise.all([
      c.env.DB.prepare("SELECT * FROM deleted_account_logs ORDER BY created_at DESC LIMIT ? OFFSET ?").bind(limit, skip).all(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM deleted_account_logs").first(),
    ]);

    const total = countRow.n;
    return c.json({
      success: true,
      logs: results.map((log) => ({
        id: log.id, fullName: log.full_name, email: log.email, department: log.department, level: log.level,
        accountStatus: log.account_status, joinedAt: log.joined_at, deletedAt: log.created_at,
        walletBalanceAtDeletion: log.wallet_balance_at_deletion, uploadsCount: log.uploads_count,
        totalDeposited: log.total_deposited, totalSpent: log.total_spent,
      })),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("adminUserController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch deleted account logs", error: sanitizeError(c.env, err) }, 500);
  }
}

export { EFFECTIVE_STATUS_CASE, activeSinceIso };
