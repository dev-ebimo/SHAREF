import { verify } from "hono/jwt";

// Decode the JWT, then confirm against the database that the account still
// exists, isn't suspended, and hasn't changed its password since the token
// was issued. Results are cached briefly per Worker isolate to spare D1.
//
// Honest bound on staleness: the cache is per-isolate. A suspension takes
// effect IMMEDIATELY in the isolate that handled the admin's click
// (invalidateAuthCache), and within TTL_MS (15 s) everywhere else.
const TTL_MS = 15 * 1000;
const cache = new Map(); // userId -> { role, status, pwChangedSec, expiresAt }
const MAX_CACHE_ENTRIES = 2000;

function cacheGet(userId) {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(userId);
    return null;
  }
  return entry;
}

function cacheSet(userId, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear(); // simple bound; entries are cheap to rebuild
  cache.set(userId, { ...value, expiresAt: Date.now() + TTL_MS });
}

export function invalidateAuthCache(userId) {
  cache.delete(userId);
}

// Test helper.
export function _clearAuthCache() {
  cache.clear();
}

function reject(c, message, extra = {}) {
  // 401 (not 403) on purpose: the frontend's authFetch logs the user out and
  // redirects to login on any 401, which is exactly right for a suspended
  // or password-changed session.
  return c.json({ success: false, message, ...extra }, 401);
}

export async function protect(c, next) {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return c.json({ success: false, message: "Not authorized, no token provided" }, 401);
  }

  let decoded;
  try {
    decoded = await verify(token, c.env.JWT_SECRET, "HS256");
  } catch (err) {
    return reject(c, "Not authorized, invalid or expired token");
  }
  if (typeof decoded.id !== "string" || !decoded.id) {
    // e.g. a download token (no `id`) presented as a session token
    return reject(c, "Not authorized, invalid or expired token");
  }

  let info = cacheGet(decoded.id);
  if (!info) {
    const user = await c.env.DB.prepare("SELECT role, account_status, password_changed_at FROM users WHERE id = ?")
      .bind(decoded.id)
      .first();
    if (!user) return reject(c, "User no longer exists");
    info = {
      role: user.role,
      status: user.account_status,
      pwChangedSec: user.password_changed_at ? Math.floor(Date.parse(user.password_changed_at) / 1000) : 0,
    };
    cacheSet(decoded.id, info);
  }

  if (info.status === "suspended") {
    return reject(c, "Your account has been suspended. Contact support if you believe this is a mistake.", { suspended: true });
  }
  if (info.pwChangedSec && (decoded.iat ?? 0) < info.pwChangedSec) {
    return reject(c, "Your password was changed. Please log in again.");
  }

  c.set("user", { id: decoded.id, role: info.role });
  await next();
}

// Restricts a route to specific roles, e.g. restrictTo("admin")
export function restrictTo(...roles) {
  return async (c, next) => {
    const user = c.get("user");
    if (!roles.includes(user.role)) {
      return c.json({ success: false, message: "You do not have permission to perform this action" }, 403);
    }
    await next();
  };
}
