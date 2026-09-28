import { verifyDownloadToken } from "../utils/downloadToken.js";

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
  const rawName = resource.title || resource.file_name || "resource";
  const safeName = rawName
    .replace(/[^\p{L}\p{N} _-]/gu, "") // strip anything that could break the header or the filename, Unicode-aware
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 100);

  return `${safeName || "resource"}.${resource.file_extension}`;
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
// Fetches the file from Cloudinary's plain, untransformed raw URL and
// re-serves it with a manually-set Content-Disposition header, same
// reasoning as the original (Cloudinary's raw resource type doesn't
// reliably support on-the-fly transformations like fl_attachment).
//
// This is simpler on Workers than it was on Express: fetch()'s Response
// body IS already a Web ReadableStream, so it passes straight through as
// the new Response's body — no manual .pipe()/stream-event wiring needed.
export async function streamResourceDownload(c) {
  let decoded;
  try {
    decoded = await verifyDownloadToken(c.env, c.req.query("token"));
  } catch (err) {
    return c.json(
      { success: false, message: "This download link has expired. Please start the download again." },
      401
    );
  }

  const resourceId = c.req.param("id");
  if (decoded.resourceId !== resourceId) {
    return c.json({ success: false, message: "This download link isn't valid for this file." }, 403);
  }

  try {
    const resource = await c.env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(resourceId).first();
    if (!resource) return c.json({ success: false, message: "Resource not found" }, 404);

    const upstream = await fetch(resource.file_url);
    if (!upstream.ok || !upstream.body) {
      throw new Error(`Upstream fetch failed with status ${upstream.status}`);
    }

    const headers = new Headers();
    headers.set("Content-Disposition", buildContentDisposition(buildFriendlyFileName(resource)));
    headers.set("Content-Type", MIME_TYPES[resource.file_extension] || "application/octet-stream");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(upstream.body, { status: 200, headers });
  } catch (err) {
    console.error(`Streamed download failed for resource ${resourceId}:`, err.message);
    return c.json({ success: false, message: "Could not download this file right now." }, 500);
  }
}
