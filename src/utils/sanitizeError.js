// Only expose raw error details in development.
// In production, clients get a generic message and the real error stays in
// the Worker's own logs (`wrangler tail`).
export function sanitizeError(env, err) {
  return env.NODE_ENV === "development" ? err.message : undefined;
}
