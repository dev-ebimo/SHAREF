const axios = require("axios");
const Resource = require("../models/Resource");
const { verifyDownloadToken } = require("../utils/downloadToken");

const MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

function buildFriendlyFileName(resource) {
  const rawName = resource.title || resource.fileName || "resource";
  const safeName = rawName
    .replace(/[^\p{L}\p{N} _-]/gu, "") // strip anything that could break the header or the filename, Unicode-aware
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 100);

  return `${safeName || "resource"}.${resource.fileExtension}`;
}

// Sets both a plain ASCII-safe filename and an RFC 5987 UTF-8 encoded one.
// buildFriendlyFileName already strips most punctuation, but a title in a
// non-Latin script (Arabic, Hausa/Yoruba/Igbo with diacritics, etc.) can
// still contain non-ASCII letters — those are valid in `\p{L}` and get
// kept. Plain `filename="..."` isn't spec-compliant for non-ASCII bytes,
// so browsers that follow the spec strictly need the `filename*=` form;
// browsers that don't care just use the ASCII fallback instead.
function buildContentDisposition(fileName) {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_") || "resource";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// @route GET /api/resources/:id/stream?token=<downloadToken>
// Deliberately NOT behind the normal `protect` middleware — see
// utils/downloadToken.js for why (this is reached via a plain browser
// navigation, which can't carry an Authorization header).
//
// This fetches the file from Cloudinary's plain, untransformed raw URL
// (the same one that's always worked) and re-serves it through this
// server with a manually-set Content-Disposition header. That's the whole
// point: Cloudinary's raw resource type doesn't reliably support on-the-fly
// transformations like fl_attachment (see the walletController.js /
// moderationController.js history — that approach 401'd every download,
// PDF and DOCX alike, the moment it shipped), so the friendly filename has
// to be applied here instead, entirely outside Cloudinary's URL-building.
async function streamResourceDownload(req, res) {
  let decoded;
  try {
    decoded = verifyDownloadToken(req.query.token);
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "This download link has expired. Please start the download again.",
    });
  }

  if (decoded.resourceId !== req.params.id) {
    return res.status(403).json({ success: false, message: "This download link isn't valid for this file." });
  }

  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ success: false, message: "Resource not found" });

    const upstream = await axios.get(resource.fileUrl, { responseType: "stream" });

    res.setHeader("Content-Disposition", buildContentDisposition(buildFriendlyFileName(resource)));
    res.setHeader("Content-Type", MIME_TYPES[resource.fileExtension] || "application/octet-stream");
    if (upstream.headers["content-length"]) {
      res.setHeader("Content-Length", upstream.headers["content-length"]);
    }

    upstream.data.pipe(res);
    upstream.data.on("error", (streamErr) => {
      console.error(`Stream interrupted for resource ${req.params.id}:`, streamErr.message);
      res.destroy();
    });
  } catch (err) {
    console.error(`Streamed download failed for resource ${req.params.id}:`, err.message);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: "Could not download this file right now." });
    }
    res.destroy();
  }
}

module.exports = { streamResourceDownload };
