const cloudinary = require("../config/cloudinary");

// Builds a preview-image URL for a PDF that was uploaded with
// resource_type: "image" (see controllers/resourceController.js). No file
// is fetched or generated here — Cloudinary derives (and caches) this
// cropped page image lazily, the first time this exact URL is requested,
// which in practice is the first time a student clicks "Preview".
//
// pg_1            -> render page 1 only
// c_crop,g_north,
// h_0.5,w_1.0,
// fl_relative      -> crop to the top 50% of that page's height
// f_jpg,q_auto     -> small, fast-loading JPEG
function buildPdfHalfPagePreviewUrl(publicId) {
  return cloudinary.url(publicId, {
    resource_type: "image",
    page: 1,
    format: "jpg",
    transformation: [
      { flags: "relative", crop: "crop", gravity: "north", width: 1.0, height: 0.5 },
      { quality: "auto", fetch_format: "auto" },
    ],
  });
}

module.exports = { buildPdfHalfPagePreviewUrl };
