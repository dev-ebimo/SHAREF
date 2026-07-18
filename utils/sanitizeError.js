// Only expose raw error details in development.
// In production, clients get a generic message and the real error stays in your server logs.
function sanitizeError(err) {
  return process.env.NODE_ENV === "development" ? err.message : undefined;
}

module.exports = sanitizeError;