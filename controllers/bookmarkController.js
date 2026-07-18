const Bookmark = require("../models/Bookmark");
const Resource = require("../models/Resource");
const { shapeResource } = require("./browseController");

// @route POST /api/bookmarks/:resourceId
// Toggles a bookmark on/off — one endpoint handles both add and remove
async function toggleBookmark(req, res) {
  try {
    const { resourceId } = req.params;

    const resource = await Resource.findById(resourceId);
    if (!resource || resource.status !== "approved") {
      return res.status(404).json({ success: false, message: "Resource not available" });
    }

    const existing = await Bookmark.findOne({ user: req.user.id, resource: resourceId });

    if (existing) {
      await existing.deleteOne();
      return res.status(200).json({ success: true, bookmarked: false, message: "Removed from bookmarks" });
    }

    await Bookmark.create({ user: req.user.id, resource: resourceId });
    return res.status(200).json({ success: true, bookmarked: true, message: "Saved to bookmarks" });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not update bookmark", error: err.message });
  }
}

// @route GET /api/bookmarks
async function getBookmarks(req, res) {
  try {
    const bookmarks = await Bookmark.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .populate("resource");

    const resources = bookmarks
      .filter((b) => b.resource && b.resource.status === "approved")
      .map((b) => shapeResource(b.resource));

    return res.status(200).json({ success: true, resources });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not fetch bookmarks", error: err.message });
  }
}

// @route GET /api/bookmarks/check/:resourceId
// Lets the frontend know whether to render a resource as already-bookmarked
async function checkBookmark(req, res) {
  try {
    const { resourceId } = req.params;
    const existing = await Bookmark.findOne({ user: req.user.id, resource: resourceId });
    return res.status(200).json({ success: true, bookmarked: !!existing });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Could not check bookmark", error: err.message });
  }
}

module.exports = { toggleBookmark, getBookmarks, checkBookmark };