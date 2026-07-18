const Transaction = require("../models/Transaction");

// @route GET /api/admin/transactions/summary
// Powers the category-breakdown cards (Active/Suspended/Inactive)
async function getTransactionSummary(req, res) {
  try {
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
        $group: {
          _id: { $ifNull: ["$userInfo.accountStatus", "active"] },
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
        },
      },
    ]);

    const summary = {
      active: { volume: 0, count: 0, users: 0 },
      suspended: { volume: 0, count: 0, users: 0 },
      inactive: { volume: 0, count: 0, users: 0 },
    };

    results.forEach((r) => {
      if (summary[r._id]) {
        summary[r._id] = { volume: r.volume, count: r.count, users: r.users.length };
      }
    });

    return res.status(200).json({ success: true, summary });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch summary", error: err.message });
  }
}

// @route GET /api/admin/transactions
// Powers the transactions table, with search + filters matching users.js exactly
async function getTransactions(req, res) {
  try {
    const { search = "", category = "", type = "", status = "", page = 1, limit = 20 } = req.query;

    const matchConditions = {};
    if (category) matchConditions["userInfo.accountStatus"] = category;
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
                category: "$userInfo.accountStatus",
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