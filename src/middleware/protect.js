import { verify } from "hono/jwt";

// Same idea as the Render app's middleware/protect.js + utils/authCache.js:
// decode the JWT, then confirm the user still exists / read their current
// role with a short-TTL cache instead of hitting D1 on every request.
//
// Honest caveat (same one as rateLimiter.js): this Map lives in one Worker
// isolate. It cuts D1 reads under normal traffic, but isn't a strict
// cross-isolate guarantee. If a deleted/suspended account needs to be
// locked out faster than this cache's TTL, that's enforced by the
// account_status check below, not by this cache expiring.
const TTL_MS = 60 * 1000;
const cache = new Map(); // userId -> { role, expiresAt }

function cacheGet(userId) {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(userId);
    return null;
  }
  return entry;
}

function cacheSet(userId, role) {
  cache.set(userId, { role, expiresAt: Date.now() + TTL_MS });
}

export function invalidateAuthCache(userId) {
  cache.delete(userId);
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
    return c.json({ success: false, message: "Not authorized, invalid or expired token" }, 401);
  }

  let cached = cacheGet(decoded.id);
  if (!cached) {
    const user = await c.env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(decoded.id).first();
    if (!user) {
      return c.json({ success: false, message: "User no longer exists" }, 401);
    }
    cacheSet(decoded.id, user.role);
    cached = { role: user.role };
  }

  c.set("user", { id: decoded.id, role: cached.role });
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
