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

    // Only the fields the fan-out below actually uses — this can return
    // thousands of documents, and there's no reason to pull every field
    // (including the password hash and OTP fields) across the wire for it.
    const recipients = await User.find(query)
      .select("email fullName preferences.notifications.announcements")
      .lean();

    const announcement = await Announcement.create({
      title, message,
      targetDepartments: departments,
      targetLevels: levels,
      createdBy: req.user.id,
      recipientCount: recipients.length,
    });

    // Fan out — each recipient's own preference decides in-app/email.
    //
    // Both parts used to run one-at-a-time inside a single sequential loop,
    // so an announcement to N students meant N round-trips to Mongo plus N
    // round-trips to the email provider, all while the admin's request hung
    // open. At a few hundred recipients that's minutes, or a gateway
    // timeout. Now: one bulk insert for the in-app notifications, and
    // emails sent in parallel batches.
    const inAppRecipients = recipients.filter(
      (s) => s.preferences?.notifications?.announcements?.inApp
    );
    const emailRecipients = recipients.filter(
      (s) => s.preferences?.notifications?.announcements?.email
    );

    if (inAppRecipients.length > 0) {
      try {
        await Notification.insertMany(
          inAppRecipients.map((s) => ({
            announcement: announcement._id,
            recipient: s._id,
            type: "announcement",
          })),
          { ordered: false } // one bad doc shouldn't drop the rest of the batch
        );
      } catch (notifyErr) {
        console.error("Some in-app announcement notifications failed:", notifyErr.message);
      }
    }

    // Capped concurrency rather than firing every email at once — a few
    // hundred simultaneous connections would get throttled or dropped by
    // most providers. Each send is caught individually so one bad address
    // can't take down the batch.
    const EMAIL_BATCH_SIZE = 20;
    for (let i = 0; i < emailRecipients.length; i += EMAIL_BATCH_SIZE) {
      const batch = emailRecipients.slice(i, i + EMAIL_BATCH_SIZE);
      await Promise.all(
        batch.map((student) =>
          sendAnnouncementEmail(student.email, student.fullName, title, message)
            .catch((emailErr) =>
              console.error(`Failed to email ${student.email}:`, emailErr.message)
            )
        )
      );
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