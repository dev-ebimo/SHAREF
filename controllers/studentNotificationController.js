const Notification = require("../models/Notification");

function shape(n) {
  if (n.type === "announcement") {
    return {
      id: n._id,
      type: "announcement",
      title: n.announcement.title,
      message: n.announcement.message,
      unread: n.unread,
      createdAt: n.createdAt,
    };
  }
  return {
    id: n._id,
    resourceId: n.resource._id,
    title: n.resource.title,
    course: n.resource.course,
    type: n.type,
    rejectionReason: n.type === "resource_rejected" ? n.resource.rejectionReason : undefined,
    unread: n.unread,
    createdAt: n.createdAt,
  };
}

// @route GET /api/notifications/mine
async function getMyNotifications(req, res) {
  try {
    const notifications = await Notification.find({ recipient: req.user.id })
      .populate("resource")
      .populate("announcement")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      notifications: notifications.filter((n) => n.resource || n.announcement).map(shape),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch notifications", error: err.message });
  }
}

// @route PATCH /api/notifications/mine/:id/toggle-read
async function toggleMyNotificationRead(req, res) {
  try {
    const notification = await Notification.findOne({ _id: req.params.id, recipient: req.user.id });
    if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });

    notification.unread = !notification.unread;
    await notification.save();

    return res.status(200).json({ success: true, unread: notification.unread });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not update notification", error: err.message });
  }
}

// @route PATCH /api/notifications/mine/mark-all-read
async function markAllMyNotificationsRead(req, res) {
  try {
    await Notification.updateMany({ recipient: req.user.id, unread: true }, { $set: { unread: false } });
    return res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not mark notifications as read", error: err.message });
  }
}

module.exports = { getMyNotifications, toggleMyNotificationRead, markAllMyNotificationsRead };