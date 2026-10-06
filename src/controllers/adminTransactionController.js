import { sanitizeError } from "../utils/sanitizeError.js";
import { EFFECTIVE_STATUS_CASE, activeSinceIso } from "./adminUserController.js";

// @route GET /api/admin/transactions/summary
// Powers the category-breakdown cards (Active/Suspended/Inactive) and the
// overview stat cards (Total Deposit Volume, Total Spent, etc).
export async function getTransactionSummary(c) {
  try {
    const activeSince = activeSinceIso();

    const { results } = await c.env.DB.prepare(
      `WITH tx_data AS (
         SELECT t.*, ${EFFECTIVE_STATUS_CASE} AS effective_status
         FROM transactions t
         JOIN users u ON u.id = t.user_id
       )
       SELECT
         effective_status,
         COUNT(*) AS count,
         COUNT(DISTINCT user_id) AS users,
         SUM(CASE WHEN type = 'deposit' AND status = 'successful' THEN amount ELSE 0 END) AS volume,
         SUM(CASE WHEN type = 'purchase' AND status = 'successful' THEN amount ELSE 0 END) AS spent
       FROM tx_data
       GROUP BY effective_status`
    )
      .bind(activeSince)
      .all();

    const summary = {
      active: { volume: 0, spent: 0, count: 0, users: 0 },
      suspended: { volume: 0, spent: 0, count: 0, users: 0 },
      inactive: { volume: 0, spent: 0, count: 0, users: 0 },
    };
    for (const r of results) {
      if (summary[r.effective_status]) {
        summary[r.effective_status] = { volume: r.volume, spent: r.spent, count: r.count, users: r.users };
      }
    }

    const totalDepositVolume = summary.active.volume + summary.suspended.volume + summary.inactive.volume;
    const totalSpentVolume = summary.active.spent + summary.suspended.spent + summary.inactive.spent;

    return c.json({ success: true, summary, totalDepositVolume, totalSpentVolume });
  } catch (err) {
    console.error("adminTransactionController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch summary", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/transactions
// Powers the transactions table, with search + filters matching users.js exactly
export async function getTransactions(c) {
  try {
    const search = c.req.query("search") || "";
    const category = c.req.query("category") || "";
    const type = c.req.query("type") || "";
    const status = c.req.query("status") || "";
    const page = Number(c.req.query("page")) || 1;
    const limit = Number(c.req.query("limit")) || 20;
    const skip = (page - 1) * limit;

    const cte = `
      WITH tx_data AS (
        SELECT t.*, u.full_name AS user_full_name, u.email AS user_email,
               ${EFFECTIVE_STATUS_CASE} AS effective_status
        FROM transactions t
        JOIN users u ON u.id = t.user_id
      )
    `;
    const activeSince = activeSinceIso();

    const conditions = ["1 = 1"];
    const params = [];
    if (category) { conditions.push("effective_status = ?"); params.push(category); }
    if (type) { conditions.push("type = ?"); params.push(type); }
    if (status) { conditions.push("status = ?"); params.push(status); }
    if (search) {
      conditions.push("(user_full_name LIKE ? OR user_email LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = conditions.join(" AND ");

    const dataSql = `${cte} SELECT * FROM tx_data WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const countSql = `${cte} SELECT COUNT(*) AS n FROM tx_data WHERE ${where}`;

    const [{ results }, countRow] = await Promise.all([
      c.env.DB.prepare(dataSql).bind(activeSince, ...params, limit, skip).all(),
      c.env.DB.prepare(countSql).bind(activeSince, ...params).first(),
    ]);

    const total = countRow.n;
    return c.json({
      success: true,
      transactions: results.map((t) => ({
        id: t.id, user: t.user_full_name, email: t.user_email, category: t.effective_status,
        type: t.type, amount: t.amount, status: t.status, date: t.created_at,
      })),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("adminTransactionController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch transactions", error: sanitizeError(c.env, err) }, 500);
  }
}
