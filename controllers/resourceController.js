const fs = require("fs");
const Resource = require("../models/Resource");
const Notification = require("../models/Notification");
const countPages = require("../utils/pageCounter");
const sanitizeError = require("../utils/sanitizeError");
const getPreviewSnippet = require("../utils/previewSnippet");
const cloudinary = require("../config/cloudinary");

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatResource(resource) {
  return {
    id: resource._id,
    title: resource.title,
    type: resource.type,
    department: resource.department,
    course: resource.course,
    level: resource.level,
    semester: resource.semester,
    session: resource.session,
    description: resource.description,
    fileName: resource.fileName,
    fileExtension: resource.fileExtension,
    pages: resource.pages,
    size: formatFileSize(resource.fileSizeBytes),
    downloads: resource.downloads,
    status: resource.status,
    uploader: resource.uploader?.fullName || undefined,
    createdAt: resource.createdAt,
  };
}

function getPagination(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));
  return { page, limit, skip: (page - 1) * limit };
}

// @route POST /api/resources/upload
async function uploadResource(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "A file is required" });
    }

    const { title, type, department, course, level, semester, session, description } = req.body;

    const fileExtension = req.file.originalname.split(".").pop().toLowerCase();

    const fileBuffer = fs.readFileSync(req.file.path);
    const pages = await countPages(fileBuffer, req.file.originalname);

    // Same call, same treatment, for every file type — PDF included.
    // getPreviewSnippet now extracts real page-1 text from PDFs via
    // pdf-parse, same idea as DOCX/PPTX. Only truly unsupported types
    // (.zip, scanned/image-only PDFs with no text layer, etc.) come back
    // { available: false }.
    const previewResult = await getPreviewSnippet(fileBuffer, req.file.originalname);

    // The stored file always uploads as "raw", regardless of type. PDFs used
    // to briefly use "image" here to unlock a page-crop transformation, but
    // Cloudinary blocks serving the UNTRANSFORMED original through the
    // "image" resource type by default — that broke both downloads and the
    // admin full-document preview, which both need the real, unmodified
    // file. "raw" has no such restriction.
    const cloudinaryResult = await cloudinary.uploader.upload(req.file.path, {
      resource_type: "raw",
      folder: "sharef_resources",
    });

    fs.unlink(req.file.path, () => {}); // clean up the local temp file regardless

    const previewType = previewResult.available ? "text" : "none";

    const resource = await Resource.create({
      title, type, department, course, level, semester, session, description,
      uploader: req.user.id,
      fileName: req.file.originalname,
      fileUrl: cloudinaryResult.secure_url,
      cloudinaryPublicId: cloudinaryResult.public_id,
      cloudinaryResourceType: "raw",
      fileSizeBytes: req.file.size,
      fileExtension,
      pages,
      previewType,
      previewAvailable: previewType !== "none",
      previewSnippet: previewType === "text" ? previewResult.snippet : "",
      previewMessage: previewType === "none" ? (previewResult.message || "Preview not available for this file type.") : "",
    });

    await Notification.create({ resource: resource._id, recipient: null, type: "new_upload" });

    return res.status(201).json({
      success: true,
      message: "Resource submitted for review. You'll be notified once it's approved.",
      resource: {
        id: resource._id, title: resource.title, type: resource.type,
        course: resource.course, pages: resource.pages, description: resource.description,
        size: formatFileSize(resource.fileSizeBytes), status: resource.status,
      },
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    if (err.isPageCountError) {
      return res.status(422).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: "Upload failed", error: sanitizeError(err) });
  }
}

// @route GET /api/resources
// Public browse/search of approved resources with optional filters + pagination
async function getResources(req, res) {
  try {
    const { department, course, level, semester, type, session, search, sort } = req.query;
    const { page, limit, skip } = getPagination(req);

    const filter = { status: "approved" };
    if (department) filter.department = department;
    if (course) filter.course = course;
    if (level) filter.level = level;
    if (semester) filter.semester = semester;
    if (type) filter.type = type;
    if (session) filter.session = session;
    if (search) filter.title = { $regex: search.trim(), $options: "i" };

    const sortOption = sort === "popular" ? { downloads: -1 } : { createdAt: -1 };

    const [resources, total] = await Promise.all([
      Resource.find(filter)
        .populate("uploader", "fullName")
        .sort(sortOption)
        .skip(skip)
        .limit(limit),
      Resource.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: resources.length,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      resources: resources.map(formatResource),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch resources", error: sanitizeError(err) });
  }
}

// @route GET /api/resources/my-uploads
// Everything the logged-in user has uploaded, any status, optionally filtered by status
async function getMyUploads(req, res) {
  try {
    const { page, limit, skip } = getPagination(req);

    const filter = { uploader: req.user.id };
    if (req.query.status) filter.status = req.query.status;

    const [resources, total] = await Promise.all([
      Resource.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Resource.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: resources.length,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      resources: resources.map((r) => ({ ...formatResource(r), rejectionReason: r.rejectionReason })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch your uploads", error: sanitizeError(err) });
  }
}

// @route GET /api/resources/:id
// Approved resources are visible to anyone; pending/rejected only to the uploader or an admin
async function getResourceById(req, res) {
  try {
    const resource = await Resource.findById(req.params.id).populate("uploader", "fullName");
    if (!resource) {
      return res.status(404).json({ success: false, message: "Resource not found" });
    }

    const isOwner = resource.uploader?._id?.toString() === req.user.id;
    const isAdmin = req.user.role === "admin";
    if (resource.status !== "approved" && !isOwner && !isAdmin) {
      return res.status(404).json({ success: false, message: "Resource not found" });
    }

    return res.status(200).json({ success: true, resource: formatResource(resource) });
  } catch (err) {
    if (err.name === "CastError") {
      return res.status(404).json({ success: false, message: "Resource not found" });
    }
    return res.status(500).json({ success: false, message: "Could not fetch resource", error: sanitizeError(err) });
  }
}

// Note: resource downloads go through walletController.chargeForResource
// (POST /api/wallet/charge), which already returns the Cloudinary fileUrl
// directly — there's no separate file-streaming download route. An older
// downloadResource() used to live here but referenced a local `filePath`
// that no longer exists now that uploads go straight to Cloudinary, plus a
// missing `path` import; it was dead code (never routed) and has been
// removed rather than fixed, since chargeForResource already covers this.

// Note: approve/reject for pending resources is handled by
// moderationController.js (mounted at /api/admin/moderation), which is what
// admin-moderation.html actually calls. The versions that used to live here
// were unrouted duplicates and have been removed to avoid confusion.

module.exports = {
  uploadResource,
  getResources,
  getMyUploads,
  getResourceById,
};
