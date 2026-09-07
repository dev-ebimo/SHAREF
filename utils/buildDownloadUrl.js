const cloudinary = require("../config/cloudinary");

// Cloudinary's "raw" resource_type names the delivered file after the
// upload's public_id — and since nothing here ever sets use_filename on
// upload, that's a randomly generated string (e.g. "z99a4bcsxscoofuaugmo"),
// not the resource's actual title. Retroactively renaming public_ids for
// every already-stored file would mean regenerating every asset (and every
// URL already pointing at one), so instead this builds a fresh Cloudinary
// URL on demand using the `fl_attachment:<filename>` flag, which only
// changes the Content-Disposition header the browser sees when it saves
// the file — it doesn't touch the stored asset, its public_id, or any
// other URL already pointing at it (previews, admin text-extraction
// fetches, etc. keep using resource.fileUrl exactly as stored).
//
// Only call this at the moment a URL is being handed to a browser for an
// actual "Save As" — not for internal server-side fetches (e.g. pulling
// the file buffer for text extraction), which should keep using the plain
// resource.fileUrl.
function buildDownloadUrl(resource) {
  const rawName = resource.title || resource.fileName || "resource";
  const safeName = rawName
    .replace(/[^\p{L}\p{N} _-]/gu, "") // strip anything that could break the URL or the filename, Unicode-aware
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 100);

  const fileName = `${safeName || "resource"}.${resource.fileExtension}`;

  return cloudinary.url(resource.cloudinaryPublicId, {
    resource_type: resource.cloudinaryResourceType || "raw",
    type: "upload",
    secure: true,
    flags: `attachment:${fileName}`,
  });
}

module.exports = buildDownloadUrl;
