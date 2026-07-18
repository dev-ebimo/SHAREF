const Resource = require("../models/Resource");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { sendResourceStatusEmail } = require("../services/emailService");

const timeAgo = require("../utils/timeAgo");

const AGED_THRESHOLD_DAYS = 4;

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// @route GET /api/admin/moderation/queue
async function getModerationQueue(req, res) {
  try {
    const pendingResources = await Resource.find({ status: "pending" })
      .populate("uploader", "fullName")
      .sort({ createdAt: 1 }); // oldest first, so aged items surface naturally

    const now = new Date();
    const queue = pendingResources.map((r) => {
      const ageDays = (now - r.createdAt) / 86400000;
      return {
        id: r._id,
        title: r.title,
        type: r.type,
        dept: r.department,
        course: r.course,
        level: `${r.level} Level`,
        semester: r.semester,
        session: r.session,
        uploader: r.uploader.fullName,
        size: formatFileSize(r.fileSizeBytes),
        uploadDate: timeAgo(r.createdAt),
        isAged: ageDays >= AGED_THRESHOLD_DAYS,
      };
    });

    const [pending, approved, rejected] = await Promise.all([
      Resource.countDocuments({ status: "pending" }),
      Resource.countDocuments({ status: "approved" }),
      Resource.countDocuments({ status: "rejected" }),
    ]);

    return res.status(200).json({
      success: true,
      queue,
      stats: { pending, approved, rejected },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch queue", error: err.message });
  }
}

// @route POST /api/admin/moderation/:id/approve
async function approveResource(req, res) {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ success: false, message: "Resource not found" });

    resource.status = "approved";
    resource.reviewedBy = req.user.id;
    resource.reviewedAt = new Date();
    await resource.save();
    
    const uploader = await User.findById(resource.uploader);
    if (uploader) {
      if (uploader.preferences.notifications.uploadStatus.inApp) {
        await Notification.create({ resource: resource._id, recipient: uploader._id, type: "resource_approved" });
      }
      if (uploader.preferences.notifications.uploadStatus.email) {
        await sendResourceStatusEmail(uploader.email, uploader.fullName, resource.title, "approved");
      }
    }

    await Notification.deleteOne({ resource: resource._id });

    return res.status(200).json({ success: true, message: "Resource approved" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not approve resource", error: err.message });
  }
}

// @route POST /api/admin/moderation/:id/reject
// reason is optional — quick-review from the notifications panel skips it
// (per your frontend, that flow just says "log a reason later"); the full
// moderation queue's reject modal always sends one since it's required client-side.
async function rejectResource(req, res) {
  try {
    const { reason = "" } = req.body;

    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ success: false, message: "Resource not found" });

    resource.status = "rejected";
    resource.rejectionReason = reason;
    resource.reviewedBy = req.user.id;
    resource.reviewedAt = new Date();
    await resource.save();
    
    const uploader = await User.findById(resource.uploader);
    if (uploader) {
      if (uploader.preferences.notifications.uploadStatus.inApp) {
        await Notification.create({ resource: resource._id, recipient: uploader._id, type: "resource_rejected" });
      }
      if (uploader.preferences.notifications.uploadStatus.email) {
        await sendResourceStatusEmail(uploader.email, uploader.fullName, resource.title, "rejected", reason);
      }
    }
    await Notification.deleteOne({ resource: resource._id });

    return res.status(200).json({ success: true, message: "Resource rejected" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not reject resource", error: err.message });
  }
}

module.exports = { getModerationQueue, approveResource, rejectResource, formatFileSize };