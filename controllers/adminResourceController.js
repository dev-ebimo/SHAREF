const fs = require("fs");
const Resource = require("../models/Resource");
const timeAgo = require("../utils/timeAgo");
const { buildDownloadStreamUrl } = require("../utils/downloadToken");

const REJECTION_REASONS = [
  "duplicate", "wrong_course", "wrong_dept", "poor_quality",
  "incomplete", "corrupted", "unsupported", "not_academic", "spam", "other",
];

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function shapeAdminResource(r, req, extra = {}) {
  return {
    id: r._id,
    title: r.title,
    type: r.type,
    department: r.department,
    course: r.course,
    level: r.level,
    semester: r.semester,
    session: r.session,
    description: r.description,
    fileExtension: r.fileExtension,
    fileUrl: buildDownloadStreamUrl(req, r._id, req.user.id),
    size: formatFileSize(r.fileSizeBytes),
    downloads: r.downloads,
    uploader: r.uploader?.fullName || "Unknown",
    reviewedBy: r.reviewedBy?.fullName || "—",
    date: r.reviewedAt ? formatDate(r.reviewedAt) : formatDate(r.createdAt),
    uploadedDate: formatDate(r.createdAt),
    ...extra,
  };
}

// @route GET /api/admin/resources/filter-options
// Populates department/course dropdowns dynamically instead of hardcoding
// them — new departments/courses show up automatically as they're uploaded.
async function getFilterOptions(req, res) {
  try {
    const [departments, courses] = await Promise.all([
      Resource.distinct("department", { status: { $in: ["approved", "rejected"] } }),
      Resource.distinct("course", { status: { $in: ["approved", "rejected"] } }),
    ]);

    return res.status(200).json({
      success: true,
      departments: departments.sort(),
      courses: courses.sort(),
      types: ["Lecture Note", "Past Question", "Assignment Material", "Textbook", "Revision Sheet", "Other"],
      rejectionReasons: REJECTION_REASONS,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch filter options", error: err.message });
  }
}

// @route GET /api/admin/resources/approved
async function getApprovedResources(req, res) {
  try {
    const {
      search = "", department = "", type = "", course = "",
      approvalDate = "", sort = "newest", page = 1, limit = 20,
    } = req.query;

    const query = { status: "approved" };
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { course: { $regex: search, $options: "i" } },
      ];
    }
    if (department) query.department = department;
    if (type) query.type = type;
    if (course) query.course = course;
    if (approvalDate) {
      const start = new Date(approvalDate);
      const end = new Date(approvalDate);
      end.setDate(end.getDate() + 1);
      query.reviewedAt = { $gte: start, $lt: end };
    }

    let sortOption = { reviewedAt: -1 };
    if (sort === "oldest") sortOption = { reviewedAt: 1 };
    if (sort === "downloads") sortOption = { downloads: -1 };

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [resources, total, totalApprovedOverall] = await Promise.all([
      Resource.find(query).populate("uploader", "fullName").populate("reviewedBy", "fullName")
        .sort(sortOption).skip(skip).limit(limitNum),
      Resource.countDocuments(query),
      Resource.countDocuments({ status: "approved" }),
    ]);

    return res.status(200).json({
      success: true,
      resources: resources.map((r) => shapeAdminResource(r, req)),
      totalApproved: totalApprovedOverall,
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch approved resources", error: err.message });
  }
}

// @route GET /api/admin/resources/rejected
async function getRejectedResources(req, res) {
  try {
    const {
      search = "", department = "", type = "", reason = "",
      rejectionDate = "", sort = "newest", page = 1, limit = 20,
    } = req.query;

    const query = { status: "rejected" };
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { course: { $regex: search, $options: "i" } },
      ];
    }
    if (department) query.department = department;
    if (type) query.type = type;
    if (reason) query.rejectionReason = reason;
    if (rejectionDate) {
      const start = new Date(rejectionDate);
      const end = new Date(rejectionDate);
      end.setDate(end.getDate() + 1);
      query.reviewedAt = { $gte: start, $lt: end };
    }

    const sortOption = sort === "oldest" ? { reviewedAt: 1 } : { reviewedAt: -1 };
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [resources, total, totalRejectedOverall] = await Promise.all([
      Resource.find(query).populate("uploader", "fullName").populate("reviewedBy", "fullName")
        .sort(sortOption).skip(skip).limit(limitNum),
      Resource.countDocuments(query),
      Resource.countDocuments({ status: "rejected" }),
    ]);

    return res.status(200).json({
      success: true,
      resources: resources.map((r) => shapeAdminResource(r, req, { rejectionReason: r.rejectionReason })),
      totalRejected: totalRejectedOverall,
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch rejected resources", error: err.message });
  }
}

// @route GET /api/admin/resources/:id
// Powers both the Approved and Rejected details modals
async function getResourceDetails(req, res) {
  try {
    const resource = await Resource.findById(req.params.id)
      .populate("uploader", "fullName")
      .populate("reviewedBy", "fullName");

    if (!resource) return res.status(404).json({ success: false, message: "Resource not found" });

    return res.status(200).json({ success: true, resource: shapeAdminResource(resource, req, { rejectionReason: resource.rejectionReason }) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch resource", error: err.message });
  }
}

// @route POST /api/admin/resources/:id/remove
// "Remove Resource" from the Approved page — functionally the same as a
// rejection, just triggered from a different screen.
async function removeApprovedResource(req, res) {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: "A reason is required" });

    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ success: false, message: "Resource not found" });

    resource.status = "rejected";
    resource.rejectionReason = reason;
    resource.reviewedBy = req.user.id;
    resource.reviewedAt = new Date();
    await resource.save();

    return res.status(200).json({ success: true, message: "Resource removed and moved to Rejected" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not remove resource", error: err.message });
  }
}

// @route POST /api/admin/resources/:id/restore
async function restoreToPending(req, res) {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ success: false, message: "Resource not found" });

    resource.status = "pending";
    resource.rejectionReason = "";
    resource.reviewedBy = undefined;
    resource.reviewedAt = undefined;
    await resource.save();

    return res.status(200).json({ success: true, message: "Resource restored to Pending" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not restore resource", error: err.message });
  }
}

// @route DELETE /api/admin/resources/:id
async function permanentlyDeleteResource(req, res) {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ success: false, message: "Resource not found" });

    const cloudinary = require("../config/cloudinary");
    // Must match the resource_type the file was actually uploaded with
    // (always "raw" for the main file) — destroying with the wrong type
    // silently no-ops on Cloudinary and leaves the file orphaned.
    await cloudinary.uploader.destroy(resource.cloudinaryPublicId, {
      resource_type: resource.cloudinaryResourceType || "raw",
    });
    // PDFs also have a second, preview-only "image" asset — clean that up too.
    if (resource.previewImagePublicId) {
      await cloudinary.uploader.destroy(resource.previewImagePublicId, { resource_type: "image" });
    }

    await resource.deleteOne();

    return res.status(200).json({ success: true, message: "Resource permanently deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not delete resource", error: err.message });
  }
}

module.exports = {
  getFilterOptions, getApprovedResources, getRejectedResources,
  getResourceDetails, removeApprovedResource, restoreToPending, permanentlyDeleteResource,
};