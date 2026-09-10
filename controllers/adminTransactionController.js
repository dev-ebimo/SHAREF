const Transaction = require("../models/Transaction");

const ACTIVE_WINDOW_DAYS = 7;

// @route GET /api/admin/transactions/summary
// Powers the category-breakdown cards (Active/Suspended/Inactive) and the
// overview stat cards (Total Deposit Volume, Total Spent, etc).
async function getTransactionSummary(req, res) {
  try {
    const activeSince = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const results = await Transaction.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      { $unwind: "$userInfo" },
      {
        $addFields: {
          // Same rule as adminUserController.js's getUsers/getUserProfile:
          // suspension (an explicit admin action) always wins; otherwise a
          // student who hasn't logged in within the active window is
          // "inactive". Computed here rather than read off a stored
          // field, since accountStatus itself never actually holds
          // "inactive" — nothing else in the app writes that value.
          effectiveStatus: {
            $switch: {
              branches: [
                { case: { $eq: ["$userInfo.accountStatus", "suspended"] }, then: "suspended" },
                {
                  case: {
                    $or: [
                      { $eq: ["$userInfo.lastLoginAt", null] },
                      { $lt: ["$userInfo.lastLoginAt", activeSince] },
                    ],
                  },
                  then: "inactive",
                },
              ],
              default: "active",
            },
          },
        },
      },
      {
        $group: {
          _id: "$effectiveStatus",
          count: { $sum: 1 },
          users: { $addToSet: "$user" },
          volume: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$type", "deposit"] }, { $eq: ["$status", "successful"] }] },
                "$amount",
                0,
              ],
            },
          },
          spent: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$type", "purchase"] }, { $eq: ["$status", "successful"] }] },
                "$amount",
                0,
              ],
            },
          },
        },
      },
    ]);

    const summary = {
      active: { volume: 0, spent: 0, count: 0, users: 0 },
      suspended: { volume: 0, spent: 0, count: 0, users: 0 },
      inactive: { volume: 0, spent: 0, count: 0, users: 0 },
    };

    results.forEach((r) => {
      if (summary[r._id]) {
        summary[r._id] = { volume: r.volume, spent: r.spent, count: r.count, users: r.users.length };
      }
    });

    // Site-wide totals across all categories, for the overview stat cards.
    const totalDepositVolume = summary.active.volume + summary.suspended.volume + summary.inactive.volume;
    const totalSpentVolume = summary.active.spent + summary.suspended.spent + summary.inactive.spent;

    return res.status(200).json({ success: true, summary, totalDepositVolume, totalSpentVolume });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch summary", error: err.message });
  }
}

// @route GET /api/admin/transactions
// Powers the transactions table, with search + filters matching users.js exactly
async function getTransactions(req, res) {
  try {
    const { search = "", category = "", type = "", status = "", page = 1, limit = 20 } = req.query;
    const activeSince = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const matchConditions = {};
    if (category) matchConditions.effectiveStatus = category;
    if (type) matchConditions.type = type;
    if (status) matchConditions.status = status;
    if (search) {
      matchConditions.$or = [
        { "userInfo.fullName": { $regex: search, $options: "i" } },
        { "userInfo.email": { $regex: search, $options: "i" } },
      ];
    }

    const pipeline = [
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      { $unwind: "$userInfo" },
      {
        $addFields: {
          // Same rule as getTransactionSummary/adminUserController.js —
          // see the comment there for why this can't just read
          // userInfo.accountStatus directly.
          effectiveStatus: {
            $switch: {
              branches: [
                { case: { $eq: ["$userInfo.accountStatus", "suspended"] }, then: "suspended" },
                {
                  case: {
                    $or: [
                      { $eq: ["$userInfo.lastLoginAt", null] },
                      { $lt: ["$userInfo.lastLoginAt", activeSince] },
                    ],
                  },
                  then: "inactive",
                },
              ],
              default: "active",
            },
          },
        },
      },
      { $match: matchConditions },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: (Number(page) - 1) * Number(limit) },
            { $limit: Number(limit) },
            {
              $project: {
                id: "$_id",
                user: "$userInfo.fullName",
                email: "$userInfo.email",
                category: "$effectiveStatus",
                type: 1,
                amount: 1,
                status: 1,
                date: "$createdAt",
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const result = await Transaction.aggregate(pipeline);
    const data = result[0].data;
    const total = result[0].totalCount[0]?.count || 0;

    return res.status(200).json({
      success: true,
      transactions: data,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch transactions", error: err.message });
  }
}

module.exports = { getTransactionSummary, getTransactions };