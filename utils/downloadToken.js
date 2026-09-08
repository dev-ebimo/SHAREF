const jwt = require("jsonwebtoken");

// Long enough for the browser to act on a freshly-issued download link
// immediately; short enough that the link isn't meaningfully reusable
// later if it ever leaked (e.g. showed up in browser history or a proxy
// log). This is not the user's normal auth session — see below.
const DOWNLOAD_TOKEN_TTL = "2m";

// Why this exists: the actual file download happens via a plain browser
// navigation (an <a> click / window.open), not an authenticated fetch() —
// so it can't carry the user's normal `Authorization: Bearer <jwt>` header
// the rest of the API relies on. The entitlement check (has this student
// paid for this resource? is this an admin reviewing it?) still happens
// exactly once, wherever the token is issued — chargeForDownload, the
// admin preview endpoint, or the admin resource listing. This token just
// proves that check already passed, for the short window it takes the
// browser to follow the link.
//
// The payload is deliberately shaped differently from the normal auth
// token (`{ id, role }` — see generateToken.js) so the two can never be
// used interchangeably: this one carries `purpose`, `resourceId`, and
// `userId` instead of `id`, so a download token handed to `protect()`
// would fail to resolve a user, and a normal auth token handed to
// verifyDownloadToken() below would fail the purpose check.
function signDownloadToken(resourceId, userId) {
  return jwt.sign(
    { purpose: "download", resourceId: String(resourceId), userId: String(userId) },
    process.env.JWT_SECRET,
    { expiresIn: DOWNLOAD_TOKEN_TTL }
  );
}

// Throws (via jwt.verify) if the token is missing, malformed, expired, or
// signed with a different secret. Callers should catch and respond 401.
function verifyDownloadToken(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.purpose !== "download") {
    throw new Error("Not a download token");
  }
  return decoded;
}

// Builds the full, absolute URL the browser should navigate to. Absolute
// (not relative) on purpose: the frontend just does
// `window.open(data.fileUrl, "_blank")` with whatever URL it's given, the
// same way it always has with a direct Cloudinary URL, so this needs to be
// independently correct regardless of where the frontend happens to be
// hosted. `req.protocol` resolves correctly behind Render's proxy because
// app.js already sets `trust proxy`.
function buildDownloadStreamUrl(req, resourceId, userId) {
  const token = signDownloadToken(resourceId, userId);
  return `${req.protocol}://${req.get("host")}/api/resources/${resourceId}/stream?token=${token}`;
}

module.exports = { signDownloadToken, verifyDownloadToken, buildDownloadStreamUrl };
