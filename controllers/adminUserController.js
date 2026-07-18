const User = require("../models/User");
const Resource = require("../models/Resource");

const ACTIVE_WINDOW_DAYS = 7;

function formatJoinDate(date) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function formatShortDate(date) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// @route GET /api/admin/users/filter-options
async function getUserFilterOptions(req, res) {
  try {
    const departments = await User.distinct("department", { role: "student" });
    return res.status(200).json({ success: true, departments: departments.sort() });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch filter options", error: err.message });
  }
}

// @route GET /api/admin/users
async function getUsers(req, res) {
  try {
    const {
      search = "", department = "", level = "", status = "",
      contribution = "", page = 1, limit = 20,
    } = req.query;

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;

    const matchStage = { role: "student" };
    if (search) {
      matchStage.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { matricNumber: { $regex: search, $options: "i" } },
      ];
    }
    if (department) matchStage.department = department;
    if (level) matchStage.level = level;
    if (status) matchStage.accountStatus = status;

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: "resources",
          localField: "_id",
          foreignField: "uploader",
          as: "uploads",
        },
      },
      {
        $addFields: {
          uploadsCount: { $size: "$uploads" },
          approvedCount: {
            $size: { $filter: { input: "$uploads", cond: { $eq: ["$$this.status", "approved"] } } },
          },
          rejectedCount: {
            $size: { $filter: { input: "$uploads", cond: { $eq: ["$$this.status", "rejected"] } } },
          },
        },
      },
    ];

    if (contribution === "has_uploads") pipeline.push({ $match: { uploadsCount: { $gt: 0 } } });
    if (contribution === "no_uploads") pipeline.push({ $match: { uploadsCount: 0 } });

    pipeline.push(
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum },
            {
              $project: {
                id: "$_id",
                fullName: 1,
                email: 1,
                department: 1,
                level: 1,
                accountStatus: 1,
                uploadsCount: 1,
                approvedCount: 1,
                rejectedCount: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      }
    );

    const result = await User.aggregate(pipeline);
    const users = result[0].data;
    const total = result[0].totalCount[0]?.count || 0;

    const activeSince = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [totalUsers, activeThisWeek, contributorIds] = await Promise.all([
      User.countDocuments({ role: "student" }),
      User.countDocuments({ role: "student", lastLoginAt: { $gte: activeSince } }),
      Resource.distinct("uploader"),
    ]);

    return res.status(200).json({
      success: true,
      users,
      stats: { totalUsers, activeThisWeek, contributors: contributorIds.length },
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch users", error: err.message });
  }
}

// @route GET /api/admin/users/:id
async function getUserProfile(req, res) {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const uploads = await Resource.find({ uploader: user._id }).sort({ createdAt: -1 });

    const uploadsCount = uploads.length;
    const approvedCount = uploads.filter((u) => u.status === "approved").length;
    const rejectedCount = uploads.filter((u) => u.status === "rejected").length;
    const approvalRate = uploadsCount > 0 ? Math.round((approvedCount / uploadsCount) * 100) : 0;
    const totalDownloads = uploads.reduce((sum, u) => sum + (u.downloads || 0), 0);

    const recentUploads = uploads.slice(0, 5).map((u) => ({
      title: u.title,
      date: formatShortDate(u.createdAt),
      status: u.status,
    }));

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        department: user.department,
        level: user.level,
        accountStatus: user.accountStatus,
        joinedDate: formatJoinDate(user.createdAt),
        uploadsCount,
        approvedCount,
        rejectedCount,
        approvalRate,
        totalDownloads,
        recentUploads,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch user profile", error: err.message });
  }
}

// @route POST /api/admin/users/:id/suspend
async function suspendUser(req, res) {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: "A suspension reason is required" });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.accountStatus = "suspended";
    user.suspensionReason = reason;
    user.suspendedAt = new Date();
    await user.save();

    return res.status(200).json({ success: true, message: "Account suspended successfully" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not suspend user", error: err.message });
  }
}

module.exports = { getUserFilterOptions, getUsers, getUserProfile, suspendUser };