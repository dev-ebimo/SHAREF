const axios = require("axios");
const Resource = require("../models/Resource");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { sendResourceStatusEmail } = require("../services/emailService");

const timeAgo = require("../utils/timeAgo");
const { getFullText } = require("../utils/previewSnippet");
const { buildDownloadStreamUrl } = require("../utils/downloadToken");

const AGED_THRESHOLD_DAYS = 4;

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// @route GET /api/admin/moderation/queue
async function getModerationQueue(req, res) {
  try {
    const sortOrder = req.query.sort === "newest" ? -1 : 1;
    const pendingResources = await Resource.find({ status: "pending" })
      .populate("uploader", "fullName")
      .sort({ createdAt: sortOrder });

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
        // Just enough to pick the right UI when Preview is clicked — the
        // actual content (full image or full text) is fetched lazily via
        // getResourcePreviewForAdmin, not preloaded for every queue item.
        previewType: r.previewType,
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
        sendResourceStatusEmail(uploader.email, uploader.fullName, resource.title, "approved").catch((err) => {
          console.error(`Failed to send status email to ${uploader.email}:`, err.message);
        });
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
        sendResourceStatusEmail(uploader.email, uploader.fullName, resource.title, "rejected", reason).catch((err) => {
          console.error(`Failed to send status email to ${uploader.email}:`, err.message);
        });
      }
    }
    await Notification.deleteOne({ resource: resource._id });

    return res.status(200).json({ success: true, message: "Resource rejected" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not reject resource", error: err.message });
  }
}

// @route GET /api/admin/moderation/:id/preview
// Admin review needs the ENTIRE document, unlike the student preview (which
// only ever shows a fraction of page 1). DOCX/PPTX/PDF (previewType
// "text") all get a genuine inline preview — the complete extracted text —
// alongside a download option, extracted fresh on demand: nothing is kept
// locally after upload, so the original file is re-fetched from
// Cloudinary's public raw URL first. This only runs when an admin actually
// opens a preview, not for every item in the queue.
async function getResourcePreviewForAdmin(req, res) {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ success: false, message: "Resource not found" });

    if (resource.previewType === "text") {
      try {
        const fileResponse = await axios.get(resource.fileUrl, { responseType: "arraybuffer" });
        const fileBuffer = Buffer.from(fileResponse.data);
        const result = await getFullText(fileBuffer, resource.fileName);

        if (result.available) {
          return res.status(200).json({
            success: true,
            previewType: "text",
            fullText: result.fullText,
            fileUrl: buildDownloadStreamUrl(req, req.params.id, req.user.id),
          });
        }
        return res.status(200).json({
          success: true,
          previewType: "none",
          message: result.message || "Preview could not be generated for this document.",
          fileUrl: buildDownloadStreamUrl(req, req.params.id, req.user.id),
        });
      } catch (extractErr) {
        console.error(`Admin full-text preview failed for resource ${resource._id}:`, extractErr.message);
        return res.status(200).json({
          success: true,
          previewType: "none",
          message: "Preview could not be generated for this document.",
          fileUrl: buildDownloadStreamUrl(req, req.params.id, req.user.id),
        });
      }
    }

    // Legacy "image" PDFs (uploaded before the preview-image pipeline was
    // removed) and "none" both land here: no inline content, just the
    // download link so the admin can review the original file directly.
    return res.status(200).json({
      success: true,
      previewType: resource.previewType === "image" ? "image" : "none",
      message: resource.previewType === "image"
        ? "Download the file to review it in full."
        : (resource.previewMessage || "Preview not available for this file type."),
      fileUrl: buildDownloadStreamUrl(req, req.params.id, req.user.id),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not load preview", error: err.message });
  }
}

module.exports = {
  getModerationQueue, approveResource, rejectResource, formatFileSize, getResourcePreviewForAdmin,
};