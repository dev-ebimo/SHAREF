const User = require("../models/User");
const Announcement = require("../models/Announcement");
const Notification = require("../models/Notification");
const { sendAnnouncementEmail } = require("../services/emailService");

// @route POST /api/admin/announcements
async function createAnnouncement(req, res) {
  try {
    const { title, message, departments = [], levels = [] } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    const query = { role: "student" };
    if (departments.length > 0) query.department = { $in: departments };
    if (levels.length > 0) query.level = { $in: levels };

    const recipients = await User.find(query);

    const announcement = await Announcement.create({
      title, message,
      targetDepartments: departments,
      targetLevels: levels,
      createdBy: req.user.id,
      recipientCount: recipients.length,
    });

    // Fan out — each recipient's own preference decides in-app/email.
    // Wrapped per-user so one bad email address can't stop the whole batch.
    for (const student of recipients) {
      try {
        if (student.preferences.notifications.announcements.inApp) {
          await Notification.create({
            announcement: announcement._id,
            recipient: student._id,
            type: "announcement",
          });
        }
        if (student.preferences.notifications.announcements.email) {
          await sendAnnouncementEmail(student.email, student.fullName, title, message);
        }
      } catch (innerErr) {
        console.error(`Failed to notify ${student.email}:`, innerErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: `Announcement sent to ${recipients.length} student(s)`,
      announcement,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not send announcement", error: err.message });
  }
}

// @route GET /api/admin/announcements
async function getAnnouncements(req, res) {
  try {
    const announcements = await Announcement.find()
      .populate("createdBy", "fullName")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, announcements });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch announcements", error: err.message });
  }
}

module.exports = { createAnnouncement, getAnnouncements };