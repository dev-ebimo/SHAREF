const Resource = require("../models/Resource");
const DownloadLog = require("../models/DownloadLog");
const { buildPdfHalfPagePreviewUrl } = require("../utils/cloudinaryPreview");

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shapeResource(r) {
  return {
    id: r._id,
    title: r.title,
    course: r.course,
    type: r.type,
    department: r.department,
    level: r.level,
    semester: r.semester,
    session: r.session,
    size: formatFileSize(r.fileSizeBytes),
    pages: r.pages,
    downloads: r.downloads,
    date: r.createdAt,
  };
}

// @route GET /api/resources/recent
// Powers the "Recently Added" feed on the dashboard
async function getRecentFeed(req, res) {
  try {
    const limit = Number(req.query.limit) || 10;

    const resources = await Resource.find({ status: "approved" })
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(200).json({ success: true, resources: resources.map(shapeResource) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch recent resources", error: err.message });
  }
}

// @route GET /api/resources/trending
// Powers the Trending resource cards — most downloaded in the last 7 days
async function getTrending(req, res) {
  try {
    const limit = Number(req.query.limit) || 6;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const trendingIds = await DownloadLog.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: "$resource", recentDownloads: { $sum: 1 } } },
      { $sort: { recentDownloads: -1 } },
      { $limit: limit },
    ]);

    if (trendingIds.length === 0) {
      return res.status(200).json({ success: true, resources: [] });
    }

    const idToCount = {};
    trendingIds.forEach((t) => { idToCount[t._id.toString()] = t.recentDownloads; });

    const resources = await Resource.find({
      _id: { $in: trendingIds.map((t) => t._id) },
      status: "approved",
    });

    // Preserve the aggregation's ranking order — Mongo's $in doesn't guarantee it
    const ordered = resources
      .sort((a, b) => idToCount[b._id.toString()] - idToCount[a._id.toString()])
      .map((r) => ({ ...shapeResource(r), recentDownloads: idToCount[r._id.toString()] }));

    return res.status(200).json({ success: true, resources: ordered });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch trending resources", error: err.message });
  }
}

// @route GET /api/resources/continue-learning
// Most recently downloaded resources for the logged-in user
async function getContinueLearning(req, res) {
  try {
    const limit = Number(req.query.limit) || 5;

    const recentLogs = await DownloadLog.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .populate("resource");

    // Dedupe by resource, keeping only the most recent download of each
    const seen = new Set();
    const uniqueResources = [];
    for (const log of recentLogs) {
      if (!log.resource || log.resource.status !== "approved") continue;
      const id = log.resource._id.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      uniqueResources.push(log.resource);
      if (uniqueResources.length >= limit) break;
    }

    return res.status(200).json({ success: true, resources: uniqueResources.map(shapeResource) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch continue learning", error: err.message });
  }
}

// @route GET /api/resources/past-questions
// Search + filter for the Past Questions page
async function searchPastQuestions(req, res) {
  try {
    const { search = "", session = "all", semester = "all", level = "all", sort = "newest" } = req.query;

    const query = { status: "approved", type: "Past Question" };

    if (search) {
      query.$or = [
        { course: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
      ];
    }
    if (session !== "all") query.session = session;
    if (semester !== "all") query.semester = semester;
    if (level !== "all") query.level = level;

    let sortOption = { createdAt: -1 }; // newest first (default)
    if (sort === "oldest") sortOption = { createdAt: 1 };
    if (sort === "downloads") sortOption = { downloads: -1 };

    const resources = await Resource.find(query).sort(sortOption);

    return res.status(200).json({ success: true, resources: resources.map(shapeResource) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch past questions", error: err.message });
  }
}
// @route GET /api/resources/:id/preview
// Student-facing preview — only ever shows a fraction of page 1, never the
// full document. PDFs get an image URL (top half of page 1, cropped by
// Cloudinary on request — nothing is generated or fetched here, this just
// returns the URL). DOCX/PPTX get the pre-extracted half-page text snippet.
async function getResourcePreview(req, res) {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource || resource.status !== "approved") {
      return res.status(404).json({ success: false, message: "Resource not available" });
    }

    if (resource.previewType === "image") {
      return res.status(200).json({
        success: true,
        previewType: "image",
        imageUrl: buildPdfHalfPagePreviewUrl(resource.cloudinaryPublicId),
      });
    }

    if (resource.previewType === "text") {
      return res.status(200).json({
        success: true,
        previewType: "text",
        snippet: resource.previewSnippet,
      });
    }

    return res.status(200).json({
      success: true,
      previewType: "none",
      message: resource.previewMessage || "Preview not available for this file type.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch preview", error: err.message });
  }
}

module.exports = { getRecentFeed, getTrending, getContinueLearning, searchPastQuestions, shapeResource, getResourcePreview };