// Builds a preview-image URL for a PDF that was uploaded with
// resource_type: "image" (legacy — new uploads use previewType "text" or
// "none" instead, see resourceController.js). No file is fetched or
// generated here — Cloudinary derives (and caches) this cropped page image
// lazily, the first time this exact URL is requested.
//
// Ported from the Cloudinary Node SDK's cloudinary.url() to a plain
// template string — that call was pure local string-building (no network
// request), so there was nothing Workers-incompatible about it, but this
// keeps the whole app off the SDK consistently rather than keeping one
// call site as an exception.
//
// pg_1                        -> render page 1 only
// fl_relative,c_crop,g_north,
// h_0.5,w_1.0                 -> crop to the top 50% of that page's height
// q_auto,f_auto                -> small, fast-loading, auto format/quality
export function buildPdfHalfPagePreviewUrl(env, publicId) {
  const transformation = "pg_1,fl_relative,c_crop,g_north,w_1.0,h_0.5/q_auto,f_auto";
  return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/image/upload/${transformation}/${publicId}.jpg`;
}
