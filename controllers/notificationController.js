const Notification = require("../models/Notification");
const timeAgo = require("../utils/timeAgo");
const { approveResource, rejectResource, formatFileSize } = require("./moderationController");

// @route GET /api/admin/notifications
async function getNotifications(req, res) {
  try {
    const notifications = await Notification.find({ recipient: null })
      .populate({
        path: "resource",
        populate: { path: "uploader", select: "fullName" },
      })
      .sort({ createdAt: -1 });

    const feed = notifications
      .filter((n) => n.resource) // guard against a resource having been deleted directly
      .map((n) => ({
        id: n._id,
        resourceId: n.resource._id,
        title: n.resource.title,
        type: n.resource.type,
        dept: n.resource.department,
        course: n.resource.course,
        level: `${n.resource.level} Level`,
        semester: n.resource.semester,
        session: n.resource.session,
        uploader: n.resource.uploader.fullName,
        size: formatFileSize(n.resource.fileSizeBytes),
        timeAgo: timeAgo(n.createdAt),
        unread: n.unread,
      }));

    return res.status(200).json({ success: true, notifications: feed });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch notifications", error: err.message });
  }
}

// @route PATCH /api/admin/notifications/:id/toggle-read
async function toggleRead(req, res) {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });

    notification.unread = !notification.unread;
    await notification.save();

    return res.status(200).json({ success: true, unread: notification.unread });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not update notification", error: err.message });
  }
}

// @route PATCH /api/admin/notifications/mark-all-read
async function markAllRead(req, res) {
  try {
    await Notification.updateMany({ recipient: null, unread: true }, { $set: { unread: false } });
    return res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not mark notifications as read", error: err.message });
  }
}

// @route POST /api/admin/notifications/:id/approve
// Quick-review approve — same underlying logic as the full moderation queue.
async function quickApprove(req, res) {
  const notification = await Notification.findById(req.params.id);
  if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });

  req.params.id = notification.resource; // reuse approveResource by resource id
  return approveResource(req, res);
}

// @route POST /api/admin/notifications/:id/reject
async function quickReject(req, res) {
  const notification = await Notification.findById(req.params.id);
  if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });

  req.params.id = notification.resource;
  return rejectResource(req, res);
}

module.exports = { getNotifications, toggleRead, markAllRead, quickApprove, quickReject };