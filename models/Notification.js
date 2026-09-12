const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    resource: { type: mongoose.Schema.Types.ObjectId, ref: "Resource" }, // no longer required
    announcement: { type: mongoose.Schema.Types.ObjectId, ref: "Announcement" },
    // Only set for type "account_deleted" — the User document itself is
    // gone by the time this notification is read, so it points at the
    // snapshot taken right before deletion instead.
    deletedAccountLog: { type: mongoose.Schema.Types.ObjectId, ref: "DeletedAccountLog" },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    type: {
      type: String,
      enum: ["new_upload", "resource_approved", "resource_rejected", "announcement", "account_deleted"],
      default: "new_upload",
    },
    unread: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);