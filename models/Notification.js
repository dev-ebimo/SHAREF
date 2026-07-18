const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    resource: { type: mongoose.Schema.Types.ObjectId, ref: "Resource" }, // no longer required
    announcement: { type: mongoose.Schema.Types.ObjectId, ref: "Announcement" },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    type: {
      type: String,
      enum: ["new_upload", "resource_approved", "resource_rejected", "announcement"],
      default: "new_upload",
    },
    unread: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);